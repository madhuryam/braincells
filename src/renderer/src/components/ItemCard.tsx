import { useEffect, useId, useRef, useState } from 'react'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { todayYmd, ymdAddDays } from '@shared/dates'
import type { Item, ItemStatus } from '@shared/types'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { useEditing } from '../state/editing'
import { useLabels } from '../state/labels'
import { useNav } from '../state/nav'
import { useMeetingPeek } from '../state/peek'
import { useSelection } from '../state/selection'
import { shortTitle, useUndo } from '../state/undo'
import { Card } from './Card'
import { usePendingOrder } from './dnd'
import { CheckableInput, Checkbox, ProjectDot } from './bits'
import { ConfirmButton } from './ConfirmButton'
import { ProjectPicker } from './ProjectPicker'
import { RichEditor, type RichEditorHandle } from './RichEditor'
import { itemBodyHtml } from '../richtext'
import { KIND_ICON, mmdd, prettyDate, projectLabel, rollingDays } from './../format'

interface ItemCardProps {
  item: Item
  /** Hide the project pill when the card already sits inside its project page. */
  showProject?: boolean
  /** Hide the scheduled-date pill when the surrounding group names the day. */
  showDate?: boolean
  /** Carried-over styling: quiet, faded, never red. */
  faded?: boolean
  /**
   * The day of the list this card sits in. Finished subtasks show
   * (struck through) only when they were completed on this day — a
   * task moved to another day presents just its remaining work.
   */
  contextDate?: string
  /**
   * When true the checkbox gathers this row into the multi-selection
   * instead of completing it (the Inbox: items are triaged, not done).
   */
  checkboxSelects?: boolean
  /**
   * The link binding this card to the meeting it renders under (prep
   * or follow-up lists). The context menu then offers "Remove from
   * this meeting" instead of the prep picker.
   */
  unlinkId?: string
  /**
   * Controlled expand/collapse. Pass both to let a parent enforce a
   * single open card at a time (the Inbox); omit for self-managed state.
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * One row of the subtask tree: indented by depth, checkable in place,
 * with hover actions to add a nested subtask (＋) or drop it (✕).
 * The row is draggable like a task card — among its siblings to
 * reorder, or out onto the timeline to give it a time block.
 */
function SubtaskRow({
  sub,
  depth,
  sortableIds,
  onToggle,
  onDrop,
  onRename,
  onAddChild
}: {
  sub: Item
  depth: number
  /** Ids of the visible siblings at this row's level, in list order. */
  sortableIds: string[]
  onToggle: (sub: Item) => void
  onDrop: (sub: Item) => void
  onRename: (sub: Item, title: string) => void
  onAddChild: (parentId: string, title: string) => Promise<void>
}): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const indent = (depth - 1) * 22
  // `subtask: true` keeps other cards from adopting this row's "home"
  // (no date, parent's project) when they're dropped onto it.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sub.id,
    data: { item: sub, sortableIds, subtask: true }
  })
  return (
    <>
      <div
        ref={setNodeRef}
        className="subtask-row"
        {...attributes}
        {...listeners}
        // The row sits inside a draggable card — stop the pointer-down
        // here so grabbing a subtask never also lifts the whole parent.
        onPointerDown={(e) => {
          e.stopPropagation()
          listeners?.onPointerDown?.(e)
        }}
        style={{
          marginLeft: indent,
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isDragging ? 0.35 : undefined
        }}
      >
        <Checkbox checked={sub.status === 'done'} onToggle={() => onToggle(sub)} />
        {editing ? (
          <input
            autoFocus
            style={{ flex: 1, minWidth: 0, fontSize: 14.5, padding: '3px 8px' }}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              setEditing(false)
              const t = titleDraft.trim()
              if (t && t !== sub.title) onRename(sub, t)
            }}
            onKeyDown={(e) => {
              // Enter / ⌘⏎ / ⌃⏎ / ⇧⏎ all commit-and-exit; blur saves.
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                e.stopPropagation() // don't also collapse the card
                setTitleDraft(sub.title)
                setEditing(false)
              }
            }}
          />
        ) : (
          <button
            className={`subtask-title ${sub.status === 'done' ? 'done' : ''}`}
            style={{ textAlign: 'left', cursor: 'text' }}
            title="Click to edit"
            onClick={() => {
              setTitleDraft(sub.title)
              setEditing(true)
            }}
          >
            {sub.title}
          </button>
        )}
        <button
          className="btn ghost small"
          title="Add a subtask under this one"
          onClick={() => setAdding(!adding)}
        >
          ＋
        </button>
        <button className="btn ghost small" title="Drop this subtask" onClick={() => onDrop(sub)}>
          ✕
        </button>
      </div>
      {adding && (
        <div style={{ marginLeft: indent + 22 }}>
          <CheckableInput
            autoFocus
            placeholder={`Add a subtask under “${shortTitle(sub.title)}”…`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Escape') {
                setAdding(false)
                setDraft('')
              }
              if (e.key === 'Enter' && draft.trim()) {
                await onAddChild(sub.id, draft.trim())
                setDraft('')
              }
            }}
          />
        </div>
      )}
    </>
  )
}

/**
 * The standard card for any item: collapsed it shows just enough at a
 * glance (title, project color, dates); clicking expands it inline into
 * a full editor. Edits save on blur — there is no save button to forget.
 */
export function ItemCard({
  item,
  showProject = true,
  showDate = true,
  faded,
  contextDate,
  checkboxSelects = false,
  unlinkId,
  open: controlledOpen,
  onOpenChange
}: ItemCardProps): React.JSX.Element {
  // Controlled when the parent passes `open` (Inbox: one card at a
  // time); otherwise the app-wide editing slot decides — at most one
  // card's editor is open anywhere, ever. The slot is keyed by this
  // card INSTANCE, not the item: the same task can render in several
  // places at once (Today's list and a meeting's prep list, say), and
  // only the copy that was clicked should expand.
  const instanceId = useId()
  const editing = useEditing()
  const open = controlledOpen ?? editing.openId === instanceId
  const setOpen = (next: boolean): void => {
    if (controlledOpen === undefined) editing.setOpenId(next ? instanceId : null)
    onOpenChange?.(next)
  }
  const [title, setTitle] = useState(item.title)
  const mutate = useMutate()
  const { projects, showDuePill, showTimePill } = useData()
  const { selected, toggle } = useSelection()
  const multiSelected = selected.has(item.id)
  const { openOverlay } = useNav()
  const peekMeeting = useMeetingPeek()
  const { pushUndo } = useUndo()
  const project = projects.find((p) => p.id === item.projectId)

  // If another screen edits this item, pick up the new values.
  useEffect(() => setTitle(item.title), [item.title])

  // Notes autosave: the rich editor owns the text while typing; saves
  // land 600ms after the last keystroke, and flush on close/unmount.
  const pendingBody = useRef<{ html: string; text: string } | null>(null)
  const bodyTimer = useRef<number | undefined>(undefined)
  const flushBody = (): void => {
    window.clearTimeout(bodyTimer.current)
    const p = pendingBody.current
    pendingBody.current = null
    if (p) patch({ richContent: p.html, content: p.text })
  }
  const onBodyChange = (html: string, text: string): void => {
    pendingBody.current = { html, text }
    window.clearTimeout(bodyTimer.current)
    bodyTimer.current = window.setTimeout(flushBody, 600)
  }
  useEffect(
    () => () => {
      // Unmount flush goes straight to the API (no re-render needed).
      const p = pendingBody.current
      pendingBody.current = null
      window.clearTimeout(bodyTimer.current)
      if (p) window.api.updateItem(item.id, { richContent: p.html, content: p.text })
    },
    [item.id]
  )

  const patch = (p: Parameters<typeof window.api.updateItem>[1]): Promise<void> =>
    mutate(() => window.api.updateItem(item.id, p))

  const isCheckable = item.kind === 'task' || item.kind === 'prep'
  const done = item.status === 'done'

  // Checkbox subtasks: ordinary task items linked 'subtask-of', to any
  // depth — the whole tree shows on the card, collapsed or not.
  const subtaskTree =
    useLiveQuery(
      () => (isCheckable ? window.api.subtaskTreeOf(item.id) : Promise.resolve([])),
      [item.id, isCheckable]
    ) ?? []

  // Total time on the calendar — every block for this task summed, not
  // just its first slot. Only queried when there's a block to measure;
  // the item's own estimate stands in until it resolves.
  const calendarMinutes =
    useLiveQuery(
      () =>
        item.timeEstimateMinutes != null
          ? window.api.calendarMinutes(item.id)
          : Promise.resolve(null),
      [item.id, item.timeEstimateMinutes]
    ) ?? item.timeEstimateMinutes
  const subtasksDone = subtaskTree.filter(({ item: s }) => s.status === 'done').length
  // While a subtask drag-reorder is persisting, the tree still carries
  // the old DB order (same trap TaskGroups dodges) — re-rank the moved
  // siblings and re-flatten depth-first so the drop doesn't snap back.
  const pendingOrder = usePendingOrder()
  let orderedTree = subtaskTree
  if (pendingOrder && subtaskTree.some((r) => pendingOrder.includes(r.item.id))) {
    const rank = new Map(pendingOrder.map((id, i) => [id, i]))
    const kids = new Map<string, typeof subtaskTree>()
    for (const row of subtaskTree) {
      const list = kids.get(row.parentId) ?? []
      list.push(row)
      kids.set(row.parentId, list)
    }
    for (const list of kids.values()) {
      const moved = list
        .filter((r) => rank.has(r.item.id))
        .sort((a, b) => rank.get(a.item.id)! - rank.get(b.item.id)!)
      let n = 0
      list.forEach((r, i) => {
        if (rank.has(r.item.id)) list[i] = moved[n++]
      })
    }
    orderedTree = []
    const walk = (pid: string): void => {
      for (const row of kids.get(pid) ?? []) {
        orderedTree.push(row)
        walk(row.item.id)
      }
    }
    walk(item.id)
  }
  // A finished subtask leaves the card — it reappears in the day's
  // Done section, grouped under this parent's name. Only a card that
  // is itself done keeps that day's finished pieces: it IS the record.
  const dayContext = contextDate ?? todayYmd()
  const visibleTree = orderedTree.filter(({ item: s }) =>
    s.status !== 'done'
      ? true
      : item.status === 'done' && (s.completedAt ?? '').slice(0, 10) === dayContext
  )
  // Visible siblings per parent: a drag-reorder stays within one
  // nesting level (dropping on a row of another level is a no-op).
  const siblingIds = new Map<string, string[]>()
  for (const row of visibleTree) {
    const list = siblingIds.get(row.parentId) ?? []
    list.push(row.item.id)
    siblingIds.set(row.parentId, list)
  }
  const [subDraft, setSubDraft] = useState('')
  // The collapsed card's own ＋: add a subtask without opening the editor.
  const [quickSubOpen, setQuickSubOpen] = useState(false)
  const [quickSubDraft, setQuickSubDraft] = useState('')
  const addSubtask = async (parentId: string, title: string): Promise<void> => {
    await mutate(async () => {
      const sub = await window.api.createItem({
        kind: 'task',
        title,
        status: 'active',
        projectId: item.projectId
      })
      await window.api.linkItems(sub.id, parentId, 'subtask-of')
    })
  }
  const toggleSubtask = (sub: Item): void => {
    const wasDone = sub.status === 'done'
    // Past-day views backdate, same as the card's own checkbox.
    const backdate = !wasDone && contextDate && contextDate < todayYmd()
    mutate(() =>
      window.api.updateItem(sub.id, {
        status: wasDone ? 'active' : 'done',
        ...(backdate ? { completedAt: contextDate } : {})
      })
    )
    if (!wasDone) {
      pushUndo(`Completed “${shortTitle(sub.title)}”`, async () => {
        await window.api.updateItem(sub.id, { status: 'active' })
      })
    }
  }
  const dropSubtask = (sub: Item): void => {
    mutate(() => window.api.updateItem(sub.id, { status: 'dropped' }))
    pushUndo(`Dropped “${shortTitle(sub.title)}”`, async () => {
      await window.api.updateItem(sub.id, { status: 'active' })
    })
  }
  const dropItem = (): void => {
    const prev = item.status
    patch({ status: 'dropped' })
    pushUndo(`Dropped “${shortTitle(item.title)}”`, async () => {
      await window.api.updateItem(item.id, { status: prev })
    })
  }

  // Right-click menu (task/prep only): a small in-app menu at the cursor.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // 'prep' swaps the menu body for the upcoming-meetings picker;
  // 'blocked' for the blocking-task search.
  const [menuMode, setMenuMode] = useState<'main' | 'prep' | 'blocked'>('main')
  const [blockQuery, setBlockQuery] = useState('')
  // "Remove from calendar": counted only while the menu is open; with
  // several blocks on the schedule the first click arms, second fires.
  const [removeArmed, setRemoveArmed] = useState(false)
  // "Delete task": always two-step — first click arms, second drops.
  const [dropArmed, setDropArmed] = useState(false)
  const calInstances =
    useLiveQuery(
      () => (menu && isCheckable ? window.api.calendarInstanceCount(item.id) : Promise.resolve(0)),
      [menu !== null, item.id]
    ) ?? 0
  // Label colors for the prep picker — a row wears its meeting's label
  // so the right one is findable by color, not just by reading.
  const labels = useLabels()
  // Meetings this task could prep for: the next two weeks, fetched only
  // while the picker is up (the events cache makes this instant). The
  // picker scrolls, so the list can be long without swallowing the menu.
  const prepTargets =
    useLiveQuery(
      () =>
        menu && menuMode === 'prep'
          ? window.api.calendarEvents(todayYmd(), ymdAddDays(todayYmd(), 14))
          : Promise.resolve([]),
      [menu !== null, menuMode]
    ) ?? []
  // The task's existing meeting links (📅 chips in the open editor).
  const eventLinks = (
    useLiveQuery(
      () => (open ? window.api.linksFrom(item.id) : Promise.resolve([])),
      [open, item.id]
    ) ?? []
  ).filter((l) => l.role === 'prep-for' && l.toEventKey)
  // What this task waits on (⛔). Loaded whenever the card is checkable:
  // the collapsed card wears a "blocked" pill, the open editor the chips.
  const blockers =
    useLiveQuery(
      () => (isCheckable ? window.api.blockersOf(item.id) : Promise.resolve([])),
      [item.id, isCheckable]
    ) ?? []
  const openBlockers = blockers.filter(
    (b) => b.item.status === 'active' || b.item.status === 'inbox'
  )
  // Candidate blockers as you type: open tasks matching the search,
  // minus this task itself and anything already linked.
  const blockTargets = (
    useLiveQuery(
      () =>
        menu && menuMode === 'blocked' && blockQuery.trim()
          ? window.api.search(blockQuery)
          : Promise.resolve([] as Item[]),
      [menu !== null, menuMode, blockQuery]
    ) ?? []
  ).filter(
    (t) =>
      t.kind === 'task' &&
      (t.status === 'active' || t.status === 'inbox') &&
      t.id !== item.id &&
      !blockers.some((b) => b.item.id === t.id)
  )
  useEffect(() => {
    if (!menu) {
      setRemoveArmed(false)
      setDropArmed(false)
      setMenuMode('main')
      setBlockQuery('')
    }
  }, [menu])
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    // Capture-phase, so a click anywhere else dismisses before it lands.
    const onDown = (e: PointerEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  // "Add subtask": open the editor, then steal focus to its subtask
  // input on the frame it mounts (after the title field's autoFocus).
  const wantSubtaskFocus = useRef(false)
  const subInputWrap = useRef<HTMLDivElement>(null)
  // ⏎ from the title jumps the caret straight into the notes.
  const notesRef = useRef<RichEditorHandle>(null)
  useEffect(() => {
    if (!open || !wantSubtaskFocus.current) return
    wantSubtaskFocus.current = false
    requestAnimationFrame(() => subInputWrap.current?.querySelector('input')?.focus())
  }, [open])

  /**
   * Collapse, flushing any unsaved edits first. Bound to onMouseDown
   * (not onClick): a plain click first blurs the focused field, whose
   * save re-renders the whole list and the click never lands — which
   * made expanded cards impossible to close.
   */
  const closeCard = (): void => {
    if (title !== item.title) patch({ title })
    flushBody()
    setOpen(false)
  }

  return (
    // Inside an .item-list, the 'open' class marks the row being
    // edited (a flush accent wash — it stays aligned with its
    // neighbors, no inset card-within-a-card).
    <>
      {/* Spotlight: dim everything behind the open editor so the row
          being edited is unmistakable. A sibling, not a child — inside
          the card it would paint over the card's own background. On
          mousedown (like the other collapse controls) so it beats the
          title field's on-blur re-render; closing saves, same as Esc. */}
      {open && (
        <div
          className="edit-scrim"
          onMouseDown={(e) => {
            e.preventDefault()
            closeCard()
          }}
        />
      )}
    <Card
      accentColor={project?.color}
      done={done}
      faded={faded}
      className={[open ? 'open' : '', multiSelected ? 'multi-selected' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <div
        // The whole collapsed card is the open affordance — a click
        // anywhere that isn't a control (checkbox, buttons, fields)
        // expands the editor, so nobody has to aim for the title.
        style={!open ? { cursor: 'pointer' } : undefined}
        onClick={(e) => {
          if (open) return
          const t = e.target as HTMLElement
          if (t.closest('input, button, select, textarea, label, a')) return
          if (e.metaKey || e.ctrlKey) {
            if (isCheckable) toggle(item.id)
            return
          }
          if (item.kind === 'page') openOverlay({ name: 'page', itemId: item.id })
          else setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation()
            closeCard()
          }
        }}
        onContextMenu={(e) => {
          if (!isCheckable) return // only tasks/preps get the menu
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {/* The header row of an open card collapses it again on click —
          except on its interactive parts (checkbox, title field). On
          mousedown, like the other collapse controls, so it beats the
          title field's on-blur re-render. */}
        <div
          className="row card-header"
          style={open ? { cursor: 'pointer' } : undefined}
          onClick={(e) => {
            // ⌘-click (or ctrl-click) gathers this row into the
            // multi-selection instead of opening it. Checkbox clicks
            // never bubble here, so completing stays a single gesture.
            if (!isCheckable || open) return
            if (!(e.metaKey || e.ctrlKey)) return
            e.preventDefault()
            e.stopPropagation()
            toggle(item.id)
          }}
          onMouseDown={(e) => {
            if (!open) return
            const target = e.target as HTMLElement
            if (target.closest('input, button, select, textarea, label')) return
            e.preventDefault()
            closeCard()
          }}
        >
          {isCheckable && checkboxSelects && (
            // Selection checkbox: gathers the row instead of completing
            // it — the card's multi-selected wash is what says "picked".
            <Checkbox checked={multiSelected} onToggle={() => toggle(item.id)} />
          )}
          {isCheckable && !checkboxSelects && (
            <Checkbox
              checked={done}
              onToggle={() => {
                const prev = item.status
                // Checking off while viewing a past day records the
                // completion on THAT day — you're logging what already
                // happened, not doing it now. (Future days stamp now:
                // nothing gets done in the future.)
                const backdate = !done && contextDate && contextDate < todayYmd()
                patch({
                  status: done ? 'active' : ('done' as ItemStatus),
                  ...(backdate ? { completedAt: contextDate } : {})
                })
                if (!done) {
                  pushUndo(`Completed “${shortTitle(item.title)}”`, async () => {
                    await window.api.updateItem(item.id, { status: prev })
                  })
                }
              }}
            />
          )}
          {!isCheckable && <span aria-hidden>{KIND_ICON[item.kind]}</span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            {open ? (
              <div className="row">
                <input
                  autoFocus
                  value={title}
                  style={{ flex: 1 }}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => title !== item.title && patch({ title })}
                  onKeyDown={(e) => {
                    // ⌘⏎ / ⌃⏎ / ⇧⏎ save and close the card; plain Enter
                    // commits the title and drops the caret into the notes
                    // (focusing there blurs this field, which saves).
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    if (e.metaKey || e.ctrlKey || e.shiftKey) closeCard()
                    else notesRef.current?.focus()
                  }}
                />
                <button
                  className="btn ghost"
                  title="Collapse (Esc)"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    closeCard()
                  }}
                >
                  ▴
                </button>
              </div>
            ) : (
              <button
                className={`card-title${isCheckable ? ' plain' : ''}`}
                style={{ display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left' }}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey) return // bubbles to the row's multi-select
                  // Pages open as a full document (floated overlay),
                  // not an inline editor.
                  if (item.kind === 'page') openOverlay({ name: 'page', itemId: item.id })
                  else setOpen(true)
                }}
              >
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.title || <span style={{ color: 'var(--text-faint)' }}>Untitled</span>}
                </span>
                {/* Pinned to the right edge of the title row. */}
                {item.content && (
                  <span
                    aria-hidden
                    title="has notes"
                    style={{ marginLeft: 'auto', paddingLeft: 6, fontSize: 13.5, opacity: 0.75, flexShrink: 0 }}
                  >
                    📝
                  </span>
                )}
              </button>
            )}
            <div className="card-meta">
              {item.starred && <span title="Starred — pinned in the sidebar">⭐</span>}
              {showProject && project && (
                <span className="pill" title={project.name}>
                  <ProjectDot color={project.color} /> {projectLabel(project)}
                </span>
              )}
              {showDate && item.scheduledDate && (
                <span className="pill">{prettyDate(item.scheduledDate)}</span>
              )}
              {showDuePill && item.dueDate && (
                <span className="pill">due {prettyDate(item.dueDate)}</span>
              )}
              {openBlockers.length > 0 && (
                <span
                  className="pill"
                  style={{ color: 'var(--danger)' }}
                  title={`Blocked by: ${openBlockers.map((b) => b.item.title).join(', ')}`}
                >
                  ⛔ blocked
                </span>
              )}
              {showTimePill && item.timeEstimateMinutes != null && (
                <span className="pill">~{calendarMinutes}m</span>
              )}
              {subtaskTree.length > 0 && (
                <span className="pill subtask-count" title="subtasks">
                  ☑ {subtasksDone}/{subtaskTree.length}
                </span>
              )}
            </div>
          </div>
          {/* The main task's own ＋: add a subtask without opening the
            editor — same gesture the subtask rows offer. Hidden until
            the card is hovered. When open, the editor's own add-input
            covers it. */}
          {isCheckable && !open && (
            <button
              className="btn ghost small card-add-sub"
              title="Add a subtask"
              onClick={(e) => {
                e.stopPropagation()
                setQuickSubOpen(true)
              }}
            >
              ＋
            </button>
          )}
        </div>

        {isCheckable && quickSubOpen && !open && (
          <div style={{ marginTop: 8, marginLeft: 29 }}>
            <CheckableInput
              autoFocus
              placeholder="Add a subtask…"
              value={quickSubDraft}
              onChange={(e) => setQuickSubDraft(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setQuickSubOpen(false)
                  setQuickSubDraft('')
                }
                if (e.key === 'Enter' && quickSubDraft.trim()) {
                  await addSubtask(item.id, quickSubDraft.trim())
                  setQuickSubDraft('')
                }
              }}
            />
          </div>
        )}

        {/* The subtask tree is always visible — check things off right
          from the list, no need to open the card. */}
        {isCheckable && visibleTree.length > 0 && (
          <SortableContext
            items={visibleTree.map((t) => t.item.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="subtasks" style={{ marginTop: 8 }}>
              {visibleTree.map(({ item: sub, depth, parentId }) => (
                <SubtaskRow
                  key={sub.id}
                  sub={sub}
                  depth={depth}
                  sortableIds={siblingIds.get(parentId) ?? []}
                  onToggle={toggleSubtask}
                  onDrop={dropSubtask}
                  onRename={(s, title) => mutate(() => window.api.updateItem(s.id, { title }))}
                  onAddChild={addSubtask}
                />
              ))}
            </div>
          </SortableContext>
        )}

        {open && (
          // Indented to the title's column (checkbox 19px + row gap 10px)
          // so the editor reads as one aligned block under the title.
          <div className="stack" style={{ marginTop: 12, marginLeft: 29 }}>
            {/* One notes surface that formats as you type (no separate
              preview): markdown shortcuts become real formatting. */}
            <RichEditor
              key={item.id}
              ref={notesRef}
              variant="compact"
              initialHtml={itemBodyHtml(item)}
              placeholder="Notes — type **bold**, # headings, - lists…"
              onChange={onBodyChange}
              onExit={closeCard}
            />
            {isCheckable && (
              <div ref={subInputWrap}>
                <CheckableInput
                  placeholder="Add a subtask…"
                  value={subDraft}
                  onChange={(e) => setSubDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && subDraft.trim()) {
                      addSubtask(item.id, subDraft.trim())
                      setSubDraft('')
                    }
                  }}
                />
              </div>
            )}
            {/* One line: when to do it (the 5-day rolling window, or
              someday) and which project. With many projects the picker
              drops names to just the colored dots, and the whole tail
              scrolls sideways rather than wrapping. */}
            <div className="row" style={{ gap: 6 }}>
              {(item.kind === 'task' || item.kind === 'prep') && (
                <>
                  {rollingDays().map((d) => (
                    <button
                      key={d.date}
                      className={`btn small ${item.scheduledDate === d.date ? 'primary' : ''}`}
                      style={{ flexShrink: 0 }}
                      // Scheduling an intake item is triage — it graduates
                      // to active, same as dragging it onto a day.
                      onClick={() =>
                        patch({
                          scheduledDate: d.date,
                          ...(item.status === 'inbox' ? { status: 'active' as ItemStatus } : {})
                        })
                      }
                    >
                      {d.chip}
                    </button>
                  ))}
                  <button
                    // Highlighted only once the item is really parked in the
                    // backlog — an untriaged intake item (also dateless) must
                    // not read as auto-assigned to someday.
                    className={`btn small ${item.scheduledDate === null && item.status !== 'inbox' ? 'primary' : ''}`}
                    style={{ flexShrink: 0 }}
                    title="No date — lives in the backlog until you pick a day"
                    onClick={() =>
                      patch({
                        scheduledDate: null,
                        scheduledTime: null,
                        timeEstimateMinutes: null,
                        ...(item.status === 'inbox' ? { status: 'active' as ItemStatus } : {})
                      })
                    }
                  >
                    someday
                  </button>
                  <span className="editor-divider" aria-hidden />
                </>
              )}
              <div className="editor-projects">
                <ProjectPicker
                  expanded
                  dotsOnly={projects.length > 3}
                  value={item.projectId}
                  onChange={(projectId) => patch({ projectId })}
                />
              </div>
            </div>
            {/* What this task waits on. Done blockers stay, struck
              through — the history of what gated this — and the ✕
              severs just the dependency, never the other task. */}
            {blockers.length > 0 && (
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-faint)' }}>
                  ⛔ blocked by
                </span>
                {blockers.map((b) => (
                  <span
                    key={b.link.id}
                    className="pill"
                    style={
                      b.item.status === 'done'
                        ? { textDecoration: 'line-through', opacity: 0.6 }
                        : undefined
                    }
                  >
                    {b.item.title || 'Untitled'}
                    <button
                      className="btn ghost small"
                      style={{ padding: '0 2px' }}
                      title="Unblock — remove this dependency"
                      onClick={() => mutate(() => window.api.deleteLink(b.link.id))}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* Which meetings this task preps. The name is a doorway —
              clicking it peeks the meeting right here (or opens the
              full view on screens without a peek panel); the ✕ unlinks
              without touching the task itself. */}
            {eventLinks.length > 0 && (
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {eventLinks.map((l) => (
                  <span key={l.id} className="meeting-link">
                    <button
                      className="meeting-link-name"
                      title="Peek at this meeting"
                      onClick={() => {
                        const m = {
                          eventKey: l.toEventKey!,
                          title: l.eventTitle ?? 'meeting',
                          date: l.eventDate ?? ''
                        }
                        if (peekMeeting) peekMeeting(m)
                        else openOverlay({ name: 'meeting', ...m })
                      }}
                    >
                      📅 {l.eventDate && <span className="meeting-date">{mmdd(l.eventDate)}</span>}{' '}
                      {l.eventTitle ?? 'meeting'}
                    </button>
                    <button
                      className="btn ghost small"
                      style={{ padding: '0 2px' }}
                      title="No longer prep for this meeting"
                      onClick={() =>
                        // The due date came from this meeting — it goes
                        // with the link (same rule as the context menu).
                        mutate(async () => {
                          await window.api.deleteLink(l.id)
                          await window.api.updateItem(item.id, { dueDate: null })
                        })
                      }
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <label className="pill">
                do
                <input
                  type="date"
                  value={item.scheduledDate ?? ''}
                  onChange={(e) => patch({ scheduledDate: e.target.value || null })}
                />
              </label>
              <label className="pill">
                due
                <input
                  type="date"
                  value={item.dueDate ?? ''}
                  onChange={(e) => patch({ dueDate: e.target.value || null })}
                />
              </label>
              {done && (
                <label className="pill">
                  done on
                  <input
                    type="date"
                    value={(item.completedAt ?? '').slice(0, 10)}
                    max={todayYmd()}
                    // Clearing the field is a no-op — a done task always
                    // has a completion day; uncheck it instead.
                    onChange={(e) => e.target.value && patch({ completedAt: e.target.value })}
                  />
                </label>
              )}
              {(item.kind === 'note' || item.kind === 'page') && (
                <button
                  className="btn ghost"
                  title={item.starred ? 'Unstar' : 'Star — pin it to the sidebar'}
                  onClick={() => patch({ starred: !item.starred })}
                >
                  {item.starred ? '⭐ starred' : '☆ star'}
                </button>
              )}
              {/* Two-step: first click arms, second actually drops —
                a stray click near Close can't discard the task. */}
              <ConfirmButton
                label="🗑"
                confirmLabel="drop task"
                title="Drop this item (it goes away, guilt-free)"
                style={{ marginLeft: 'auto' }}
                onConfirm={dropItem}
              />
              <button
                className="btn ghost"
                onMouseDown={(e) => {
                  e.preventDefault()
                  closeCard()
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}

        {menu && (
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              top: menu.y,
              left: menu.x,
              zIndex: 50,
              display: 'flex',
              flexDirection: 'column',
              minWidth: 160,
              padding: 4,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              boxShadow: 'var(--shadow-lift)'
            }}
          >
            {menuMode === 'prep' ? (
              <>
                <button
                  className="btn ghost small"
                  style={{ justifyContent: 'flex-start', color: 'var(--text-soft)' }}
                  onClick={() => setMenuMode('main')}
                >
                  ‹ back
                </button>
                <div
                  style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
                >
                  {prepTargets.map((ev) => {
                    // The meeting's label edge + wash — pick by color.
                    const color = labels.of(ev)
                    return (
                      <button
                        key={ev.eventKey}
                        className="btn ghost small"
                        style={{
                          justifyContent: 'flex-start',
                          flexShrink: 0,
                          borderRadius: 4,
                          borderLeft: `3px solid ${color?.hex ?? 'transparent'}`,
                          ...(color
                            ? { background: `color-mix(in srgb, ${color.hex} 10%, transparent)` }
                            : {}),
                          marginBottom: 2
                        }}
                        onClick={() => {
                          setMenu(null)
                          // The link is the whole relationship — the task keeps
                          // its kind, day, and project; the meeting's prep list
                          // and progress pick it up from here.
                          void mutate(() => window.api.linkToEvent(item.id, ev, 'prep-for'))
                        }}
                      >
                        <span className="meeting-date" style={{ marginRight: 6 }}>{mmdd(ev.date)}</span>
                        {ev.title}
                      </button>
                    )
                  })}
                </div>
                {prepTargets.length === 0 && (
                  <span style={{ padding: '4px 8px', fontSize: 13.5, color: 'var(--text-faint)' }}>
                    no meetings in the next two weeks
                  </span>
                )}
              </>
            ) : menuMode === 'blocked' ? (
              <>
                <button
                  className="btn ghost small"
                  style={{ justifyContent: 'flex-start', color: 'var(--text-soft)' }}
                  onClick={() => setMenuMode('main')}
                >
                  ‹ back
                </button>
                <input
                  autoFocus
                  placeholder="Search open tasks…"
                  value={blockQuery}
                  onChange={(e) => setBlockQuery(e.target.value)}
                  style={{ margin: '2px 4px 6px', fontSize: 13.5, minWidth: 220 }}
                />
                <div
                  style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
                >
                  {blockTargets.map((t) => (
                    <button
                      key={t.id}
                      className="btn ghost small"
                      style={{ justifyContent: 'flex-start', flexShrink: 0 }}
                      onClick={() => {
                        setMenu(null)
                        // The link is the whole relationship: this task
                        // waits until t is done (or the link is cut).
                        void mutate(() => window.api.linkItems(item.id, t.id, 'blocked-by'))
                      }}
                    >
                      {t.title || 'Untitled'}
                    </button>
                  ))}
                  {blockQuery.trim() !== '' && blockTargets.length === 0 && (
                    <span style={{ padding: '4px 8px', fontSize: 13.5, color: 'var(--text-faint)' }}>
                      no open tasks match
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <button
                  className="btn ghost small"
                  style={{ justifyContent: 'flex-start' }}
                  onClick={() => {
                    setMenu(null)
                    // Already open: the [open] effect won't refire — focus now.
                    if (open) subInputWrap.current?.querySelector('input')?.focus()
                    else {
                      wantSubtaskFocus.current = true
                      setOpen(true)
                    }
                  }}
                >
                  ＋ Add subtask
                </button>
                {unlinkId ? (
                  // Under a meeting, the useful action is the inverse: cut
                  // the link that put this card here. The due date came
                  // from that meeting, so it goes with the link — which
                  // is also why "Clear due date" hides here: clearing it
                  // while still attached would just lie about the meeting.
                  <button
                    className="btn ghost small"
                    style={{ justifyContent: 'flex-start' }}
                    onClick={() => {
                      setMenu(null)
                      void mutate(async () => {
                        await window.api.deleteLink(unlinkId)
                        await window.api.updateItem(item.id, { dueDate: null })
                      })
                    }}
                  >
                    ✕ Remove from this meeting
                  </button>
                ) : (
                  <button
                    className="btn ghost small"
                    style={{ justifyContent: 'flex-start' }}
                    onClick={() => setMenuMode('prep')}
                  >
                    📅 Prep for meeting…
                  </button>
                )}
                <button
                  className="btn ghost small"
                  style={{ justifyContent: 'flex-start' }}
                  onClick={() => setMenuMode('blocked')}
                >
                  ⛔ Blocked by…
                </button>
                {item.dueDate && !unlinkId && (
                  <button
                    className="btn ghost small"
                    style={{ justifyContent: 'flex-start' }}
                    onClick={() => {
                      setMenu(null)
                      patch({ dueDate: null })
                    }}
                  >
                    ✕ Clear due date
                  </button>
                )}
                {calInstances > 0 && (
                  <button
                    className="btn ghost small"
                    style={{
                      justifyContent: 'flex-start',
                      ...(removeArmed ? { color: 'var(--danger)' } : {})
                    }}
                    onClick={() => {
                      // Several blocks on the schedule → make sure it's meant.
                      if (calInstances > 1 && !removeArmed) {
                        setRemoveArmed(true)
                        return
                      }
                      setMenu(null)
                      void mutate(() => window.api.removeFromCalendar(item.id))
                    }}
                  >
                    {removeArmed ? `Remove all ${calInstances} instances?` : '✕ Remove from calendar'}
                  </button>
                )}
                <button
                  className="btn ghost small"
                  style={{
                    justifyContent: 'flex-start',
                    ...(dropArmed ? { color: 'var(--danger)', fontWeight: 700 } : {})
                  }}
                  onClick={() => {
                    // Two-step, like the editor's 🗑 — a stray click at
                    // the bottom of the menu can't discard the task.
                    if (!dropArmed) {
                      setDropArmed(true)
                      return
                    }
                    setMenu(null)
                    dropItem()
                  }}
                >
                  {dropArmed ? '🗑 Confirm Delete' : '🗑 Delete'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
    </>
  )
}

import { useEffect, useRef, useState } from 'react'
import { todayYmd } from '@shared/dates'
import type { Item, ItemStatus } from '@shared/types'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { useNav } from '../state/nav'
import { useSelection } from '../state/selection'
import { shortTitle, useUndo } from '../state/undo'
import { Card } from './Card'
import { CheckableInput, Checkbox, ProjectDot } from './bits'
import { ProjectPicker } from './ProjectPicker'
import { RichEditor } from './RichEditor'
import { itemBodyHtml } from '../richtext'
import { KIND_ICON, prettyDate, rollingDays } from './../format'

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
}

/**
 * One row of the subtask tree: indented by depth, checkable in place,
 * with hover actions to add a nested subtask (＋) or drop it (✕).
 */
function SubtaskRow({
  sub,
  depth,
  onToggle,
  onDrop,
  onRename,
  onAddChild
}: {
  sub: Item
  depth: number
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
  return (
    <>
      <div className="subtask-row" style={{ marginLeft: indent }}>
        <Checkbox checked={sub.status === 'done'} onToggle={() => onToggle(sub)} />
        {editing ? (
          <input
            autoFocus
            style={{ flex: 1, minWidth: 0, fontSize: 13.5, padding: '3px 8px' }}
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              setEditing(false)
              const t = titleDraft.trim()
              if (t && t !== sub.title) onRename(sub, t)
            }}
            onKeyDown={(e) => {
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
  checkboxSelects = false
}: ItemCardProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(item.title)
  const mutate = useMutate()
  const { projects } = useData()
  const { selected, toggle } = useSelection()
  const multiSelected = selected.has(item.id)
  const { openOverlay } = useNav()
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
  const subtasksDone = subtaskTree.filter(({ item: s }) => s.status === 'done').length
  // A finished subtask stays (struck through) only in the list of the
  // day it was completed; everywhere else the card shows what's left.
  const dayContext = contextDate ?? todayYmd()
  const visibleTree = subtaskTree.filter(
    ({ item: s }) => s.status !== 'done' || (s.completedAt ?? '').slice(0, 10) === dayContext
  )
  const [subDraft, setSubDraft] = useState('')
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
    mutate(() => window.api.updateItem(sub.id, { status: wasDone ? 'active' : 'done' }))
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
  // "Remove from calendar": counted only while the menu is open; with
  // several blocks on the schedule the first click arms, second fires.
  const [removeArmed, setRemoveArmed] = useState(false)
  const calInstances =
    useLiveQuery(
      () => (menu && isCheckable ? window.api.calendarInstanceCount(item.id) : Promise.resolve(0)),
      [menu !== null, item.id]
    ) ?? 0
  useEffect(() => {
    if (!menu) setRemoveArmed(false)
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
    // Inside an .item-list, the 'open' class is what lifts the row
    // being edited back into a real card.
    <Card
      accentColor={project?.color}
      done={done}
      faded={faded}
      className={[open ? 'open' : '', multiSelected ? 'multi-selected' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <div
        // Multi-selected ring: inline (no stylesheet rule for it).
        style={
          multiSelected
            ? { boxShadow: 'inset 0 0 0 2px var(--accent)', borderRadius: 8 }
            : undefined
        }
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
        className="row"
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
          // it. The accent outline says "this checks selection, not
          // done" — the card's multi-selected ring confirms it.
          <span
            style={{
              display: 'inline-flex',
              borderRadius: 6,
              outline: '1px solid var(--accent)',
              outlineOffset: 1
            }}
          >
            <Checkbox checked={multiSelected} onToggle={() => toggle(item.id)} />
          </span>
        )}
        {isCheckable && !checkboxSelects && (
          <Checkbox
            checked={done}
            onToggle={() => {
              const prev = item.status
              patch({ status: done ? 'active' : ('done' as ItemStatus) })
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
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
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
              className="card-title"
              style={{ display: 'block', width: '100%', textAlign: 'left' }}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey) return // bubbles to the row's multi-select
                // Pages open as a full document (floated overlay),
                // not an inline editor.
                if (item.kind === 'page') openOverlay({ name: 'page', itemId: item.id })
                else setOpen(true)
              }}
            >
              {item.title || <span style={{ color: 'var(--text-faint)' }}>Untitled</span>}
            </button>
          )}
          <div className="card-meta">
            {item.starred && <span title="Starred — pinned in the sidebar">⭐</span>}
            {showProject && project && (
              <span className="pill">
                <ProjectDot color={project.color} /> {project.name}
              </span>
            )}
            {showDate && item.scheduledDate && (
              <span className="pill">{prettyDate(item.scheduledDate)}</span>
            )}
            {item.dueDate && <span className="pill">due {prettyDate(item.dueDate)}</span>}
            {item.timeEstimateMinutes != null && (
              <span className="pill">~{item.timeEstimateMinutes}m</span>
            )}
            {subtaskTree.length > 0 && (
              <span className="pill" title="subtasks">
                ☑ {subtasksDone}/{subtaskTree.length}
              </span>
            )}
            {/* Right-aligned so notes are spottable at a glance. */}
            {!open && item.content && (
              <span title="has notes" style={{ marginLeft: 'auto' }}>
                📄
              </span>
            )}
          </div>
        </div>
      </div>

      {/* The subtask tree is always visible — check things off right
          from the list, no need to open the card. */}
      {isCheckable && visibleTree.length > 0 && (
        <div className="subtasks" style={{ marginTop: 8 }}>
          {visibleTree.map(({ item: sub, depth }) => (
            <SubtaskRow
              key={sub.id}
              sub={sub}
              depth={depth}
              onToggle={toggleSubtask}
              onDrop={dropSubtask}
              onRename={(s, title) => mutate(() => window.api.updateItem(s.id, { title }))}
              onAddChild={addSubtask}
            />
          ))}
        </div>
      )}

      {open && (
        <div className="stack" style={{ marginTop: 12 }}>
          {/* One notes surface that formats as you type (no separate
              preview): markdown shortcuts become real formatting. */}
          <RichEditor
            key={item.id}
            variant="compact"
            initialHtml={itemBodyHtml(item)}
            placeholder="Notes — type **bold**, # headings, - lists…"
            onChange={onBodyChange}
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
          {/* When to do it: the 5-day rolling window, or someday. */}
          {(item.kind === 'task' || item.kind === 'prep') && (
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {rollingDays().map((d) => (
                <button
                  key={d.date}
                  className={`btn small ${item.scheduledDate === d.date ? 'primary' : ''}`}
                  onClick={() => patch({ scheduledDate: d.date })}
                >
                  {d.chip}
                </button>
              ))}
              <button
                className={`btn small ${item.scheduledDate === null ? 'primary' : ''}`}
                title="No date — lives in the backlog until you pick a day"
                onClick={() => patch({ scheduledDate: null, scheduledTime: null, timeEstimateMinutes: null })}
              >
                someday
              </button>
            </div>
          )}
          <ProjectPicker
            value={item.projectId}
            onChange={(projectId) => patch({ projectId })}
          />
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
            {(item.kind === 'note' || item.kind === 'page') && (
              <button
                className="btn ghost"
                title={item.starred ? 'Unstar' : 'Star — pin it to the sidebar'}
                onClick={() => patch({ starred: !item.starred })}
              >
                {item.starred ? '⭐ starred' : '☆ star'}
              </button>
            )}
            <button
              className="btn ghost"
              title="Drop this item (it goes away, guilt-free)"
              style={{ marginLeft: 'auto' }}
              onClick={dropItem}
            >
              🗑 drop
            </button>
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
          {item.dueDate && (
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
            style={{ justifyContent: 'flex-start' }}
            onClick={() => {
              setMenu(null)
              dropItem()
            }}
          >
            🗑 Delete task
          </button>
        </div>
      )}
      </div>
    </Card>
  )
}

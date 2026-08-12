import { Fragment, useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Item, Project, Section } from '@shared/types'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { ItemCard } from './ItemCard'
import { DraggableCard, DropZone, SortableCard, usePendingOrder } from './dnd'
import { CheckableInput, ProjectDot } from './bits'
import { NewSectionInput } from './SectionGroups'

interface TaskGroupsProps {
  items: Item[]
  /** The day these tasks belong to — block drops keep this date. */
  date: string
  /** Per-group drag-to-reorder (used by Top tasks). */
  sortable?: boolean
  /** Rendered inside the last group (e.g. 'Show all'), folding with it. */
  footer?: React.ReactNode
  /**
   * Page-level "collapse all / expand all": each seq bump folds or
   * unfolds every block at once. Individual headers still toggle
   * freely afterwards — this is a broadcast, not a lock.
   */
  fold?: { seq: number; collapsed: boolean }
}

/**
 * A day's task list, broken into one block per project (sidebar order,
 * 'No project' last). Each block is itself a drop target: dragging a
 * card from 'No project' (or anywhere else) onto a project's block
 * files it into that project on this same day. The surrounding section
 * names the day and the block names the project, so cards hide both
 * pills. If nothing has a project, the list renders flat.
 */
export function TaskGroups({
  items,
  date,
  sortable = false,
  footer,
  fold
}: TaskGroupsProps): React.JSX.Element {
  const { projects } = useData()
  // Sections for every project, so each block can separate its tasks
  // under the same section names as the project's own page.
  const sectionsByProject = useLiveQuery(async () => {
    const lists = await Promise.all(projects.map((p) => window.api.listSections(p.id)))
    return new Map(projects.map((p, i) => [p.id, lists[i]]))
  }, [projects])
  // Tasks waiting on another task hide by default; each block's ⛔
  // chip says how many are tucked away and toggles them back inline
  // (they render in their normal section slots, wearing their pill).
  const blockedSet = new Set(useLiveQuery(() => window.api.blockedTaskIds(), []) ?? [])
  const [blockedShown, setBlockedShown] = useState<Set<string>>(new Set())
  const toggleBlockedShown = (key: string): void =>
    setBlockedShown((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  // Empty sections hide the same way; each block's ∅ chip reveals
  // them (they come back as drop targets at the bottom of the block).
  const [emptyShown, setEmptyShown] = useState<Set<string>>(new Set())
  const toggleEmptyShown = (key: string): void =>
    setEmptyShown((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  // A busy project can fold away so the rest of the day is scannable.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // The page's collapse-all/expand-all control: each bump overwrites
  // every block's fold state in one stroke.
  useEffect(() => {
    if (!fold || fold.seq === 0) return
    setCollapsed(fold.collapsed ? new Set([...projects.map((p) => p.id), 'none']) : new Set())
    // Deliberately only the bump: a projects change must not replay the
    // last broadcast over folds the user has since toggled by hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fold?.seq])
  const toggle = (key: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  // The project whose inline "add a task" input is open, if any.
  const [adding, setAdding] = useState<string | null>(null)
  // Same, for the "＋ section" name input (creates a section in that
  // project — the grouping lives on its project page).
  const [addingSection, setAddingSection] = useState<string | null>(null)
  const unfold = (key: string): void =>
    // Adding to a folded block would type into nothing — unfold it.
    setCollapsed((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  const openAdder = (key: string): void => {
    setAdding((cur) => (cur === key ? null : key))
    unfold(key)
  }
  const openSectionAdder = (key: string): void => {
    setAddingSection((cur) => (cur === key ? null : key))
    // The section about to be created is empty — it must not be born hidden.
    setEmptyShown((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
    unfold(key)
  }

  // While a drag-reorder is persisting, `items` still carries the old DB
  // order (the IPC write + refresh hasn't landed) but dnd-kit's sortable
  // transforms have already reset — show the pending order immediately so
  // the dropped card doesn't jump back. Ids outside the pending list keep
  // their DB positions.
  const pendingOrder = usePendingOrder()
  let ordered = items
  if (pendingOrder) {
    const rank = new Map(pendingOrder.map((id, i) => [id, i]))
    const moved = items
      .filter((i) => rank.has(i.id))
      .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
    let n = 0
    ordered = items.map((i) => (rank.has(i.id) ? moved[n++] : i))
  }

  const groups: Array<{ key: string; project: Project | null; items: Item[] }> = []
  for (const p of projects) {
    const inProject = ordered.filter((i) => i.projectId === p.id)
    if (inProject.length > 0) groups.push({ key: p.id, project: p, items: inProject })
  }
  // No project, or the project was archived: one trailing block.
  const unassigned = ordered.filter((i) => !projects.some((p) => p.id === i.projectId))
  if (unassigned.length > 0) groups.push({ key: 'none', project: null, items: unassigned })

  const showHeaders = groups.some((g) => g.project !== null)

  return (
    <>
      {groups.map((group, gi) => {
        // Blocked tasks stay filtered out until this block's ⛔ chip
        // reveals them — hidden, they still hold the group open so the
        // chip has somewhere to live.
        const blockedIn = group.items.filter((i) => blockedSet.has(i.id))
        const shown = blockedShown.has(group.key)
          ? group.items
          : group.items.filter((i) => !blockedSet.has(i.id))

        // The same shape as the project page: one slice per section,
        // then unfiled tasks under the automatic "General" header,
        // then the day's empty sections — tucked away until the ∅
        // chip shows them (at the bottom, as drop targets). Sort
        // within each slice is untouched.
        const sections = group.project ? (sectionsByProject?.get(group.project.id) ?? []) : []
        const known = new Set(sections.map((s) => s.id))
        const filled: Array<{ section: Section | null; items: Item[] }> = []
        const empty: Array<{ section: Section | null; items: Item[] }> = []
        for (const s of sections) {
          const inSection = shown.filter((i) => i.sectionId === s.id)
          // An archived section still names the tasks filed in it, but
          // empty it offers nothing — no drop target, no header.
          if (inSection.length > 0) filled.push({ section: s, items: inSection })
          else if (s.status === 'active') empty.push({ section: s, items: inSection })
        }
        const unfiled = shown.filter((i) => !i.sectionId || !known.has(i.sectionId))
        const subgroups = [
          ...filled,
          ...(unfiled.length > 0 ? [{ section: null, items: unfiled }] : []),
          ...(emptyShown.has(group.key) ? empty : [])
        ]
        const sectioned = sections.length > 0

        const blockedChip =
          blockedIn.length > 0 ? (
            <span
              className={`task-group-add task-group-blocked ${blockedShown.has(group.key) ? 'on' : ''}`}
              role="button"
              aria-label={blockedShown.has(group.key) ? 'Hide blocked tasks' : 'Show blocked tasks'}
              title={
                blockedShown.has(group.key)
                  ? 'Hide blocked tasks'
                  : `Show ${blockedIn.length} blocked ${blockedIn.length === 1 ? 'task' : 'tasks'}`
              }
              onClick={(e) => {
                e.stopPropagation()
                toggleBlockedShown(group.key)
              }}
            >
              ⛔ {blockedIn.length}
            </span>
          ) : null

        // Same idea for empty sections, but wordless — hidden sections
        // are only structure, not work, so no count to report.
        const emptyChip =
          empty.length > 0 ? (
            <span
              className={`task-group-add task-group-empty ${emptyShown.has(group.key) ? 'on' : ''}`}
              role="button"
              aria-label={emptyShown.has(group.key) ? 'Hide empty sections' : 'Show empty sections'}
              title={
                emptyShown.has(group.key)
                  ? 'Hide empty sections'
                  : `Show ${empty.length} empty ${empty.length === 1 ? 'section' : 'sections'}`
              }
              onClick={(e) => {
                e.stopPropagation()
                toggleEmptyShown(group.key)
              }}
            >
              {/* Crossed out while they're hidden; a plain circle once shown. */}
              {emptyShown.has(group.key) ? '○' : '∅'}
            </span>
          ) : null

        const cardsFor = (list: Item[], ids: string[]): React.JSX.Element => (
          <div className={`item-list ${showHeaders ? 'task-group-indent' : ''}`}>
            <AnimatePresence initial={false}>
              {list.map((item) =>
                sortable ? (
                  <SortableCard key={item.id} item={item} sortableIds={ids}>
                    <ItemCard item={item} showProject={false} showDate={false} contextDate={date} />
                  </SortableCard>
                ) : (
                  <DraggableCard key={item.id} item={item}>
                    <ItemCard item={item} showProject={false} showDate={false} contextDate={date} />
                  </DraggableCard>
                )
              )}
            </AnimatePresence>
          </div>
        )

        const body = subgroups.map((sg) => {
          const ids = sg.items.map((i) => i.id)
          const cards = cardsFor(sg.items, ids)
          // Reorders stay within one slice; dragging across slices is
          // a cross-list drop and files into the target's section.
          const listed = sortable ? (
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {cards}
            </SortableContext>
          ) : (
            cards
          )
          // No sections in play: exactly the old flat block.
          if (!sectioned) return <Fragment key="flat">{listed}</Fragment>
          // The gap only earns its keep when sections actually sit above.
          const gap = !sg.section && filled.length > 0 ? ' unsectioned' : ''
          return (
            <DropZone
              key={sg.section?.id ?? 'none'}
              id={`sec-${date}-${group.key}-${sg.section?.id ?? 'none'}`}
              data={{
                type: 'section',
                projectId: group.project!.id,
                sectionId: sg.section?.id ?? null,
                date
              }}
              className={`task-subgroup${gap}`}
            >
              <div
                className={`section-subhead ${sg.items.length === 0 ? 'empty ' : ''}${showHeaders ? 'task-group-indent' : ''}`}
              >
                {sg.section?.name ?? 'General'}
              </div>
              {sg.items.length > 0 && listed}
            </DropZone>
          )
        })
        return (
          <DropZone
            key={group.key}
            id={`pg-${date}-${group.key}`}
            data={{ type: 'project-schedule', projectId: group.project?.id ?? null, date }}
            className="task-group"
          >
            {showHeaders && (
              <button className="task-group-header" onClick={() => toggle(group.key)}>
                {/* The caret gets its own element: two adjacent text
                    nodes merge into one flex item and lose the gap. */}
                <span aria-hidden>{collapsed.has(group.key) ? '▸' : '▾'}</span>
                {group.project ? (
                  <>
                    <ProjectDot color={group.project.color} /> {group.project.name}
                  </>
                ) : (
                  'No project'
                )}
                {/* A span, not a nested button — add a task straight into
                    this project on this day without leaving the list. */}
                {group.project && (
                  <span
                    className="task-group-add"
                    role="button"
                    aria-label={`Add a task to ${group.project.name}`}
                    title={`Add a task to ${group.project.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      openAdder(group.key)
                    }}
                  >
                    ＋
                  </span>
                )}
                {blockedChip}
                {emptyChip}
                {collapsed.has(group.key) && <span className="pill">{shown.length}</span>}
                {group.project && (
                  <span
                    className="task-group-add task-group-add-section"
                    role="button"
                    aria-label={`Add a section to ${group.project.name}`}
                    title={`Add a section to ${group.project.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      openSectionAdder(group.key)
                    }}
                  >
                    ＋ section
                  </span>
                )}
              </button>
            )}
            {/* No headers to carry the chip (nothing has a project):
                give it a small row of its own. */}
            {!showHeaders && blockedChip && <div className="row">{blockedChip}</div>}
            {(!showHeaders || !collapsed.has(group.key)) && (
              <>
                {addingSection === group.key && group.project && (
                  <div className={showHeaders ? 'task-group-indent' : undefined}>
                    <NewSectionInput
                      projectId={group.project.id}
                      onClose={() => setAddingSection(null)}
                    />
                  </div>
                )}
                {adding === group.key && (
                  <div className={showHeaders ? 'task-group-indent' : undefined}>
                    <GroupAdder
                      projectId={group.project?.id ?? null}
                      date={date}
                      onClose={() => setAdding(null)}
                    />
                  </div>
                )}
                {body}
                {gi === groups.length - 1 && footer}
              </>
            )}
          </DropZone>
        )
      })}
    </>
  )
}

/**
 * Inline "add a task" for one project block: types straight into that
 * project on this day. Stays focused after each add for rapid entry;
 * an empty Enter/Escape/blur closes it.
 */
function GroupAdder({
  projectId,
  date,
  onClose
}: {
  projectId: string | null
  date: string
  onClose: () => void
}): React.JSX.Element {
  const mutate = useMutate()
  const [draft, setDraft] = useState('')
  const add = async (): Promise<void> => {
    const title = draft.trim()
    if (!title) {
      onClose()
      return
    }
    await mutate(() =>
      window.api.createItem({ kind: 'task', title, status: 'active', projectId, scheduledDate: date })
    )
    setDraft('')
  }
  return (
    <CheckableInput
      autoFocus
      placeholder="Add a task…"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void add()
        else if (e.key === 'Escape') onClose()
      }}
      onBlur={() => !draft.trim() && onClose()}
    />
  )
}

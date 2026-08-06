import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Item, Project } from '@shared/types'
import { useData, useMutate } from '../state/data'
import { ItemCard } from './ItemCard'
import { DraggableCard, DropZone, SortableCard, usePendingOrder } from './dnd'
import { CheckableInput, ProjectDot } from './bits'

interface TaskGroupsProps {
  items: Item[]
  /** The day these tasks belong to — block drops keep this date. */
  date: string
  /** Per-group drag-to-reorder (used by Top tasks). */
  sortable?: boolean
  /** Rendered inside the last group (e.g. 'Show all'), folding with it. */
  footer?: React.ReactNode
}

/**
 * A day's task list, broken into one block per project (sidebar order,
 * 'No project' last). Each block is itself a drop target: dragging a
 * card from 'No project' (or anywhere else) onto a project's block
 * files it into that project on this same day. The surrounding section
 * names the day and the block names the project, so cards hide both
 * pills. If nothing has a project, the list renders flat.
 */
export function TaskGroups({ items, date, sortable = false, footer }: TaskGroupsProps): React.JSX.Element {
  const { projects } = useData()
  // A busy project can fold away so the rest of the day is scannable.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (key: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  // The project whose inline "add a task" input is open, if any.
  const [adding, setAdding] = useState<string | null>(null)
  const openAdder = (key: string): void => {
    setAdding((cur) => (cur === key ? null : key))
    // Adding to a folded block would type into nothing — unfold it.
    setCollapsed((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
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
        const ids = group.items.map((i) => i.id)
        const cards = (
          <div className={`item-list ${showHeaders ? 'task-group-indent' : ''}`}>
            <AnimatePresence initial={false}>
              {group.items.map((item) =>
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
        const body = sortable ? (
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {cards}
          </SortableContext>
        ) : (
          cards
        )
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
                {collapsed.has(group.key) && <span className="pill">{group.items.length}</span>}
              </button>
            )}
            {(!showHeaders || !collapsed.has(group.key)) && (
              <>
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

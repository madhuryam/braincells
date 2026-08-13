import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { CalendarEvent, Item, Project } from '@shared/types'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { Checkbox, ProjectDot } from './bits'

/** One pickable row: a task (or subtask, indented by its depth). */
interface Row {
  depth: number
  item: Item
}

/**
 * The prep picker: attach existing tasks to a meeting (opened from the
 * ＋ beside the Prep label). Two live sections — what already preps
 * this meeting, and every other open task, whatever day it's on (or
 * none) — each mirroring the Today list's look: one block per project
 * (sidebar order, 'No project' last), the header wearing the dot, the
 * rows indented beneath it, subtasks nested under their parent and
 * individually pickable. Checking links, unchecking unlinks; each
 * click saves immediately, so rows move between the sections as you
 * work and closing is just closing.
 */
export function PrepPicker({
  event,
  onClose
}: {
  event: CalendarEvent
  onClose: () => void
}): React.JSX.Element {
  const preps = useLiveQuery(() => window.api.itemsForEvent(event.eventKey, 'prep-for'), [event.eventKey]) ?? []
  const tree = useLiveQuery(() => window.api.openTaskTree(), []) ?? []
  const mutate = useMutate()
  const [query, setQuery] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const linkedIds = new Set(preps.map((p) => p.item.id))
  const matches = (i: Item): boolean => i.title.toLowerCase().includes(query.trim().toLowerCase())
  // The linked section carries each row's link id so unchecking can
  // sever exactly that link.
  const linkOf = new Map(preps.map((p) => [p.item.id, p.link.id]))

  const add = (item: Item): void => {
    mutate(async () => {
      await window.api.linkToEvent(item.id, event, 'prep-for')
      // Prep is a commitment on a real day — untriaged tasks graduate,
      // same as every other way of attaching prep.
      if (item.status === 'inbox') await window.api.updateItem(item.id, { status: 'active' })
    })
  }
  const remove = (item: Item): void => {
    mutate(async () => {
      await window.api.deleteLink(linkOf.get(item.id)!)
      // The due date came from this meeting — it goes with the link
      // (same rule as the card's ✕ and the context menu).
      await window.api.updateItem(item.id, { dueDate: null })
    })
  }

  return (
    <motion.div
      className="hotkeys-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <motion.div
        className="hotkeys-modal prep-picker"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <div className="row" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0, flex: 1, minWidth: 0 }}>Prep for “{event.title}”</h2>
          <button className="btn ghost icon-btn" title="Close (Esc)" onClick={onClose}>
            ✕
          </button>
        </div>
        <input
          autoFocus
          placeholder="Filter tasks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="section-label" style={{ marginTop: 12 }}>
          Prep for this meeting
        </div>
        <ProjectBlocks
          rows={preps.map((p) => ({ depth: 0, item: p.item }))}
          show={matches}
          checked
          onToggle={remove}
          empty="nothing yet — pick from below"
        />

        <div className="section-label" style={{ marginTop: 12 }}>
          All tasks
        </div>
        <ProjectBlocks
          rows={tree}
          show={(i) => !linkedIds.has(i.id) && matches(i)}
          checked={false}
          onToggle={add}
          empty={query ? 'no open tasks match' : 'no other open tasks'}
        />
      </motion.div>
    </motion.div>
  )
}

/**
 * The Today list's shape, read-only: one block per project in sidebar
 * order, 'No project' trailing, flat when nothing has a project. The
 * header only labels (the .static variant — the checkboxes do the
 * work here), so rows drop their project pill just like Today's cards.
 * A subtask files under its ROOT's project (its own projectId belongs
 * to the parent), so subtrees never split across blocks.
 */
function ProjectBlocks({
  rows,
  show,
  checked,
  onToggle,
  empty
}: {
  rows: Row[]
  /** Row filter (search query, already-linked) — applied after grouping,
   *  so a subtask keeps its root's block even when the root is hidden. */
  show: (item: Item) => boolean
  checked: boolean
  onToggle: (item: Item) => void
  empty: string
}): React.JSX.Element {
  const { projects } = useData()

  // Tree order guarantees each root precedes its subtree — carry the
  // current root's project across its descendants, then filter.
  let rootProjectId: string | null = null
  const visible: Array<Row & { rootProjectId: string | null }> = []
  for (const r of rows) {
    if (r.depth === 0) rootProjectId = r.item.projectId
    if (show(r.item)) visible.push({ ...r, rootProjectId })
  }
  if (visible.length === 0) return <div className="picker-empty">{empty}</div>

  const groups: Array<{ key: string; project: Project | null; rows: typeof visible }> = []
  for (const p of projects) {
    const inProject = visible.filter((r) => r.rootProjectId === p.id)
    if (inProject.length > 0) groups.push({ key: p.id, project: p, rows: inProject })
  }
  const unassigned = visible.filter((r) => !projects.some((p) => p.id === r.rootProjectId))
  if (unassigned.length > 0) groups.push({ key: 'none', project: null, rows: unassigned })
  const showHeaders = groups.some((g) => g.project !== null)

  return (
    <>
      {groups.map((group) => (
        <div key={group.key} className="task-group">
          {showHeaders && (
            <div className="task-group-header static">
              {group.project ? (
                <>
                  <ProjectDot color={group.project.color} /> {group.project.name}
                </>
              ) : (
                'No project'
              )}
            </div>
          )}
          <div className={showHeaders ? 'task-group-indent' : undefined}>
            {group.rows.map((r) => (
              <PickerRow
                key={r.item.id}
                item={r.item}
                depth={r.depth}
                checked={checked}
                onToggle={() => onToggle(r.item)}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

function PickerRow({
  item,
  depth,
  checked,
  onToggle
}: {
  item: Item
  depth: number
  checked: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    // Same indent step as the cards' subtask rows. No date pill —
    // picking prep is about the work, not when it was penciled in.
    <div className="picker-row" style={depth > 0 ? { marginLeft: depth * 22 } : undefined} onClick={onToggle}>
      <Checkbox checked={checked} onToggle={onToggle} />
      <span className="picker-row-title">{item.title || 'Untitled'}</span>
    </div>
  )
}

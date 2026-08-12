import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { Item, Project } from '@shared/types'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { Card } from './Card'
import { ItemCard } from './ItemCard'
import { Checkbox, ProjectDot } from './bits'

function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
const fmtMins = (m: number): string =>
  m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`

/**
 * Everything finished on one day: standalone done items as full cards,
 * plus each still-in-progress parent's finished subtasks grouped under
 * the parent's name. One element shared by Today's "Done" section and
 * the weekly log, so "what got done" reads the same everywhere —
 * lineage kept, checkboxes uncheckable in place if one was a misclick.
 *
 * Same shape as the day's task list: one block per project (sidebar
 * order, 'No project' last), the header names the project, so cards
 * skip the project pill. If nothing has a project, the list is flat.
 */
export function DoneList({ date }: { date: string }): React.JSX.Element {
  const { projects } = useData()
  const done = useLiveQuery(() => window.api.completedOn(date), [date]) ?? []
  // Subtasks finished this day show grouped under their parent's name,
  // not as orphan cards.
  const doneSubs = useLiveQuery(() => window.api.completedSubtasksOn(date), [date]) ?? []
  const doneSubIds = new Set(doneSubs.map((d) => d.item.id))
  const standalone = done.filter((i) => !doneSubIds.has(i.id))
  // A parent finished this day shows its subtasks on its own done card
  // — repeating them as a group would show the same work twice. Every
  // other parent gets a group here: this is now the ONLY place a
  // finished subtask appears (the active parent's card hides them).
  const doneIds = new Set(done.map((i) => i.id))
  const roots = [
    ...new Map(
      doneSubs
        .filter((d) => !doneIds.has(d.rootId))
        .map((d) => [d.rootId, { rootTitle: d.rootTitle, rootProjectId: d.rootProjectId }])
    ).entries()
  ]

  // How the day's hours split per project: the summed estimates of the
  // day's done work, plus every meeting filed into (or auto-labeled to)
  // that project. Meetings come from the live calendar; their project
  // comes from the meetings table.
  const events = useLiveQuery(() => window.api.calendarEvents(date, date), [date]) ?? []
  const timedEvents = events.filter((e) => e.startTime && e.endTime)
  const eventKeys = timedEvents.map((e) => e.eventKey).join(',')
  const meetingRows =
    useLiveQuery(
      () => (eventKeys ? window.api.meetingsByKeys(eventKeys.split(',')) : Promise.resolve([])),
      [eventKeys]
    ) ?? []
  const known = new Set(projects.map((p) => p.id))
  const meetingProject = new Map(meetingRows.map((m) => [m.eventKey, m.projectId]))
  const meetingMins = new Map<string, number>() // project id (or 'none') → minutes
  for (const e of timedEvents) {
    const mins = toMin(e.endTime!) - toMin(e.startTime!)
    if (mins <= 0) continue
    const pid = meetingProject.get(e.eventKey)
    const key = pid && known.has(pid) ? pid : 'none'
    meetingMins.set(key, (meetingMins.get(key) ?? 0) + mins)
  }
  // A finished subtask's estimate counts toward its parent's project.
  const subMinsByRoot = new Map<string, number>()
  for (const d of doneSubs) {
    subMinsByRoot.set(d.rootId, (subMinsByRoot.get(d.rootId) ?? 0) + (d.item.timeEstimateMinutes ?? 0))
  }

  // One block per project; subtask groups file under their PARENT's
  // project — the finished piece belongs where the work lives. A
  // project with only meeting time still gets a block: the day was
  // spent on it even if no task got checked off.
  const blocks: Array<{
    key: string
    project: Project | null
    items: Item[]
    roots: Array<{ rootId: string; rootTitle: string }>
    taskMins: number
    meetMins: number
  }> = []
  const makeBlock = (
    key: string,
    project: Project | null,
    items: Item[],
    own: Array<{ rootId: string; rootTitle: string }>
  ): void => {
    const taskMins =
      items.reduce((sum, i) => sum + (i.timeEstimateMinutes ?? 0), 0) +
      own.reduce((sum, r) => sum + (subMinsByRoot.get(r.rootId) ?? 0), 0)
    const meetMins = meetingMins.get(key) ?? 0
    if (items.length > 0 || own.length > 0 || meetMins > 0) {
      blocks.push({ key, project, items, roots: own, taskMins, meetMins })
    }
  }
  for (const p of projects) {
    makeBlock(
      p.id,
      p,
      standalone.filter((i) => i.projectId === p.id),
      roots
        .filter(([, r]) => r.rootProjectId === p.id)
        .map(([rootId, r]) => ({ rootId, rootTitle: r.rootTitle }))
    )
  }
  makeBlock(
    'none',
    null,
    standalone.filter((i) => !i.projectId || !known.has(i.projectId)),
    roots
      .filter(([, r]) => !r.rootProjectId || !known.has(r.rootProjectId))
      .map(([rootId, r]) => ({ rootId, rootTitle: r.rootTitle }))
  )

  const showHeaders = blocks.some((b) => b.project !== null)

  return (
    <>
      {blocks.map((block) => (
        <div key={block.key} className="task-group">
          {showHeaders && (
            <div className="task-group-header static">
              {block.project ? (
                <>
                  <ProjectDot color={block.project.color} /> {block.project.name}
                </>
              ) : (
                'No project'
              )}
              {(block.taskMins > 0 || block.meetMins > 0) && (
                <TimeSplit taskMins={block.taskMins} meetMins={block.meetMins} />
              )}
            </div>
          )}
          <div className={`item-list ${showHeaders ? 'task-group-indent' : ''}`}>
            <AnimatePresence initial={false}>
              {block.items.map((item) => (
                // contextDate: ticking a leftover subtask inside a done
                // card on a past day's view logs it on THAT day, like
                // every other checkbox on the page.
                <ItemCard
                  key={item.id}
                  item={item}
                  showProject={false}
                  showDate={false}
                  contextDate={date}
                />
              ))}
            </AnimatePresence>
            {block.roots.map(({ rootId, rootTitle }) => (
              <DoneSubtaskGroup key={rootId} rootId={rootId} rootTitle={rootTitle} date={date} />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

/**
 * Where the day's hours went for one project: one combined figure at
 * rest (done-task time + meeting time); a click flips it to the
 * task-vs-meeting breakdown and back.
 */
function TimeSplit({ taskMins, meetMins }: { taskMins: number; meetMins: number }): React.JSX.Element {
  const [split, setSplit] = useState(false)
  return (
    <button
      className="btn ghost small"
      style={{
        marginLeft: 'auto',
        fontWeight: 400,
        fontSize: 13,
        color: 'var(--text-soft)',
        whiteSpace: 'nowrap'
      }}
      title={split ? 'Show total' : 'Show tasks vs meetings'}
      onClick={() => setSplit(!split)}
    >
      {split
        ? [
            taskMins > 0 && `⏱ ${fmtMins(taskMins)} tasks`,
            meetMins > 0 && `📅 ${fmtMins(meetMins)} meetings`
          ]
            .filter(Boolean)
            .join(' · ')
        : `⏱ ${fmtMins(taskMins + meetMins)}`}
    </button>
  )
}

/**
 * One parent task's subtasks finished on `date`, in true tree order.
 * Unfinished intermediate levels are skipped, so each row indents
 * under its nearest *shown* ancestor — a lone grandchild sits at the
 * first level rather than appearing to belong to an unrelated sibling.
 */
function DoneSubtaskGroup({
  rootId,
  rootTitle,
  date
}: {
  rootId: string
  rootTitle: string
  date: string
}): React.JSX.Element {
  const tree = useLiveQuery(() => window.api.subtaskTreeOf(rootId), [rootId]) ?? []
  const mutate = useMutate()

  const shown = tree.filter(
    ({ item }) => item.status === 'done' && (item.completedAt ?? '').slice(0, 10) === date
  )
  const shownIds = new Set(shown.map((s) => s.item.id))
  const parentOf = new Map(tree.map((t) => [t.item.id, t.parentId]))
  const depthOf = (id: string): number => {
    let p = parentOf.get(id)
    while (p && p !== rootId) {
      if (shownIds.has(p)) return depthOf(p) + 1
      p = parentOf.get(p)
    }
    return 1
  }

  return (
    <Card>
      <div className="row">
        <span aria-hidden style={{ color: 'var(--text-faint)', fontWeight: 700 }}>✓</span>
        <span className="card-title">{rootTitle}</span>
        <span className="pill" style={{ marginLeft: 'auto' }}>
          subtasks
        </span>
      </div>
      <div className="subtasks" style={{ marginTop: 8 }}>
        {shown.map(({ item: sub }) => (
          <div key={sub.id} className="subtask-row" style={{ marginLeft: (depthOf(sub.id) - 1) * 22 }}>
            <Checkbox
              checked
              onToggle={() => mutate(() => window.api.updateItem(sub.id, { status: 'active' }))}
            />
            <span className="subtask-title done">{sub.title}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

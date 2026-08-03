import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { todayYmd } from '@shared/dates'
import { useLiveQuery, useMutate } from '../state/data'
import { useNav } from '../state/nav'
import { useUndo } from '../state/undo'
import { ItemCard } from '../components/ItemCard'
import { TaskGroups } from '../components/TaskGroups'
import { DraggableCard, DropZone } from '../components/dnd'
import { Timeline } from '../components/Timeline'
import { CheckableInput, EmptyState } from '../components/bits'
import { longDate, rollingDays, type RollingDay } from '../format'

const TOP_TASK_CAP = 5 // soft cap — never a hard limit (SPEC §4.1)

export function Today(): React.JSX.Element {
  const today = todayYmd()
  const tasks = useLiveQuery(() => window.api.tasksFor(today), [today]) ?? []
  const doneToday = useLiveQuery(() => window.api.completedOn(today), [today]) ?? []
  const carried = useLiveQuery(() => window.api.carriedOver(today), [today]) ?? []
  const [showDone, setShowDone] = useState(true)
  const inboxCount = useLiveQuery(() => window.api.inboxCount(), []) ?? 0
  const mutate = useMutate()
  const { navigate } = useNav()
  const { pushUndo } = useUndo()
  const [taskDraft, setTaskDraft] = useState('')
  const [showAll, setShowAll] = useState(false)

  const visibleTasks = showAll ? tasks : tasks.slice(0, TOP_TASK_CAP)

  // Straight onto today's list — no inbox detour for things you
  // already know are tasks for today.
  const addTask = async (): Promise<void> => {
    const title = taskDraft.trim()
    if (!title) return
    await mutate(() =>
      window.api.createItem({ kind: 'task', title, status: 'active', scheduledDate: today })
    )
    setTaskDraft('')
  }

  return (
    <div className="canvas">
      <header className="canvas-header">
        <h1>Today</h1>
        <span className="date">{longDate(today)}</span>
        {inboxCount > 0 && (
          <button className="btn" onClick={() => navigate({ name: 'inbox' })}>
            📥 {inboxCount} to triage
          </button>
        )}
      </header>

      <div className="today-grid">
        {/* Left column: tasks for the rolling 5-day window. (The old
            "Capture anything" input is gone — the task quick-add below
            and ⌥Space capture cover both cases.) */}
        <section>
          <DropZone id="list-today" data={{ type: 'schedule', date: today }}>
            <div className="section-label">Top tasks</div>
            <div style={{ marginBottom: 10 }}>
              <CheckableInput
                id="quick-capture"
                placeholder="Add a task for today (⌘N)…"
                value={taskDraft}
                onChange={(e) => setTaskDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTask()}
              />
            </div>
            {tasks.length === 0 && (
              <EmptyState art="🪷">
                A clean slate. Add a task above, pull one from the inbox — or just enjoy it.
              </EmptyState>
            )}
            {/* One block per project; drag to reprioritize within a block. */}
            <TaskGroups items={visibleTasks} date={today} sortable />
          </DropZone>
          {tasks.length > TOP_TASK_CAP && (
            <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer' : `Show all ${tasks.length}`}
            </button>
          )}

          {/* Checked-off things don't vanish — they move down here,
              still uncheckable if it was an accident. */}
          {doneToday.length > 0 && (
            <>
              <button className="section-label day-toggle" onClick={() => setShowDone(!showDone)}>
                {showDone ? '▾' : '▸'} Done today
                <span className="pill">{doneToday.length}</span>
              </button>
              {showDone && (
                <div className="stack">
                  <AnimatePresence initial={false}>
                    {doneToday.map((item) => (
                      <ItemCard key={item.id} item={item} showDate={false} />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </>
          )}

          {carried.length > 0 && (
            <>
              <div className="section-label row">
                Carried over
                <button
                  className="btn ghost"
                  title="Bring them all to today"
                  onClick={() =>
                    mutate(async () => {
                      for (const i of carried)
                        await window.api.updateItem(i.id, { scheduledDate: today })
                    })
                  }
                >
                  ↻ do today
                </button>
                <button
                  className="btn ghost"
                  title="Let them go, guilt-free"
                  onClick={() => {
                    const ids = carried.map((i) => i.id)
                    mutate(() => window.api.dropItems(ids))
                    pushUndo(`Let go of ${ids.length} carried-over tasks`, async () => {
                      for (const id of ids) await window.api.updateItem(id, { status: 'active' })
                    })
                  }}
                >
                  🧹 let go
                </button>
              </div>
              <div className="stack">
                <AnimatePresence>
                  {carried.map((item) => (
                    <DraggableCard key={item.id} item={item}>
                      <ItemCard item={item} faded showDate={false} />
                    </DraggableCard>
                  ))}
                </AnimatePresence>
              </div>
            </>
          )}

          {/* The rest of the 5-day window, one collapsible group per day. */}
          {rollingDays()
            .slice(1)
            .map((day) => (
              <DaySection key={day.date} day={day} />
            ))}
        </section>

        {/* Right column: the day's schedule (events + time blocks). */}
        <section className="timeline-pane">
          <div className="section-label">Schedule</div>
          <Timeline date={today} />
        </section>
      </div>
    </div>
  )
}

/** One upcoming day: a collapsible header, a drop target, its tasks. */
function DaySection({ day }: { day: RollingDay }): React.JSX.Element {
  const tasks = useLiveQuery(() => window.api.tasksFor(day.date), [day.date]) ?? []
  const [open, setOpen] = useState(true)

  return (
    <DropZone id={`list-${day.date}`} data={{ type: 'schedule', date: day.date }}>
      <button className="section-label day-toggle" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {day.label}
        <span className="pill">{tasks.length}</span>
      </button>
      {open && (
        <div>
          <TaskGroups items={tasks} date={day.date} />
          {tasks.length === 0 && (
            <span style={{ color: 'var(--text-faint)', fontSize: 13, padding: '2px 0 8px', display: 'block' }}>
              Nothing yet — drop a card here.
            </span>
          )}
        </div>
      )}
    </DropZone>
  )
}

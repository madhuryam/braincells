import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { todayYmd } from '@shared/dates'
import { useLiveQuery, useMutate } from '../state/data'
import { useNav } from '../state/nav'
import { ItemCard } from '../components/ItemCard'
import { DraggableCard, DropZone, SortableCard } from '../components/dnd'
import { Timeline } from '../components/Timeline'
import { EmptyState } from '../components/bits'
import { longDate, rollingDays, type RollingDay } from '../format'

const TOP_TASK_CAP = 5 // soft cap — never a hard limit (SPEC §4.1)

export function Today(): React.JSX.Element {
  const today = todayYmd()
  const tasks = useLiveQuery(() => window.api.tasksFor(today), [today]) ?? []
  const carried = useLiveQuery(() => window.api.carriedOver(today), [today]) ?? []
  const inboxCount = useLiveQuery(() => window.api.inboxCount(), []) ?? 0
  const mutate = useMutate()
  const { navigate } = useNav()
  const [draft, setDraft] = useState('')
  const [showAll, setShowAll] = useState(false)

  const visibleTasks = showAll ? tasks : tasks.slice(0, TOP_TASK_CAP)

  const capture = async (): Promise<void> => {
    const title = draft.trim()
    if (!title) return
    await mutate(() => window.api.createItem({ kind: 'note', title }))
    setDraft('')
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
        {/* Left column: capture + tasks for the rolling 5-day window. */}
        <section>
          <input
            id="quick-capture"
            style={{ width: '100%', marginBottom: 16 }}
            placeholder="Capture anything (⌘N)…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && capture()}
          />

          <DropZone id="list-today" data={{ type: 'schedule', date: today }}>
            <div className="section-label">Top tasks</div>
            {tasks.length === 0 && (
              <EmptyState art="🪷">Nothing planned. That’s allowed.</EmptyState>
            )}
            {/* Drag to reprioritize; the order is saved. */}
            <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <div className="stack">
                <AnimatePresence>
                  {visibleTasks.map((item) => (
                    <SortableCard key={item.id} item={item} sortableIds={tasks.map((t) => t.id)}>
                      <ItemCard item={item} />
                    </SortableCard>
                  ))}
                </AnimatePresence>
              </div>
            </SortableContext>
          </DropZone>
          {tasks.length > TOP_TASK_CAP && (
            <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer' : `Show all ${tasks.length}`}
            </button>
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
                  onClick={() => mutate(() => window.api.dropItems(carried.map((i) => i.id)))}
                >
                  🧹 let go
                </button>
              </div>
              <div className="stack">
                <AnimatePresence>
                  {carried.map((item) => (
                    <DraggableCard key={item.id} item={item}>
                      <ItemCard item={item} faded />
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
        <div className="stack">
          <AnimatePresence>
            {tasks.map((item) => (
              <DraggableCard key={item.id} item={item}>
                <ItemCard item={item} />
              </DraggableCard>
            ))}
          </AnimatePresence>
          {tasks.length === 0 && (
            <span style={{ color: 'var(--text-faint)', fontSize: 13, padding: '2px 0 8px' }}>
              Nothing yet — drop a card here.
            </span>
          )}
        </div>
      )}
    </DropZone>
  )
}

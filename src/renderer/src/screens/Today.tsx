import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { todayYmd, ymdAddDays } from '@shared/dates'
import { useLiveQuery, useMutate } from '../state/data'
import { useNav } from '../state/nav'
import { ItemCard } from '../components/ItemCard'
import { DraggableCard, DropZone, SortableCard } from '../components/dnd'
import { EmptyState } from '../components/bits'
import { longDate } from '../format'

const TOP_TASK_CAP = 5 // soft cap — never a hard limit (SPEC §4.1)

export function Today(): React.JSX.Element {
  const today = todayYmd()
  const tasks = useLiveQuery(() => window.api.tasksFor(today), [today]) ?? []
  const week = useLiveQuery(() => window.api.tasksThisWeek(today), [today]) ?? []
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
        {/* Left column: the day's timeline (calendar events + time
            blocks). Populated once the calendar lands. */}
        <section className="timeline-pane">
          <div className="section-label">Schedule</div>
          <EmptyState art="🗓️">
            The calendar timeline arrives in an upcoming commit.
          </EmptyState>
        </section>

        {/* Right column: capture + tasks. */}
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

          <DropZone id="list-week" data={{ type: 'schedule', date: ymdAddDays(today, 1) }}>
            {week.length > 0 && <div className="section-label">This week</div>}
            <div className="stack">
              <AnimatePresence>
                {week.map((item) => (
                  <DraggableCard key={item.id} item={item}>
                    <ItemCard item={item} />
                  </DraggableCard>
                ))}
              </AnimatePresence>
            </div>
          </DropZone>
        </section>
      </div>
    </div>
  )
}

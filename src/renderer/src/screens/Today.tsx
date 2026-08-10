import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { todayYmd, ymdAddDays } from '@shared/dates'
import { useLiveQuery, useMutate } from '../state/data'
import { useEditing } from '../state/editing'
import { useNav } from '../state/nav'
import { MeetingPeekProvider } from '../state/peek'
import { useUndo } from '../state/undo'
import { Card } from '../components/Card'
import { DetailPanel } from '../components/DetailPanel'
import { TaskPeek } from '../components/TaskPeek'
import { Meeting } from './Meeting'
import { ItemCard } from '../components/ItemCard'
import { TaskGroups } from '../components/TaskGroups'
import { ProjectPicker } from '../components/ProjectPicker'
import { DraggableCard, DropZone } from '../components/dnd'
import { Timeline } from '../components/Timeline'
import { CheckableInput, Checkbox, EmptyState } from '../components/bits'
import { longDate, rollingDays, type RollingDay } from '../format'

/** 'August 5' — the weekday already leads the header, so no repeat. */
function monthDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
}

const TOP_TASK_CAP = 5 // soft cap — never a hard limit (SPEC §4.1)

export function Today(): React.JSX.Element {
  const today = todayYmd()
  // ‹ › page the schedule/tasks/done to another day; sections about
  // *now* (carried over, the rolling week, triage) stay on real today.
  const [date, setDate] = useState(today)
  const tasks = useLiveQuery(() => window.api.tasksFor(date), [date]) ?? []
  const doneToday = useLiveQuery(() => window.api.completedOn(date), [date]) ?? []
  // Subtasks finished this day show grouped under their parent's name,
  // not as orphan cards.
  const doneSubs = useLiveQuery(() => window.api.completedSubtasksOn(date), [date]) ?? []
  const doneSubIds = new Set(doneSubs.map((d) => d.item.id))
  const doneStandalone = doneToday.filter((i) => !doneSubIds.has(i.id))
  const doneGroups = [...new Map(doneSubs.map((d) => [d.rootId, d.rootTitle])).entries()]
  const carried = useLiveQuery(() => window.api.carriedOver(today), [today]) ?? []
  const [showDone, setShowDone] = useState(true)
  const inboxCount = useLiveQuery(() => window.api.inboxCount(), []) ?? 0
  const mutate = useMutate()
  const { navigate, openOverlay } = useNav()
  const { pushUndo } = useUndo()
  const [taskDraft, setTaskDraft] = useState('')
  // Everything shows by default — "Show fewer" is the opt-in trim,
  // not the other way around.
  const [showAll, setShowAll] = useState(true)
  // A clicked calendar event peeks in a panel over the schedule —
  // no page navigation just to glance at a meeting.
  const [peek, setPeek] = useState<{ eventKey: string; title: string; date: string } | null>(null)
  // A clicked time-blocked task peeks in the same panel slot.
  const [peekTask, setPeekTask] = useState<string | null>(null)
  const closePeeks = (): void => {
    setPeek(null)
    setPeekTask(null)
  }
  useEffect(() => {
    if (!peek && !peekTask) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closePeeks()
    }
    const onDown = (e: MouseEvent): void => {
      // Don't dismiss on the drag that retimes a block on the timeline.
      const t = e.target as HTMLElement
      if (!t.closest('.timeline-peek') && !t.closest('.timeline-task')) closePeeks()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [peek, peekTask])

  const visibleTasks = showAll ? tasks : tasks.slice(0, TOP_TASK_CAP)

  // Straight onto today's list — no inbox detour for things you
  // already know are tasks for today.
  const addTask = async (): Promise<void> => {
    const title = taskDraft.trim()
    if (!title) return
    await mutate(() =>
      window.api.createItem({ kind: 'task', title, status: 'active', scheduledDate: date })
    )
    setTaskDraft('')
  }

  return (
    <div className="canvas">
      <header className="canvas-header">
        {/* One continuous phrase in header type. Its min-width fits the
            longest date, so the nav buttons beside it never move. */}
        <h1 style={{ minWidth: 330 }}>
          {date === today ? `Today · ${monthDay(date)}` : longDate(date)}
        </h1>
        <span className="row">
          <button className="btn ghost icon-btn" title="Previous day" onClick={() => setDate(ymdAddDays(date, -1))}>
            ‹
          </button>
          <button className="btn ghost" disabled={date === today} onClick={() => setDate(today)}>
            today
          </button>
          <button className="btn ghost icon-btn" title="Next day" onClick={() => setDate(ymdAddDays(date, 1))}>
            ›
          </button>
        </span>
        {inboxCount > 0 && (
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => navigate({ name: 'inbox' })}>
            📥 {inboxCount} to triage
          </button>
        )}
      </header>

      {/* Cards deep in the lists can peek a linked meeting here beside
          the schedule — same panel a clicked calendar event uses. */}
      <MeetingPeekProvider
        onPeek={(m) => {
          setPeekTask(null)
          setPeek(m)
        }}
      >
      <div className="today-grid">
        {/* Left column: tasks for the rolling 5-day window. (The old
            "Capture anything" input is gone — the task quick-add below
            and ⌥Space capture cover both cases.) */}
        <section>
          {/* The viewed day's own sections sit on a soft accent wash;
              the rest of the week stays plain below. */}
          <div className="today-scope">
            <DropZone id="list-today" data={{ type: 'schedule', date }}>
              <div style={{ margin: '14px 0 10px' }}>
                <CheckableInput
                  id="quick-capture"
                  placeholder="Add a task for today…"
                  value={taskDraft}
                  onChange={(e) => setTaskDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTask()}
                />
              </div>
              {tasks.length === 0 && (
                <EmptyState art="🪷"> a clean slate, no scheduled tasks
                </EmptyState>
              )}
              {/* One block per project; drag to reprioritize within a block.
                The show-all control lives inside the last block so it
                folds away with it. */}
              <TaskGroups
                items={visibleTasks}
                date={date}
                sortable
                footer={
                  tasks.length > TOP_TASK_CAP ? (
                    <button className="btn ghost" style={{ marginTop: 4 }} onClick={() => setShowAll(!showAll)}>
                      {showAll ? 'Show fewer' : `Show all ${tasks.length}`}
                    </button>
                  ) : undefined
                }
              />
            </DropZone>

            {/* Checked-off things don't vanish — they move down here,
              still uncheckable if it was an accident. */}
            {doneToday.length > 0 && (
              <>
                <button className="section-label day-toggle" onClick={() => setShowDone(!showDone)}>
                  {showDone ? '▾' : '▸'} {date === today ? 'Done today' : 'Done'}
                  <span className="pill">{doneToday.length}</span>
                </button>
                {showDone && (
                  <div className="item-list">
                    <AnimatePresence initial={false}>
                      {doneStandalone.map((item) => (
                        // contextDate: ticking a leftover subtask inside a
                        // done card on a past day's view logs it on THAT
                        // day, like every other checkbox on the page.
                        <ItemCard key={item.id} item={item} showDate={false} contextDate={date} />
                      ))}
                    </AnimatePresence>
                    {/* Subtasks finished this day, under their parent's
                      name — uncheckable in place if one was a misclick. */}
                    {doneGroups.map(([rootId, rootTitle]) => (
                      <DoneSubtaskGroup key={rootId} rootId={rootId} rootTitle={rootTitle} date={date} />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* A "right now" section like triage — it stays on real
                today rather than following the ‹ › paging. */}
            {date === today && carried.length > 0 && (
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
                <div className="item-list">
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

          </div>

          {/* The rest of the 5-day window, one collapsible group per day. */}
          <div className="section-label coming-up">Coming up</div>
          {rollingDays()
            .slice(1)
            .map((day) => (
              <DaySection key={day.date} day={day} />
            ))}
        </section>

        {/* Right column: the chosen day's schedule (events + time blocks). */}
        <section className="timeline-pane">
          <div className="section-label">Schedule</div>
          <Timeline
            date={date}
            onPeekEvent={(e) => {
              setPeekTask(null)
              setPeek(e)
            }}
            onPeekTask={(id) => {
              setPeek(null)
              setPeekTask(id)
            }}
          />
          {peek && (
            <div className="timeline-peek">
              <DetailPanel
                title={peek.title}
                onOpenFull={() =>
                  openOverlay({ name: 'meeting', eventKey: peek.eventKey, title: peek.title, date: peek.date })
                }
                onClose={() => setPeek(null)}
              >
                <Meeting
                  key={peek.eventKey}
                  embedded
                  eventKey={peek.eventKey}
                  title={peek.title}
                  date={peek.date}
                />
              </DetailPanel>
            </div>
          )}
          {peekTask && (
            <div className="timeline-peek">
              <DetailPanel
                onOpenFull={() => openOverlay({ name: 'page', itemId: peekTask })}
                onClose={() => setPeekTask(null)}
              >
                <TaskPeek key={peekTask} itemId={peekTask} onClose={closePeeks} />
              </DetailPanel>
            </div>
          )}
        </section>
      </div>
      </MeetingPeekProvider>
    </div>
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

/** One upcoming day: a collapsible header, a drop target, its tasks. */
function DaySection({ day }: { day: RollingDay }): React.JSX.Element {
  const tasks = useLiveQuery(() => window.api.tasksFor(day.date), [day.date]) ?? []
  const [open, setOpen] = useState(true)
  // The quick-add shares the app-wide editing slot, so at most one
  // editor OR creator is ever open in the view — opening this collapses
  // any expanded card (and any other day's creator), and vice versa.
  const editing = useEditing()
  const addKey = `quickadd:${day.date}`
  const adding = editing.openId === addKey

  // The + always reveals the day and drops focus into the creator.
  const startAdd = (): void => {
    setOpen(true)
    editing.setOpenId(addKey)
  }
  const closeAdd = (): void => {
    if (editing.openId === addKey) editing.setOpenId(null)
  }

  return (
    <DropZone id={`list-${day.date}`} data={{ type: 'schedule', date: day.date }}>
      <div className="day-header">
        <button className="section-label day-toggle" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} {day.label}
        </button>
        <button className="day-add-btn" title={`Add a task on ${day.label}`} onClick={startAdd}>
          +
        </button>
      </div>
      {open && (
        <div>
          <DueStrip date={day.date} />
          {adding && <DayQuickAdd date={day.date} onClose={closeAdd} />}
          <TaskGroups items={tasks} date={day.date} />
          {tasks.length === 0 && !adding && (
            <span style={{ color: 'var(--text-faint)', fontSize: 14, padding: '2px 0 8px', display: 'block' }}>
              Nothing yet — drop a card here.
            </span>
          )}
        </div>
      )}
    </DropZone>
  )
}

/**
 * Inline task creator scoped to one day: a title plus a project
 * dropdown, so you can file the task while you type it. Stays open
 * after each add (keeping the chosen project) for rapid entry; Esc or
 * ✕ closes it. Enter with an empty box also closes.
 */
function DayQuickAdd({ date, onClose }: { date: string; onClose: () => void }): React.JSX.Element {
  const mutate = useMutate()
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    const t = title.trim()
    if (!t) {
      onClose()
      return
    }
    await mutate(() =>
      window.api.createItem({
        kind: 'task',
        title: t,
        status: 'active',
        scheduledDate: date,
        projectId
      })
    )
    setTitle('') // stay open for the next one; keep the chosen project
  }

  return (
    <div className="day-quick-add">
      <div className="day-quick-add-row">
        <input
          autoFocus
          placeholder="New task…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onClose()
          }}
        />
        <button className="btn primary" onClick={submit} disabled={!title.trim()}>
          Add
        </button>
        <button className="btn ghost icon-btn" onClick={onClose} title="Done adding">
          ✕
        </button>
      </div>
      <ProjectPicker expanded value={projectId} onChange={setProjectId} />
    </div>
  )
}

/**
 * What's DUE by a day — distinct from what's scheduled on it. Quiet
 * pills inside each coming-up day's fold (the viewed day itself shows
 * no strip — deadlines surface on the task cards).
 */
function DueStrip({ date }: { date: string }): React.JSX.Element | null {
  const due = useLiveQuery(() => window.api.tasksDueOn(date), [date]) ?? []
  if (due.length === 0) return null
  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 6, margin: '2px 0 8px' }}>
      <span className="section-sublabel" style={{ marginTop: 0 }}>Due</span>
      {due.map((t) => (
        <span key={t.id} className="pill">
          {t.title}
        </span>
      ))}
    </div>
  )
}

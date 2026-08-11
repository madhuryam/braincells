import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { CalendarEvent, LocalEvent } from '@shared/types'
import { hhmm, todayYmd } from '@shared/dates'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { useNav } from '../state/nav'
import { useLabels, type Label } from '../state/labels'
import { ProgressBar } from './bits'
import { ProjectPicker } from './ProjectPicker'
import { AllDayBar } from './AllDayBar'
import { tipLines, useTip } from './Tooltip'
import { ampm } from '../format'

const PX_PER_MIN = 2.4 // tall enough that a 15-minute block fits its text
const SLOT_MIN = 15 // grid granularity: drops, drags, and new blocks

function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
const toHHMM = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/**
 * Overlapping entries lay out side-by-side: a greedy column assignment
 * within each cluster of transitively-overlapping items.
 */
function layoutColumns(
  items: Array<{ key: string; start: number; end: number }>
): Map<string, { col: number; cols: number }> {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end)
  const result = new Map<string, { col: number; cols: number }>()
  let cluster: typeof sorted = []
  let clusterEnd = 0

  const flush = (): void => {
    const colEnd: number[] = []
    const colOf = new Map<string, number>()
    for (const it of cluster) {
      let col = colEnd.findIndex((e) => e <= it.start)
      if (col === -1) {
        col = colEnd.length
        colEnd.push(0)
      }
      colEnd[col] = it.end
      colOf.set(it.key, col)
    }
    for (const it of cluster) result.set(it.key, { col: colOf.get(it.key)!, cols: colEnd.length })
    cluster = []
  }

  for (const it of sorted) {
    if (cluster.length > 0 && it.start >= clusterEnd) flush()
    clusterEnd = cluster.length === 0 ? it.end : Math.max(clusterEnd, it.end)
    cluster.push(it)
  }
  if (cluster.length > 0) flush()
  return result
}

/**
 * The day's schedule (SPEC §4.1): calendar events, time-blocked tasks,
 * and local time blocks, positioned by time. The window defaults to
 * 7am–8pm (configurable in Settings) and scrolls. Click or drag out a
 * range on empty space to create a TASK in that slot — it lands in the
 * day's list (under "No project" until told otherwise) and occupies
 * the drawn time here, same as a task dragged in. Nothing is ever
 * written to Google.
 */
export function Timeline({
  date,
  onPeekEvent,
  onPeekTask
}: {
  date: string
  /** When given, clicking a meeting peeks it instead of navigating. */
  onPeekEvent?: (ev: { eventKey: string; title: string; date: string }) => void
  /** When given, clicking a time-blocked task peeks it in a panel. */
  onPeekTask?: (itemId: string) => void
}): React.JSX.Element {
  const events = useLiveQuery(() => window.api.calendarEvents(date, date), [date]) ?? []
  // Open AND done — a checked-off block stays (faded) as the record
  // of the day rather than vanishing off the schedule.
  const blocks = useLiveQuery(() => window.api.scheduledBlocks(date), [date]) ?? []
  const locals = useLiveQuery(() => window.api.localEventsFor(date), [date]) ?? []
  const eventKeys = events.map((e) => e.eventKey).join(',')
  const prep = useLiveQuery(() => window.api.prepProgress(events.map((e) => e.eventKey)), [eventKeys]) ?? []
  const { projects } = useData()
  const labels = useLabels()
  const bounds = useLiveQuery(
    () => window.api.getSetting<{ start: number; end: number }>('timelineBounds'),
    []
  )
  const mutate = useMutate()
  const { openOverlay } = useNav()

  // Re-render every minute so the "now" line crawls.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const [editingId, setEditingId] = useState<string | null>(null)
  // A click/drag opens the editor on this in-memory draft; nothing is
  // written to the database until the block is given a name.
  const [pending, setPending] = useState<{ start: number; end: number } | null>(null)
  const [draft, setDraft] = useState<{ start: number; end: number } | null>(null)
  // A block mid-resize renders from this instead of its saved times.
  const [resizing, setResizing] = useState<{ id: string; start: number; end: number } | null>(null)
  // A time-blocked task mid drag/resize renders from this override.
  const [taskDrag, setTaskDrag] = useState<{ id: string; start: number; end: number } | null>(null)
  const suppressClick = useRef(false) // a resize's mouseup must not open the editor
  const timelineRef = useRef<HTMLDivElement>(null)

  const timed = events.filter((e) => e.startTime)

  // The visible window: the configured bounds (default 7am–8pm),
  // stretched if anything falls outside them.
  const winStart = (bounds?.start ?? 7) * 60
  const winEnd = (bounds?.end ?? 20) * 60
  const startMins = [
    winStart,
    ...timed.map((e) => toMin(e.startTime!)),
    ...blocks.map((b) => toMin(b.scheduledTime!)),
    ...locals.map((l) => toMin(l.startTime))
  ]
  const endMins = [
    winEnd,
    ...timed.map((e) => toMin(e.endTime ?? e.startTime!) + SLOT_MIN),
    ...blocks.map((b) => toMin(b.scheduledTime!) + (b.timeEstimateMinutes ?? 30)),
    ...locals.map((l) => toMin(l.endTime))
  ]
  const dayStart = Math.floor(Math.min(...startMins) / 60) * 60
  const dayEnd = Math.ceil(Math.max(...endMins) / 60) * 60
  const y = (mins: number): number => (mins - dayStart) * PX_PER_MIN

  const nowMins = toMin(hhmm(now))
  const isToday = date === todayYmd()

  // Side-by-side columns for everything that occupies time.
  const laid = layoutColumns([
    ...timed.map((e) => ({
      key: `e-${e.eventKey}`,
      start: toMin(e.startTime!),
      end: Math.max(toMin(e.endTime ?? e.startTime!), toMin(e.startTime!) + SLOT_MIN)
    })),
    ...locals.map((l) => ({
      key: `l-${l.id}`,
      start: toMin(l.startTime),
      end: Math.max(toMin(l.endTime), toMin(l.startTime) + SLOT_MIN)
    })),
    ...blocks.map((t) => ({
      key: `t-${t.id}`,
      start: toMin(t.scheduledTime!),
      end: toMin(t.scheduledTime!) + (t.timeEstimateMinutes ?? 30)
    }))
  ])
  const colStyle = (key: string): CSSProperties => {
    const p = laid.get(key)
    if (!p || p.cols === 1) return { left: 0, right: 0 }
    return { left: `${(p.col / p.cols) * 100}%`, width: `calc(${100 / p.cols}% - 4px)` }
  }

  // Click or drag out a range on empty timeline → a new task there.
  const onMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.timeline-event, .timeline-task, .local-event, .local-event-editor')) return
    const rect = timelineRef.current!.getBoundingClientRect()
    const rawAt = (clientY: number): number => dayStart + (clientY - rect.top) / PX_PER_MIN
    const clamp = (m: number): number => Math.max(dayStart, Math.min(dayEnd, m))
    const start = clamp(Math.floor(rawAt(e.clientY) / SLOT_MIN) * SLOT_MIN)
    let range = { start, end: Math.min(start + SLOT_MIN, dayEnd) }
    setDraft(range)

    const onMove = (me: MouseEvent): void => {
      const end = clamp(Math.ceil(rawAt(me.clientY) / SLOT_MIN) * SLOT_MIN)
      range = { start, end: Math.max(end, start + SLOT_MIN) }
      setDraft({ ...range })
    }
    const onUp = (ue: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setDraft(null)
      const dragged = Math.abs(ue.clientY - e.clientY) > 4
      // A plain click makes one grid slot (15 min); drag out for more.
      const end = dragged ? range.end : Math.min(start + SLOT_MIN, dayEnd)
      if (end <= start) return
      setEditingId(null)
      setPending({ start, end })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Grab a block's top or bottom edge to retime it in place — no
  // editor needed. Snaps to the 15-minute grid, saves on release.
  const startResize = (e: React.MouseEvent, l: LocalEvent, edge: 'start' | 'end'): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const rect = timelineRef.current!.getBoundingClientRect()
    const rawAt = (clientY: number): number => dayStart + (clientY - rect.top) / PX_PER_MIN
    const clamp = (m: number): number => Math.max(dayStart, Math.min(dayEnd, m))
    const origStart = toMin(l.startTime)
    const origEnd = toMin(l.endTime)
    let next = { start: origStart, end: origEnd }
    let moved = false

    const onMove = (me: MouseEvent): void => {
      const m = clamp(Math.round(rawAt(me.clientY) / SLOT_MIN) * SLOT_MIN)
      next =
        edge === 'start'
          ? { start: Math.min(m, origEnd - SLOT_MIN), end: origEnd }
          : { start: origStart, end: Math.max(m, origStart + SLOT_MIN) }
      moved = true
      setResizing({ id: l.id, ...next })
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setResizing(null)
      if (!moved) return
      suppressClick.current = true
      window.setTimeout(() => (suppressClick.current = false), 150)
      if (next.start !== origStart || next.end !== origEnd) {
        mutate(() =>
          window.api.updateLocalEvent(l.id, {
            startTime: toHHMM(next.start),
            endTime: toHHMM(next.end)
          })
        )
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Time-blocked tasks retime on the calendar too: drag the body to
  // move (keeping duration), or the bottom edge to change how long it
  // takes. A plain click (no drag) peeks the task instead. Start time
  // lives on the item as scheduledTime; duration as timeEstimateMinutes.
  const startTaskDrag = (
    e: React.MouseEvent,
    t: { id: string; scheduledTime?: string | null; timeEstimateMinutes?: number | null },
    mode: 'move' | 'end'
  ): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const rect = timelineRef.current!.getBoundingClientRect()
    const rawAt = (clientY: number): number => dayStart + (clientY - rect.top) / PX_PER_MIN
    const origStart = toMin(t.scheduledTime!)
    const dur = t.timeEstimateMinutes ?? 30
    // Where inside the block the grab happened, so moving doesn't jump.
    const grabOffset = mode === 'move' ? rawAt(e.clientY) - origStart : 0
    let next = { start: origStart, end: origStart + dur }
    let moved = false

    const onMove = (me: MouseEvent): void => {
      if (mode === 'move') {
        const s = Math.max(
          dayStart,
          Math.min(dayEnd - dur, Math.round((rawAt(me.clientY) - grabOffset) / SLOT_MIN) * SLOT_MIN)
        )
        next = { start: s, end: s + dur }
      } else {
        const end = Math.min(dayEnd, Math.max(origStart + SLOT_MIN, Math.round(rawAt(me.clientY) / SLOT_MIN) * SLOT_MIN))
        next = { start: origStart, end }
      }
      moved = true
      setTaskDrag({ id: t.id, ...next })
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setTaskDrag(null)
      // No real drag → treat as a click and peek the task.
      if (!moved || (next.start === origStart && next.end - next.start === dur)) {
        onPeekTask?.(t.id)
        return
      }
      suppressClick.current = true
      window.setTimeout(() => (suppressClick.current = false), 150)
      mutate(() =>
        window.api.updateItem(t.id, {
          scheduledTime: toHHMM(next.start),
          timeEstimateMinutes: next.end - next.start
        })
      )
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const totalHeight = (dayEnd - dayStart) * PX_PER_MIN

  return (
    <div>
      <AllDayBar events={events} />
      <div className="timeline-scroll">
        <div
          ref={timelineRef}
          className="timeline"
          style={{ height: totalHeight }}
          onMouseDown={onMouseDown}
        >
          {/* A soft veil over the elapsed part of today, so the timeline
              itself shows how far into the day you are. Painted first, so
              it sits under the events (which carry their own past tint). */}
          {isToday && nowMins > dayStart && (
            <div
              className="timeline-past"
              style={{ height: Math.min(y(nowMins), totalHeight) }}
            />
          )}

          {/* hour gridlines */}
          {Array.from({ length: (dayEnd - dayStart) / 60 + 1 }, (_, i) => {
            const mins = dayStart + i * 60
            return (
              <div key={mins} className="timeline-hour" style={{ top: y(mins) }}>
                <span>{ampm(`${mins / 60}:00`)}</span>
              </div>
            )
          })}

          {/* invisible 15-minute drop slots for dragging tasks in */}
          {Array.from({ length: (dayEnd - dayStart) / SLOT_MIN }, (_, i) => {
            const mins = dayStart + i * SLOT_MIN
            const time = toHHMM(mins)
            return <TimeSlot key={time} date={date} time={time} top={y(mins)} height={SLOT_MIN * PX_PER_MIN} />
          })}

          {/* everything that occupies time, in overlap-aware columns */}
          <div className="timeline-items">
            {timed.map((e) => {
              const start = toMin(e.startTime!)
              const end = e.endTime ? toMin(e.endTime) : start + 30
              const p = prep.find((x) => x.eventKey === e.eventKey)
              const past = isToday && end < nowMins
              return (
                <EventBlock
                  key={e.eventKey}
                  event={e}
                  top={y(start)}
                  // Shave 2px off so back-to-back meetings keep a small
                  // gap instead of their borders touching.
                  height={Math.max((end - start) * PX_PER_MIN - 2, 32)}
                  colStyle={colStyle(`e-${e.eventKey}`)}
                  label={labels.of(e)}
                  prepDone={p?.done ?? 0}
                  prepTotal={p?.total ?? 0}
                  past={past}
                  onOpen={() =>
                    onPeekEvent
                      ? onPeekEvent({ eventKey: e.eventKey, title: e.title, date: e.date })
                      : openOverlay({ name: 'meeting', eventKey: e.eventKey, title: e.title, date: e.date })
                  }
                />
              )
            })}

            {locals.map((l) => {
              const rs = resizing?.id === l.id ? resizing : null
              const start = rs ? rs.start : toMin(l.startTime)
              const end = rs ? rs.end : Math.max(toMin(l.endTime), toMin(l.startTime) + SLOT_MIN)
              const proj = projects.find((p) => p.id === l.projectId)
              return editingId === l.id ? (
                <LocalEventEditor
                  key={l.id}
                  ev={l}
                  top={Math.max(0, Math.min(y(start), totalHeight - 150))}
                  onClose={() => setEditingId(null)}
                />
              ) : (
                <div
                  key={l.id}
                  className="local-event"
                  style={{
                    top: y(start),
                    height: Math.max((end - start) * PX_PER_MIN, 24),
                    ...colStyle(`l-${l.id}`),
                    // An assigned block wears its project's color.
                    ...(proj
                      ? {
                          borderLeftColor: proj.color,
                          background: `color-mix(in srgb, ${proj.color} 12%, var(--bg-card))`
                        }
                      : {})
                  }}
                  title="Local time block — click to edit, drag the edges to retime"
                  onClick={() => {
                    if (suppressClick.current) return
                    setEditingId(l.id)
                  }}
                >
                  <div className="le-handle top" onMouseDown={(e) => startResize(e, l, 'start')} />
                  <span>{l.title || 'Untitled block'}</span>{' '}
                  <span className="le-time">
                    {ampm(toHHMM(start))}–{ampm(toHHMM(end))}
                  </span>
                  <div className="le-handle bottom" onMouseDown={(e) => startResize(e, l, 'end')} />
                </div>
              )
            })}

            {/* time-blocked tasks — dressed like local blocks (one
                visual language for "this time is spoken for"): gray
                body, the project's color only on the left edge */}
            {blocks.map((t) => {
              const td = taskDrag?.id === t.id ? taskDrag : null
              const start = td ? td.start : toMin(t.scheduledTime!)
              const dur = td ? td.end - td.start : t.timeEstimateMinutes ?? 30
              const missed = isToday && start + dur < nowMins && t.status === 'active'
              const proj = projects.find((p) => p.id === t.projectId)
              return (
                <div
                  key={t.id}
                  className={`timeline-task ${t.status === 'done' ? 'done' : ''} ${missed ? 'missed' : ''}`}
                  style={{
                    top: y(start),
                    height: Math.max(dur * PX_PER_MIN, 26),
                    ...colStyle(`t-${t.id}`),
                    ...(proj ? { borderLeftColor: proj.color } : {})
                  }}
                  title={
                    missed
                      ? 'Missed the block — no big deal, it’s still on your list'
                      : `${t.title} — click to open, drag to move, drag the bottom edge to resize`
                  }
                  onMouseDown={(e) => startTaskDrag(e, t, 'move')}
                >
                  {t.status === 'done' ? '✓ ' : ''}
                  {t.title}{' '}
                  <span className="le-time">
                    {ampm(toHHMM(start))}–{ampm(toHHMM(start + dur))}
                  </span>
                  <div className="le-handle bottom" onMouseDown={(e) => startTaskDrag(e, t, 'end')} />
                </div>
              )
            })}

            {/* a just-drawn range being named — it becomes a TASK in
                this slot (and on this day's list) once it has a title */}
            {pending && (
              <TaskDraftEditor
                key={`pending-${pending.start}-${pending.end}`}
                date={date}
                initialStart={toHHMM(pending.start)}
                initialEnd={toHHMM(pending.end)}
                top={Math.max(0, Math.min(y(pending.start), totalHeight - 150))}
                onClose={() => setPending(null)}
              />
            )}

            {/* the range being dragged out right now */}
            {draft && (
              <div
                className="timeline-draft"
                style={{ top: y(draft.start), height: Math.max((draft.end - draft.start) * PX_PER_MIN, 12) }}
              >
                {ampm(toHHMM(draft.start))}–{ampm(toHHMM(draft.end))}
              </div>
            )}
          </div>

          {/* the "now" line */}
          {isToday && nowMins >= dayStart && nowMins <= dayEnd && (
            <div className="timeline-now" style={{ top: y(nowMins) }} />
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Inline editor for an existing local block. Fields keep local React
 * state — each change saves, but the round-tripped save can never
 * revert in-flight keystrokes. Call sites key this component by event
 * id, so opening a different block remounts it with freshly seeded
 * state. (New click-drawn ranges go through TaskDraftEditor instead —
 * drawing on the calendar makes tasks now, not local blocks.)
 */
function LocalEventEditor({
  ev,
  top,
  onClose
}: {
  ev: LocalEvent
  top: number
  onClose: () => void
}): React.JSX.Element {
  const mutate = useMutate()
  const [title, setTitle] = useState(ev.title)
  const [start, setStart] = useState(ev.startTime)
  const [end, setEnd] = useState(ev.endTime)
  const [projectId, setProjectId] = useState<string | null>(ev.projectId)

  const save = (patch: {
    title?: string
    startTime?: string
    endTime?: string
    projectId?: string | null
  }): void => {
    void mutate(() => window.api.updateLocalEvent(ev.id, patch))
  }

  const remove = (): void => {
    void mutate(() => window.api.deleteLocalEvent(ev.id))
    onClose()
  }

  return (
    <div
      className="local-event-editor"
      style={{ top }}
      onMouseDown={(e) => e.stopPropagation()}
      // Enter anywhere in the editor = Done; Escape closes. Either way
      // the unmount hook above discards a still-unnamed new block.
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') onClose()
      }}
    >
      <input
        autoFocus
        placeholder="What’s this time for?"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value)
          save({ title: e.target.value })
        }}
      />
      <div className="row">
        <input
          type="time"
          step={60}
          value={start}
          onChange={(e) => {
            setStart(e.target.value)
            if (e.target.value) save({ startTime: e.target.value })
          }}
        />
        <span>–</span>
        <input
          type="time"
          step={60}
          value={end}
          onChange={(e) => {
            setEnd(e.target.value)
            if (e.target.value) save({ endTime: e.target.value })
          }}
        />
        <button className="btn ghost small" style={{ marginLeft: 'auto' }} onClick={remove}>
          🗑 delete
        </button>
        <button className="btn small primary" onClick={onClose}>
          Done
        </button>
      </div>
      <ProjectPicker
        value={projectId}
        onChange={(v) => {
          setProjectId(v)
          save({ projectId: v })
        }}
      />
    </div>
  )
}

/**
 * The editor a click-drawn range opens. It creates a TASK — not a
 * local block — so what you type lands on this day's list (under "No
 * project" unless the picker files it) AND occupies the drawn slot
 * here, same as a task dragged onto the timeline. The item is created
 * on the first keystroke that names it (guarded so rapid keystrokes
 * can't race); closing while still unnamed discards the draft — no
 * title, no task.
 */
function TaskDraftEditor({
  date,
  initialStart,
  initialEnd,
  top,
  onClose
}: {
  date: string
  initialStart: string
  initialEnd: string
  top: number
  onClose: () => void
}): React.JSX.Element {
  const mutate = useMutate()
  const [title, setTitle] = useState('')
  const [start, setStart] = useState(initialStart)
  const [end, setEnd] = useState(initialEnd)
  const [projectId, setProjectId] = useState<string | null>(null)
  const idRef = useRef<string | null>(null)
  const creating = useRef<Promise<void> | null>(null)

  const save = (patch: {
    title?: string
    start?: string
    end?: string
    projectId?: string | null
  }): void => {
    const f = {
      title: patch.title ?? title,
      start: patch.start ?? start,
      end: patch.end ?? end,
      projectId: patch.projectId !== undefined ? patch.projectId : projectId
    }
    // The drawn range maps onto the task's block fields: a start time
    // plus a duration — the same pair a drag-in drop sets. Hand-typed
    // times may be off-grid, so the floor is 5 minutes, not one slot.
    const duration = Math.max(5, toMin(f.end) - toMin(f.start))
    void mutate(async () => {
      if (creating.current) await creating.current
      if (idRef.current) {
        await window.api.updateItem(idRef.current, {
          title: f.title,
          projectId: f.projectId,
          scheduledTime: f.start,
          timeEstimateMinutes: duration
        })
      } else if (f.title.trim() !== '') {
        creating.current = window.api
          .createItem({
            kind: 'task',
            title: f.title,
            status: 'active',
            projectId: f.projectId,
            scheduledDate: date,
            scheduledTime: f.start,
            timeEstimateMinutes: duration
          })
          .then((created) => {
            idRef.current = created.id
          })
        await creating.current
      }
    })
  }

  const remove = (): void => {
    void mutate(async () => {
      if (creating.current) await creating.current // don't leak an in-flight create
      if (idRef.current) await window.api.deleteItem(idRef.current)
    })
    onClose()
  }

  return (
    <div
      className="local-event-editor"
      style={{ top }}
      onMouseDown={(e) => e.stopPropagation()}
      // Enter anywhere in the editor = Done; Escape closes. Either way
      // a still-unnamed draft is simply never created.
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') onClose()
      }}
    >
      <input
        autoFocus
        placeholder="New task for this time…"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value)
          save({ title: e.target.value })
        }}
      />
      <div className="row">
        <input
          type="time"
          step={60}
          value={start}
          onChange={(e) => {
            setStart(e.target.value)
            if (e.target.value) save({ start: e.target.value })
          }}
        />
        <span>–</span>
        <input
          type="time"
          step={60}
          value={end}
          onChange={(e) => {
            setEnd(e.target.value)
            if (e.target.value) save({ end: e.target.value })
          }}
        />
        <button className="btn ghost small" style={{ marginLeft: 'auto' }} onClick={remove}>
          🗑 delete
        </button>
        <button className="btn small primary" onClick={onClose}>
          Done
        </button>
      </div>
      <ProjectPicker
        value={projectId}
        onChange={(v) => {
          setProjectId(v)
          save({ projectId: v })
        }}
      />
    </div>
  )
}

function TimeSlot({
  date,
  time,
  top,
  height
}: {
  date: string
  time: string
  top: number
  height: number
}): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot-${time}`,
    data: { type: 'timeblock', date, time }
  })
  return (
    <div
      ref={setNodeRef}
      className={`timeline-slot ${isOver ? 'drop-over' : ''}`}
      style={{ top, height }}
    >
      {isOver && <span className="pill">⏱ {ampm(time)}</span>}
    </div>
  )
}

function EventBlock({
  event,
  top,
  height,
  colStyle,
  label,
  prepDone,
  prepTotal,
  past,
  onOpen
}: {
  event: CalendarEvent
  top: number
  height: number
  colStyle: CSSProperties
  /** The event's Google label (overrides applied) — border and wash. */
  label?: Label
  prepDone: number
  prepTotal: number
  past: boolean
  onOpen: () => void
}): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: `event-${event.eventKey}`,
    data: { type: 'event-prep', event }
  })
  // The fast viewport tooltip (not the ~1s native `title`), same as
  // the month calendar's chips. One line per fact — never truncated.
  const tip = useTip(
    tipLines(
      event.title,
      event.startTime && `🕐 ${ampm(event.startTime)}${event.endTime ? `–${ampm(event.endTime)}` : ''}`,
      label && label.name
    )
  )
  // An upcoming labeled event fills solid with its label color (like the
  // month calendar's chips), white text on top. A past one becomes a
  // light tint of that same color — the "faded" look (e.g. #E4C441 →
  // ~#F5EEC9) — rather than a dimmed solid, so the color stays
  // recognizable instead of going muddy.
  const solid = !!label && !past
  const soft = solid ? 'rgba(255, 255, 255, 0.82)' : 'var(--text-soft)'
  const labelStyle: CSSProperties = !label
    ? {}
    : solid
      ? {
          background: label.hex,
          // A darker rim (not the fill color) so every event has a
          // visible border, even against a same-colored neighbor.
          borderColor: `color-mix(in srgb, ${label.hex} 68%, #000)`,
          color: '#fff'
        }
      : {
          background: `color-mix(in srgb, ${label.hex} 30%, var(--bg-card))`,
          borderColor: `color-mix(in srgb, ${label.hex} 55%, var(--bg-card))`,
          opacity: 1 // the tint itself conveys "past"; skip the .past fade
        }
  return (
    <div
      ref={setNodeRef}
      className={`timeline-event ${past ? 'past' : ''} ${isOver ? 'drop-over' : ''}`}
      style={{ top, height, ...colStyle, ...labelStyle }}
      {...tip}
      onClick={onOpen}
    >
      <div className="row" style={{ gap: 6 }}>
        <b>{event.title}</b>
        <span style={{ color: soft, fontSize: 13 }}>
          {ampm(event.startTime!)}
          {event.endTime ? `–${ampm(event.endTime)}` : ''}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: soft }}>
          notes ↗
        </span>
      </div>
      {prepTotal > 0 && (
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <span style={{ flex: 1 }}>
            <ProgressBar done={prepDone} total={prepTotal} />
          </span>
          <span style={{ fontSize: 12.5, color: soft }}>
            {prepDone} of {prepTotal} prep
          </span>
        </div>
      )}
    </div>
  )
}

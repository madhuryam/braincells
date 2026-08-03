import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { CalendarEvent, LocalEvent } from '@shared/types'
import { hhmm, todayYmd } from '@shared/dates'
import { useLiveQuery, useMutate } from '../state/data'
import { useNav } from '../state/nav'
import { ProgressBar } from './bits'
import { AllDayBar } from './AllDayBar'
import { ampm } from '../format'

const PX_PER_MIN = 1.1
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
 * range on empty space to create a local block — stored only in the
 * local database, never written to Google.
 */
export function Timeline({ date }: { date: string }): React.JSX.Element {
  const events = useLiveQuery(() => window.api.calendarEvents(date, date), [date]) ?? []
  const tasks = useLiveQuery(() => window.api.tasksFor(date), [date]) ?? []
  const locals = useLiveQuery(() => window.api.localEventsFor(date), [date]) ?? []
  const eventKeys = events.map((e) => e.eventKey).join(',')
  const prep = useLiveQuery(() => window.api.prepProgress(events.map((e) => e.eventKey)), [eventKeys]) ?? []
  const bounds = useLiveQuery(
    () => window.api.getSetting<{ start: number; end: number }>('timelineBounds'),
    []
  )
  const mutate = useMutate()

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
  const suppressClick = useRef(false) // a resize's mouseup must not open the editor
  const timelineRef = useRef<HTMLDivElement>(null)

  const timed = events.filter((e) => e.startTime)
  const blocks = tasks.filter((t) => t.scheduledTime)

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

  // Click or drag out a range on empty timeline → a new local block.
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
      const end = dragged ? range.end : Math.min(start + 30, dayEnd) // plain click: a 30-minute block
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
                  height={Math.max((end - start) * PX_PER_MIN, 34)}
                  colStyle={colStyle(`e-${e.eventKey}`)}
                  prepDone={p?.done ?? 0}
                  prepTotal={p?.total ?? 0}
                  past={past}
                />
              )
            })}

            {locals.map((l) => {
              const rs = resizing?.id === l.id ? resizing : null
              const start = rs ? rs.start : toMin(l.startTime)
              const end = rs ? rs.end : Math.max(toMin(l.endTime), toMin(l.startTime) + SLOT_MIN)
              return editingId === l.id ? (
                <LocalEventEditor
                  key={l.id}
                  date={date}
                  ev={l}
                  top={Math.max(0, Math.min(y(start), totalHeight - 150))}
                  onClose={() => setEditingId(null)}
                />
              ) : (
                <div
                  key={l.id}
                  className="local-event"
                  style={{ top: y(start), height: Math.max((end - start) * PX_PER_MIN, 24), ...colStyle(`l-${l.id}`) }}
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

            {/* time-blocked tasks */}
            {blocks.map((t) => {
              const start = toMin(t.scheduledTime!)
              const dur = t.timeEstimateMinutes ?? 30
              const missed = isToday && start + dur < nowMins && t.status === 'active'
              return (
                <div
                  key={t.id}
                  className={`timeline-task ${t.status === 'done' ? 'done' : ''} ${missed ? 'missed' : ''}`}
                  style={{ top: y(start), height: Math.max(dur * PX_PER_MIN, 26), ...colStyle(`t-${t.id}`) }}
                  title={missed ? 'Missed the block — no big deal, it’s still on your list' : t.title}
                >
                  {t.status === 'done' ? '✓ ' : ''}
                  {t.title}
                </div>
              )
            })}

            {/* a just-drawn block being named — not yet in the database */}
            {pending && (
              <LocalEventEditor
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
 * Inline editor for a local block. Fields keep local React state —
 * each change saves, but the round-tripped save can never revert
 * in-flight keystrokes. Call sites key this component by event id, so
 * opening a different block remounts it with freshly seeded state.
 *
 * Without `ev` it edits an unsaved draft: the database row is created
 * on the first keystroke that gives it a name, and closing while
 * still unnamed simply discards the draft — no name, no event.
 */
function LocalEventEditor({
  date,
  ev,
  initialStart,
  initialEnd,
  top,
  onClose
}: {
  date: string
  ev?: LocalEvent
  initialStart?: string
  initialEnd?: string
  top: number
  onClose: () => void
}): React.JSX.Element {
  const mutate = useMutate()
  const [title, setTitle] = useState(ev?.title ?? '')
  const [start, setStart] = useState(ev?.startTime ?? initialStart ?? '09:00')
  const [end, setEnd] = useState(ev?.endTime ?? initialEnd ?? '09:30')

  // The id, once the block is real. For drafts, creation happens at
  // most once (guarded by a promise so rapid keystrokes can't race).
  const idRef = useRef<string | null>(ev?.id ?? null)
  const creating = useRef<Promise<void> | null>(null)

  const save = (patch: { title?: string; startTime?: string; endTime?: string }): void => {
    const fields = {
      title: patch.title ?? title,
      startTime: patch.startTime ?? start,
      endTime: patch.endTime ?? end
    }
    void mutate(async () => {
      if (creating.current) await creating.current
      if (idRef.current) {
        await window.api.updateLocalEvent(idRef.current, patch)
      } else if (fields.title.trim() !== '') {
        creating.current = window.api
          .createLocalEvent({ date, ...fields })
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
      if (idRef.current) await window.api.deleteLocalEvent(idRef.current)
    })
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
          step={SLOT_MIN * 60}
          value={start}
          onChange={(e) => {
            setStart(e.target.value)
            if (e.target.value) save({ startTime: e.target.value })
          }}
        />
        <span>–</span>
        <input
          type="time"
          step={SLOT_MIN * 60}
          value={end}
          onChange={(e) => {
            setEnd(e.target.value)
            if (e.target.value) save({ endTime: e.target.value })
          }}
        />
      </div>
      <div className="row">
        <button className="btn ghost small" onClick={remove}>
          🗑 delete
        </button>
        <button className="btn small primary" style={{ marginLeft: 'auto' }} onClick={onClose}>
          Done
        </button>
      </div>
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
  prepDone,
  prepTotal,
  past
}: {
  event: CalendarEvent
  top: number
  height: number
  colStyle: CSSProperties
  prepDone: number
  prepTotal: number
  past: boolean
}): React.JSX.Element {
  const { navigate } = useNav()
  const { setNodeRef, isOver } = useDroppable({
    id: `event-${event.eventKey}`,
    data: { type: 'event-prep', event }
  })
  return (
    <div
      ref={setNodeRef}
      className={`timeline-event ${past ? 'past' : ''} ${isOver ? 'drop-over' : ''}`}
      style={{ top, height, ...colStyle }}
      onClick={() =>
        navigate({ name: 'meeting', eventKey: event.eventKey, title: event.title, date: event.date })
      }
    >
      <div className="row" style={{ gap: 6 }}>
        <b>{event.title}</b>
        <span style={{ color: 'var(--text-soft)', fontSize: 12 }}>
          {ampm(event.startTime!)}
          {event.endTime ? `–${ampm(event.endTime)}` : ''}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-soft)' }}>
          notes ↗
        </span>
      </div>
      {prepTotal > 0 && (
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <span style={{ flex: 1 }}>
            <ProgressBar done={prepDone} total={prepTotal} />
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--text-soft)' }}>
            {prepDone} of {prepTotal} prep
          </span>
        </div>
      )}
    </div>
  )
}

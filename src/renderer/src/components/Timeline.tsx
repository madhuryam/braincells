import { useEffect, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import type { CalendarEvent } from '@shared/types'
import { hhmm, todayYmd } from '@shared/dates'
import { useLiveQuery } from '../state/data'
import { useNav } from '../state/nav'
import { ProgressBar } from './bits'
import { EmptyState } from './bits'

const PX_PER_MIN = 1.1
const SLOT_MIN = 30 // drop-target granularity for time blocking

function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
const fmtHour = (h: number): string => `${String(h).padStart(2, '0')}:00`

/**
 * The day's schedule (SPEC §4.1): calendar events as cards positioned
 * by time, each with its prep progress and one tap to its notes.
 * Dragging a task card onto an empty slot time-blocks it (§4.6);
 * dragging onto an event attaches it as prep.
 */
export function Timeline({ date }: { date: string }): React.JSX.Element {
  const events = useLiveQuery(() => window.api.calendarEvents(date, date), [date]) ?? []
  const tasks = useLiveQuery(() => window.api.tasksFor(date), [date]) ?? []
  const eventKeys = events.map((e) => e.eventKey).join(',')
  const prep = useLiveQuery(() => window.api.prepProgress(events.map((e) => e.eventKey)), [eventKeys]) ?? []

  // Re-render every minute so the "now" line crawls.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const timed = events.filter((e) => e.startTime)
  const allDay = events.filter((e) => !e.startTime)
  const blocks = tasks.filter((t) => t.scheduledTime)

  // The visible window: at least 08:00–18:00, stretched to fit the day.
  const startMins = [...timed.map((e) => toMin(e.startTime!)), ...blocks.map((b) => toMin(b.scheduledTime!)), 8 * 60]
  const endMins = [...timed.map((e) => toMin(e.endTime ?? e.startTime!) + 15), ...blocks.map((b) => toMin(b.scheduledTime!) + 30), 18 * 60]
  const dayStart = Math.floor(Math.min(...startMins) / 60) * 60
  const dayEnd = Math.ceil(Math.max(...endMins) / 60) * 60
  const y = (mins: number): number => (mins - dayStart) * PX_PER_MIN

  const nowMins = toMin(hhmm(now))
  const isToday = date === todayYmd()

  if (events.length === 0 && blocks.length === 0) {
    return <EmptyState art="🏝️">No meetings today. A whole day of unbroken time.</EmptyState>
  }

  return (
    <div>
      {allDay.map((e) => (
        <div key={e.eventKey} className="pill" style={{ marginBottom: 8 }}>
          🗓️ {e.title} · all day
        </div>
      ))}
      <div className="timeline" style={{ height: (dayEnd - dayStart) * PX_PER_MIN }}>
        {/* hour gridlines */}
        {Array.from({ length: (dayEnd - dayStart) / 60 + 1 }, (_, i) => {
          const mins = dayStart + i * 60
          return (
            <div key={mins} className="timeline-hour" style={{ top: y(mins) }}>
              <span>{fmtHour(mins / 60)}</span>
            </div>
          )
        })}

        {/* invisible 30-minute drop slots for time blocking */}
        {Array.from({ length: (dayEnd - dayStart) / SLOT_MIN }, (_, i) => {
          const mins = dayStart + i * SLOT_MIN
          const time = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
          return <TimeSlot key={time} date={date} time={time} top={y(mins)} height={SLOT_MIN * PX_PER_MIN} />
        })}

        {/* meeting cards */}
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
              prepDone={p?.done ?? 0}
              prepTotal={p?.total ?? 0}
              past={past}
            />
          )
        })}

        {/* time-blocked tasks */}
        {blocks.map((t) => {
          const start = toMin(t.scheduledTime!)
          const dur = t.timeEstimateMinutes ?? 30
          // A missed block just fades — the task is still in the list.
          const missed = isToday && start + dur < nowMins && t.status === 'active'
          return (
            <div
              key={t.id}
              className={`timeline-task ${t.status === 'done' ? 'done' : ''} ${missed ? 'missed' : ''}`}
              style={{ top: y(start), height: Math.max(dur * PX_PER_MIN, 26) }}
              title={missed ? 'Missed the block — no big deal, it’s still on your list' : t.title}
            >
              {t.status === 'done' ? '✓ ' : ''}
              {t.title}
            </div>
          )
        })}

        {/* the "now" line */}
        {isToday && nowMins >= dayStart && nowMins <= dayEnd && (
          <div className="timeline-now" style={{ top: y(nowMins) }} />
        )}
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
      {isOver && <span className="pill">⏱ {time}</span>}
    </div>
  )
}

function EventBlock({
  event,
  top,
  height,
  prepDone,
  prepTotal,
  past
}: {
  event: CalendarEvent
  top: number
  height: number
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
      style={{ top, height }}
      onClick={() =>
        navigate({ name: 'meeting', eventKey: event.eventKey, title: event.title, date: event.date })
      }
    >
      <div className="row" style={{ gap: 6 }}>
        <b>{event.title}</b>
        <span style={{ color: 'var(--text-soft)', fontSize: 12 }}>
          {event.startTime}
          {event.endTime ? `–${event.endTime}` : ''}
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

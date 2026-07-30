import { useState } from 'react'
import type { CalendarEvent } from '@shared/types'
import { todayYmd, ymd, ymdAddDays } from '@shared/dates'
import { useLiveQuery } from '../state/data'
import { useNav } from '../state/nav'
import { BackButton } from '../components/bits'

/**
 * The Calendar screen: a month at a glance, past and future. Every
 * meeting is a chip; clicking one opens that meeting's notes/prep —
 * so old notes are reachable by remembering roughly *when* the
 * meeting happened, not what it was called.
 */
export function CalendarScreen(): React.JSX.Element {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth()) // 0-based
  const { navigate } = useNav()

  // The visible grid: 6 weeks starting on the Sunday before the 1st.
  const first = new Date(year, month, 1)
  const gridStart = ymd(new Date(year, month, 1 - first.getDay()))
  const gridDates = Array.from({ length: 42 }, (_, i) => ymdAddDays(gridStart, i))
  const gridEnd = gridDates[gridDates.length - 1]

  const events =
    useLiveQuery(() => window.api.calendarEvents(gridStart, gridEnd), [gridStart, gridEnd]) ?? []
  const byDate = new Map<string, CalendarEvent[]>()
  for (const e of events) {
    byDate.set(e.date, [...(byDate.get(e.date) ?? []), e])
  }

  const today = todayYmd()
  const monthLabel = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`

  const shift = (delta: number): void => {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
  }

  return (
    <div className="canvas cal-screen">
      <header className="canvas-header">
        <BackButton />
        <h1>Calendar</h1>
        <span className="date">{monthLabel}</span>
        <span className="row" style={{ marginLeft: 'auto' }}>
          <button className="btn ghost icon-btn" title="Previous month" onClick={() => shift(-1)}>
            ‹
          </button>
          {(year !== now.getFullYear() || month !== now.getMonth()) && (
            <button
              className="btn ghost"
              onClick={() => {
                setYear(now.getFullYear())
                setMonth(now.getMonth())
              }}
            >
              today
            </button>
          )}
          <button className="btn ghost icon-btn" title="Next month" onClick={() => shift(1)}>
            ›
          </button>
        </span>
      </header>

      <div className="cal-weekdays">
        {gridDates.slice(0, 7).map((d) => {
          const [y, m, dd] = d.split('-').map(Number)
          return (
            <span key={d}>
              {new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'short' })}
            </span>
          )
        })}
      </div>

      <div className="cal-grid">
        {gridDates.map((date) => {
          const dayEvents = byDate.get(date) ?? []
          const inMonth = date.startsWith(monthPrefix)
          return (
            <div
              key={date}
              className={`cal-cell ${inMonth ? '' : 'dim'} ${date === today ? 'today' : ''}`}
            >
              <div className="cal-daynum">{Number(date.slice(8))}</div>
              {/* Every event renders; a crowded day scrolls inside its
                  own cell instead of clipping behind a "+n more". */}
              <div className="cal-cell-events">
                {dayEvents.map((e) => (
                  <button
                    key={e.eventKey}
                    className="cal-event"
                    title={`${e.title}${e.startTime ? ` · ${e.startTime}` : ''} — open notes`}
                    onClick={() =>
                      navigate({ name: 'meeting', eventKey: e.eventKey, title: e.title, date: e.date })
                    }
                  >
                    {e.startTime && <span className="cal-time">{e.startTime}</span>} {e.title}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

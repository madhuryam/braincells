import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { CalendarEvent } from '@shared/types'
import { todayYmd, ymd, ymdAddDays } from '@shared/dates'
import { useLiveQuery } from '../state/data'
import { useNav } from '../state/nav'
import { useLabels } from '../state/labels'
import { BackButton } from '../components/bits'
import { ampm } from '../format'

// The rolling window: this many weeks behind/ahead of the current one.
const WEEKS_BACK = 8
const WEEKS_FORWARD = 16
const TOTAL_WEEKS = WEEKS_BACK + WEEKS_FORWARD + 1

/** 'August 2026' for a week (its Wednesday names the month). */
function weekMonthLabel(gridStart: string, weekIdx: number): string {
  const [y, m, d] = ymdAddDays(gridStart, weekIdx * 7 + 3).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/**
 * The Calendar screen: continuously scrolling weeks, a few tall rows
 * at a time, so meetings read as a list instead of squeezing into a
 * six-row month grid. Every meeting is a chip; clicking one opens that
 * meeting's notes/prep — so old notes are reachable by remembering
 * roughly *when* the meeting happened, not what it was called.
 */
export function CalendarScreen(): React.JSX.Element {
  const { openOverlay } = useNav()
  const labels = useLabels()

  // The visible window starts on the Sunday WEEKS_BACK weeks ago.
  const today = todayYmd()
  const [ty, tm, td] = today.split('-').map(Number)
  const gridStart = ymd(new Date(ty, tm - 1, td - new Date(ty, tm - 1, td).getDay() - WEEKS_BACK * 7))
  const gridDates = Array.from({ length: TOTAL_WEEKS * 7 }, (_, i) => ymdAddDays(gridStart, i))
  const gridEnd = gridDates[gridDates.length - 1]

  const events =
    useLiveQuery(() => window.api.calendarEvents(gridStart, gridEnd), [gridStart, gridEnd]) ?? []
  const byDate = new Map<string, CalendarEvent[]>()
  for (const e of events) {
    byDate.set(e.date, [...(byDate.get(e.date) ?? []), e])
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const [monthLabel, setMonthLabel] = useState(() => weekMonthLabel(gridStart, WEEKS_BACK))

  // One scroll step = one week row (cell height + grid gap).
  const rowStride = (): number => {
    const cell = scrollRef.current?.querySelector<HTMLElement>('.cal-cell')
    return cell ? cell.offsetHeight + 6 : 160
  }

  // Open on the current week.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: WEEKS_BACK * rowStride() })
  }, [])

  const onScroll = (): void => {
    const idx = Math.round(scrollRef.current!.scrollTop / rowStride())
    setMonthLabel(weekMonthLabel(gridStart, Math.max(0, Math.min(TOTAL_WEEKS - 1, idx))))
  }
  const scrollWeeks = (n: number): void =>
    scrollRef.current?.scrollBy({ top: n * rowStride(), behavior: 'smooth' })
  const scrollToToday = (): void =>
    scrollRef.current?.scrollTo({ top: WEEKS_BACK * rowStride(), behavior: 'smooth' })

  return (
    <div className="canvas cal-screen">
      <header className="canvas-header">
        <BackButton />
        <h1>Calendar</h1>
        <span className="date">{monthLabel}</span>
        <span className="row" style={{ marginLeft: 'auto' }}>
          <button className="btn ghost icon-btn" title="Back a month" onClick={() => scrollWeeks(-4)}>
            ‹
          </button>
          <button className="btn ghost" onClick={scrollToToday}>
            today
          </button>
          <button className="btn ghost icon-btn" title="Forward a month" onClick={() => scrollWeeks(4)}>
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

      <div className="cal-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="cal-grid">
          {gridDates.map((date) => {
            const dayEvents = byDate.get(date) ?? []
            const dayNum = Number(date.slice(8))
            const [y, m] = date.split('-').map(Number)
            return (
              <div key={date} className={`cal-cell ${date === today ? 'today' : ''}`}>
                {/* The 1st of a month names it — the scroll has no
                    month boundaries otherwise. */}
                <div className={`cal-daynum ${dayNum === 1 ? 'month-start' : ''}`}>
                  {dayNum === 1
                    ? new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                    : dayNum}
                </div>
                {/* Every event renders; a crowded day scrolls inside
                    its own cell instead of clipping behind a "+n more". */}
                <div className="cal-cell-events">
                  {dayEvents.map((e) => {
                    // Google label colors carry through: the chip tints
                    // with the label, and hovering shows it full-strength.
                    const color = labels.of(e)
                    return (
                      <button
                        key={e.eventKey}
                        className="cal-event"
                        style={
                          color
                            ? ({
                                '--ev': color.hex,
                                '--ev-soft': `color-mix(in srgb, ${color.hex} 22%, var(--bg-card))`
                              } as CSSProperties)
                            : undefined
                        }
                        title={`${e.title}${e.startTime ? ` · ${ampm(e.startTime)}` : ''}${color ? ` · ${color.name}` : ''} — open notes`}
                        onClick={() =>
                          openOverlay({ name: 'meeting', eventKey: e.eventKey, title: e.title, date: e.date })
                        }
                      >
                        {e.startTime && <span className="cal-time">{ampm(e.startTime)}</span>} {e.title}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

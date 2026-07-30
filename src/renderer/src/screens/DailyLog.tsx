import { useEffect, useState } from 'react'
import { todayYmd, ymdAddDays } from '@shared/dates'
import type { CalendarEvent } from '@shared/types'
import { useLiveQuery, useMutate } from '../state/data'
import { useNav } from '../state/nav'
import { Card } from '../components/Card'
import { AllDayBar } from '../components/AllDayBar'
import { DetailPanel } from '../components/DetailPanel'
import { ItemDetail } from '../components/ItemDetail'
import { Meeting } from './Meeting'
import { BackButton, EmptyState } from '../components/bits'
import { KIND_ICON, longDate } from '../format'

/**
 * The weekly log (SPEC §4.5): an automatic answer to "what did I even
 * do this week" — one collapsible block per day (journal, meetings,
 * done), a week at a time. Clicking a meeting or item peeks it in a
 * right-hand detail panel instead of leaving the screen.
 */

/** What the detail panel is currently showing. */
type Detail =
  | { kind: 'meeting'; eventKey: string; title: string; date: string }
  | { kind: 'item'; itemId: string }

/** Monday of the week containing `date`. */
function weekStartOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const weekday = new Date(y, m - 1, d).getDay() // 0 = Sunday
  return ymdAddDays(date, -((weekday + 6) % 7))
}

function monthDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function DailyLog(): React.JSX.Element {
  const today = todayYmd()
  const [weekStart, setWeekStart] = useState(weekStartOf(today))
  const weekEnd = ymdAddDays(weekStart, 6)
  const days = Array.from({ length: 7 }, (_, i) => ymdAddDays(weekStart, i))
  const events =
    useLiveQuery(() => window.api.calendarEvents(weekStart, weekEnd), [weekStart]) ?? []

  // Today starts open; every other day is a header until clicked.
  const [openDays, setOpenDays] = useState<Set<string>>(new Set([today]))
  const [detail, setDetail] = useState<Detail | null>(null)
  const { navigate } = useNav()

  const toggleDay = (d: string): void =>
    setOpenDays((prev) => {
      const next = new Set(prev)
      if (next.has(d)) next.delete(d)
      else next.add(d)
      return next
    })

  return (
    <div
      className="canvas"
      style={{ '--canvas-max': detail ? '1500px' : '760px' } as React.CSSProperties}
    >
      <header className="canvas-header">
        <BackButton />
        <h1>Daily Log</h1>
        <span className="date">
          {monthDay(weekStart)} – {monthDay(weekEnd)}
        </span>
        <span className="row" style={{ marginLeft: 'auto' }}>
          <button className="btn ghost" onClick={() => setWeekStart(ymdAddDays(weekStart, -7))}>
            ←
          </button>
          {weekStart !== weekStartOf(today) && (
            <button className="btn ghost" onClick={() => setWeekStart(weekStartOf(today))}>
              this week
            </button>
          )}
          <button
            className="btn ghost"
            disabled={weekStart === weekStartOf(today)}
            onClick={() => setWeekStart(ymdAddDays(weekStart, 7))}
          >
            →
          </button>
        </span>
      </header>

      <div className={detail ? 'log-split' : undefined}>
        <div className="log-main">
          {days.map((d) => (
            <DayBlock
              key={d}
              date={d}
              isToday={d === today}
              open={openDays.has(d)}
              onToggle={() => toggleDay(d)}
              events={events.filter((e) => e.date === d)}
              onPeek={setDetail}
            />
          ))}
        </div>

        {detail && (
          <DetailPanel
            title={detail.kind === 'meeting' ? detail.title : undefined}
            onOpenFull={
              detail.kind === 'meeting'
                ? () =>
                    navigate({
                      name: 'meeting',
                      eventKey: detail.eventKey,
                      title: detail.title,
                      date: detail.date
                    })
                : undefined
            }
            onClose={() => setDetail(null)}
          >
            {detail.kind === 'meeting' ? (
              <Meeting
                key={detail.eventKey}
                embedded
                eventKey={detail.eventKey}
                title={detail.title}
                date={detail.date}
              />
            ) : (
              <ItemDetail key={detail.itemId} itemId={detail.itemId} />
            )}
          </DetailPanel>
        )}
      </div>
    </div>
  )
}

function DayBlock({
  date,
  isToday,
  open,
  onToggle,
  events,
  onPeek
}: {
  date: string
  isToday: boolean
  open: boolean
  onToggle: () => void
  events: CalendarEvent[]
  onPeek: (d: Detail) => void
}): React.JSX.Element {
  const completed = useLiveQuery(() => window.api.completedOn(date), [date]) ?? []

  return (
    <section>
      <button className="section-label day-toggle" onClick={onToggle}>
        {open ? '▾' : '▸'} {isToday ? 'today · ' : ''}
        {longDate(date)}
        {events.length > 0 && <span className="pill">📅 {events.length}</span>}
        {completed.length > 0 && <span className="pill">✅ {completed.length}</span>}
      </button>

      {open && (
        <div className="stack day-content">
          <DayJournal date={date} />

          {events.length === 0 && completed.length === 0 && (
            <EmptyState art="🏝️">No meetings, nothing checked off this day.</EmptyState>
          )}

          <AllDayBar events={events} />
          {events.filter((ev) => ev.startTime).map((ev) => (
            <Card
              key={ev.eventKey}
              interactive
              onClick={() =>
                onPeek({ kind: 'meeting', eventKey: ev.eventKey, title: ev.title, date: ev.date })
              }
            >
              <div className="row">
                <span className="card-title">📅 {ev.title}</span>
                {ev.startTime && <span className="pill">{ev.startTime}</span>}
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-soft)' }}>
                  peek →
                </span>
              </div>
            </Card>
          ))}

          {completed.map((item) => (
            <Card key={item.id} interactive done onClick={() => onPeek({ kind: 'item', itemId: item.id })}>
              <div className="row">
                <span aria-hidden>{KIND_ICON[item.kind]}</span>
                <span className="card-title">{item.title || 'Untitled'}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-soft)' }}>
                  peek →
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * Mounted only while its day is expanded — journalFor() creates the
 * day's journal item on first access, and collapsed days shouldn't
 * spawn seven empty journals a week.
 */
function DayJournal({ date }: { date: string }): React.JSX.Element {
  const journal = useLiveQuery(() => window.api.journalFor(date), [date])
  const mutate = useMutate()
  const [text, setText] = useState('')
  useEffect(() => setText(journal?.content ?? ''), [journal?.id])

  const save = (): void => {
    if (journal && text !== journal.content) {
      mutate(() => window.api.updateItem(journal.id, { content: text }))
    }
  }

  return (
    <textarea
      rows={3}
      style={{ width: '100%', resize: 'vertical' }}
      placeholder="Free-form. How did the day actually go?"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
    />
  )
}

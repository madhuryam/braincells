import { useEffect, useState } from 'react'
import { todayYmd, ymdAddDays } from '@shared/dates'
import { useLiveQuery, useMutate } from '../state/data'
import { useNav } from '../state/nav'
import { Card } from '../components/Card'
import { ItemCard } from '../components/ItemCard'
import { EmptyState } from '../components/bits'
import { longDate } from '../format'

/**
 * The daily log (SPEC §4.5): an automatic answer to "what did I even
 * do this week". Nothing here is written by hand except the journal —
 * completed tasks and meetings are assembled live from the database
 * and calendar for whichever day is shown.
 */
export function DailyLog(): React.JSX.Element {
  const [date, setDate] = useState(todayYmd())
  const completed = useLiveQuery(() => window.api.completedOn(date), [date]) ?? []
  const meetings = useLiveQuery(() => window.api.calendarEvents(date, date), [date]) ?? []
  const journal = useLiveQuery(() => window.api.journalFor(date), [date])
  const mutate = useMutate()
  const { navigate } = useNav()

  const [journalText, setJournalText] = useState('')
  useEffect(() => setJournalText(journal?.content ?? ''), [journal?.id])

  const saveJournal = (): void => {
    if (journal && journalText !== journal.content) {
      mutate(() => window.api.updateItem(journal.id, { content: journalText }))
    }
  }

  return (
    <div className="canvas" style={{ maxWidth: 760 }}>
      <header className="canvas-header">
        <h1>Daily Log</h1>
        <span className="date">{longDate(date)}</span>
        <span className="row" style={{ marginLeft: 'auto' }}>
          <button className="btn ghost" onClick={() => setDate(ymdAddDays(date, -1))}>
            ←
          </button>
          {date !== todayYmd() && (
            <button className="btn ghost" onClick={() => setDate(todayYmd())}>
              today
            </button>
          )}
          <button
            className="btn ghost"
            disabled={date === todayYmd()}
            onClick={() => setDate(ymdAddDays(date, 1))}
          >
            →
          </button>
        </span>
      </header>

      <div className="section-label">Journal</div>
      <textarea
        rows={5}
        style={{ width: '100%', resize: 'vertical' }}
        placeholder="Free-form. How did the day actually go?"
        value={journalText}
        onChange={(e) => setJournalText(e.target.value)}
        onBlur={saveJournal}
      />

      <div className="section-label">Meetings</div>
      {meetings.length === 0 && (
        <EmptyState art="🏝️">No meetings this day.</EmptyState>
      )}
      <div className="stack">
        {meetings.map((ev) => (
          <Card
            key={ev.eventKey}
            interactive
            onClick={() =>
              navigate({ name: 'meeting', eventKey: ev.eventKey, title: ev.title, date: ev.date })
            }
          >
            <div className="row">
              <span className="card-title">📅 {ev.title}</span>
              {ev.startTime && <span className="pill">{ev.startTime}</span>}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-soft)' }}>
                notes ↗
              </span>
            </div>
          </Card>
        ))}
      </div>

      <div className="section-label">Done</div>
      {completed.length === 0 && (
        <EmptyState art="🍃">Nothing checked off — days like that count too.</EmptyState>
      )}
      <div className="stack">
        {completed.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}

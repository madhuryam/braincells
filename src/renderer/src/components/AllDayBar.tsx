import type { CalendarEvent } from '@shared/types'
import { useNav } from '../state/nav'

/**
 * All-day events as a quiet horizontal chip bar atop a day's timed
 * list — they describe the day, they don't occupy time on it. Hands
 * back nothing when the day has no all-day events.
 */
export function AllDayBar({ events }: { events: CalendarEvent[] }): React.JSX.Element | null {
  const { navigate } = useNav()
  const allDay = events.filter((e) => !e.startTime)
  if (allDay.length === 0) return null
  return (
    <div className="allday-bar">
      {allDay.map((e) => (
        <button
          key={e.eventKey}
          className="allday-chip"
          title={`${e.title} · all day — open notes`}
          onClick={() =>
            navigate({ name: 'meeting', eventKey: e.eventKey, title: e.title, date: e.date })
          }
        >
          🗓️ {e.title}
        </button>
      ))}
    </div>
  )
}

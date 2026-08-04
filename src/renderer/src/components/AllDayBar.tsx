import type { CalendarEvent } from '@shared/types'
import { useNav } from '../state/nav'
import { useLabels } from '../state/labels'

/**
 * All-day events as a quiet horizontal chip bar atop a day's timed
 * list — they describe the day, they don't occupy time on it. Hands
 * back nothing when the day has no all-day events.
 */
export function AllDayBar({ events }: { events: CalendarEvent[] }): React.JSX.Element | null {
  const { openOverlay } = useNav()
  const labels = useLabels()
  const allDay = events.filter((e) => !e.startTime)
  if (allDay.length === 0) return null
  return (
    <div className="allday-bar">
      {allDay.map((e) => {
        // A labeled all-day event swaps the generic 🗓️ for its color.
        const color = labels.of(e)
        return (
          <button
            key={e.eventKey}
            className="allday-chip"
            title={`${e.title} · all day${color ? ` · ${color.name}` : ''} — open notes`}
            onClick={() =>
              openOverlay({ name: 'meeting', eventKey: e.eventKey, title: e.title, date: e.date })
            }
          >
            {color ? <span className="allday-dot" style={{ background: color.hex }} /> : '🗓️'}{' '}
            {e.title}
          </button>
        )
      })}
    </div>
  )
}

import type { CalendarEvent } from '@shared/types'
import { useNav } from '../state/nav'
import { useLabels, type Label } from '../state/labels'
import { tipLines, useTip } from './Tooltip'

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
      {allDay.map((e) => (
        <AllDayChip
          key={e.eventKey}
          event={e}
          color={labels.of(e)}
          onOpen={() =>
            openOverlay({ name: 'meeting', eventKey: e.eventKey, title: e.title, date: e.date })
          }
        />
      ))}
    </div>
  )
}

/** One chip; a labeled all-day event swaps the generic 🗓️ for its color. */
function AllDayChip({
  event,
  color,
  onOpen
}: {
  event: CalendarEvent
  color: Label | undefined
  onOpen: () => void
}): React.JSX.Element {
  const tip = useTip(tipLines(event.title, '🕐 all day', color && `${color.name}`))
  return (
    <button className="allday-chip" {...tip} onClick={onOpen}>
      {color ? <span className="allday-dot" style={{ background: color.hex }} /> : '🗓️'}{' '}
      {event.title}
    </button>
  )
}

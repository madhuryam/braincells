import type { CalendarEvent } from '../../shared/types'

/**
 * Drops "Home"/"Office" work-location all-day events. Only all-day
 * events qualify — a timed meeting that happens to be called "Home"
 * is somebody's actual meeting. (Kept free of electron imports so
 * it's unit-testable.)
 */
export function withoutWorkLocationEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter((e) => !(e.startTime === null && /^(home|office)$/i.test(e.title.trim())))
}

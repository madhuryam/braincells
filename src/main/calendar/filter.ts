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

/**
 * Declining an invite doesn't delete the event — Google keeps it on
 * the calendar with responseStatus 'declined' and merely hides it in
 * its own UI. The feed drops those here: "I said no" means off the
 * schedule. (`self` marks which attendee is the connected account.)
 */
export function isDeclinedByMe(
  attendees?: Array<{ self?: boolean; responseStatus?: string }>
): boolean {
  return attendees?.some((a) => a.self && a.responseStatus === 'declined') ?? false
}

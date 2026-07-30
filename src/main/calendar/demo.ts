import { eventKeyOf, type CalendarEvent, type CalendarLabel } from '../../shared/types'
import { ymdAddDays } from '../../shared/dates'

/**
 * The built-in demo calendar: a believable week of meetings generated
 * deterministically from the date, so the whole meeting loop (prep,
 * notes, follow-ups) is usable before Google is connected — and so it
 * can be tested without any network at all.
 */

/** Color labels the demo events use — same ids as Google's palette. */
export const DEMO_LABELS: CalendarLabel[] = [
  { id: '3', color: '#dbadff', name: 'Grape' },
  { id: '5', color: '#fbd75b', name: 'Banana' },
  { id: '7', color: '#46d6db', name: 'Peacock' },
  { id: '10', color: '#51b749', name: 'Basil' }
]

// title, start, end, and which weekdays it occurs on (0=Sun … 6=Sat)
const TEMPLATES: Array<{
  id: string
  title: string
  start: string
  end: string
  days: number[]
  colorId?: string
}> = [
  { id: 'demo-standup', title: 'Standup', start: '09:30', end: '09:45', days: [1, 2, 3, 4, 5], colorId: '10' },
  { id: 'demo-planning', title: 'Weekly planning', start: '10:00', end: '11:00', days: [1], colorId: '7' },
  { id: 'demo-1on1-sam', title: '1:1 with Sam', start: '14:00', end: '14:30', days: [2], colorId: '5' },
  { id: 'demo-design', title: 'Design review', start: '11:00', end: '12:00', days: [3], colorId: '3' },
  { id: 'demo-product', title: 'Product sync', start: '15:00', end: '15:45', days: [4] },
  { id: 'demo-friday', title: 'Demo Friday 🎉', start: '16:00', end: '17:00', days: [5] }
]

export function demoEvents(startDate: string, endDate: string): CalendarEvent[] {
  const events: CalendarEvent[] = []
  for (let date = startDate; date <= endDate; date = ymdAddDays(date, 1)) {
    const [y, m, d] = date.split('-').map(Number)
    const weekday = new Date(y, m - 1, d).getDay()
    for (const t of TEMPLATES) {
      if (t.days.includes(weekday)) {
        events.push({
          eventKey: eventKeyOf(t.id, date),
          title: t.title,
          date,
          startTime: t.start,
          endTime: t.end,
          colorId: t.colorId ?? null
        })
      }
    }
  }
  return events
}

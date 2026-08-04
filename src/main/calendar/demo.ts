import { eventKeyOf, type CalendarEvent } from '../../shared/types'
import { ymdAddDays } from '../../shared/dates'

/**
 * The built-in demo calendar: a believable week of meetings generated
 * deterministically from the date, so the whole meeting loop (prep,
 * notes, follow-ups) is usable before Google is connected — and so it
 * can be tested without any network at all.
 */

// title, start, end, which weekdays it occurs on (0=Sun … 6=Sat), and
// a Google label colorId — so the label color-coding shows in demo mode
const TEMPLATES: Array<{
  id: string
  title: string
  start: string
  end: string
  days: number[]
  colorId?: string
}> = [
  { id: 'demo-standup', title: 'Standup', start: '09:30', end: '09:45', days: [1, 2, 3, 4, 5], colorId: '2' },
  { id: 'demo-planning', title: 'Weekly planning', start: '10:00', end: '11:00', days: [1], colorId: '7' },
  { id: 'demo-1on1-sam', title: '1:1 with Sam', start: '14:00', end: '14:30', days: [2], colorId: '4' },
  { id: 'demo-design', title: 'Design review', start: '11:00', end: '12:00', days: [3], colorId: '3' },
  { id: 'demo-product', title: 'Product sync', start: '15:00', end: '15:45', days: [4], colorId: '6' },
  { id: 'demo-friday', title: 'Demo Friday 🎉', start: '16:00', end: '17:00', days: [5] }
]

// All-day entries (startTime null): work-location days like a synced
// work calendar would have, plus one that isn't — so the Home/Office
// filter demonstrably hides only what it should.
const ALL_DAY: Array<{ id: string; title: string; days: number[] }> = [
  { id: 'demo-loc-home', title: 'Home', days: [1, 3, 5] },
  { id: 'demo-loc-office', title: 'Office', days: [2, 4] },
  { id: 'demo-focus', title: 'Focus day 🧘', days: [3] }
]

export function demoEvents(startDate: string, endDate: string): CalendarEvent[] {
  const events: CalendarEvent[] = []
  for (let date = startDate; date <= endDate; date = ymdAddDays(date, 1)) {
    const [y, m, d] = date.split('-').map(Number)
    const weekday = new Date(y, m - 1, d).getDay()
    for (const a of ALL_DAY) {
      if (a.days.includes(weekday)) {
        events.push({
          eventKey: eventKeyOf(a.id, date),
          title: a.title,
          date,
          startTime: null,
          endTime: null
        })
      }
    }
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

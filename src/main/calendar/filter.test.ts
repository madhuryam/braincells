import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '../../shared/types'
import { withoutWorkLocationEvents } from './filter'

const ev = (title: string, startTime: string | null): CalendarEvent => ({
  eventKey: `${title}::2026-07-30`,
  title,
  date: '2026-07-30',
  startTime,
  endTime: startTime ? '10:00' : null
})

describe('work-location filter', () => {
  it('drops Home/Office all-day events, keeps everything else', () => {
    const events = [
      ev('Home', null),
      ev('office', null), // case-insensitive
      ev(' Office ', null), // whitespace-tolerant
      ev('Focus day 🧘', null), // other all-day events stay
      ev('Home', '09:00'), // a timed meeting named Home is a real meeting
      ev('Standup', '09:30')
    ]
    expect(withoutWorkLocationEvents(events).map((e) => e.title)).toEqual([
      'Focus day 🧘',
      'Home',
      'Standup'
    ])
  })
})

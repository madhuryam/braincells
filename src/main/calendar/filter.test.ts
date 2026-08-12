import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '../../shared/types'
import { isDeclinedByMe, withoutWorkLocationEvents } from './filter'

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

describe('declined-invite filter', () => {
  it('drops an event only when the connected account itself declined', () => {
    // I declined → gone, no matter what others said.
    expect(
      isDeclinedByMe([
        { responseStatus: 'accepted' },
        { self: true, responseStatus: 'declined' }
      ])
    ).toBe(true)
    // Someone ELSE declined → still my meeting.
    expect(
      isDeclinedByMe([
        { responseStatus: 'declined' },
        { self: true, responseStatus: 'accepted' }
      ])
    ).toBe(false)
    // Tentative / needsAction / no answer yet → keep showing it.
    expect(isDeclinedByMe([{ self: true, responseStatus: 'tentative' }])).toBe(false)
    expect(isDeclinedByMe([{ self: true, responseStatus: 'needsAction' }])).toBe(false)
    // Own events without attendees (solo blocks, self-created) stay.
    expect(isDeclinedByMe(undefined)).toBe(false)
    expect(isDeclinedByMe([])).toBe(false)
  })
})

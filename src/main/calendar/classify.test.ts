import { beforeEach, describe, expect, it } from 'vitest'
import { Store } from '../store'
import { autoFileMeetingsByLabel } from './classify'
import type { CalendarEvent } from '../../shared/types'

let store: Store

beforeEach(() => {
  store = new Store(':memory:')
})

const event = (key: string, colorId: string | null): CalendarEvent => ({
  eventKey: key,
  title: 'Design review',
  date: '2026-07-30',
  startTime: '10:00',
  endTime: '11:00',
  colorId
})

describe('label → project auto-filing', () => {
  it('files labeled meetings into the associated project', () => {
    const p = store.createProject('IØ', '#339af0')
    store.setSetting('calendarLabels', { '9': { projectId: p.id } })

    const filed = autoFileMeetingsByLabel(store, [
      event('ev-1::2026-07-30', '9'),
      event('ev-2::2026-07-30', '3'), // unassociated label
      event('ev-3::2026-07-30', null) // no label
    ])

    expect(filed).toBe(1)
    expect(store.getMeeting('ev-1::2026-07-30')?.projectId).toBe(p.id)
    expect(store.getMeeting('ev-2::2026-07-30')).toBeNull()
    expect(store.getMeeting('ev-3::2026-07-30')).toBeNull()
  })

  it('never overrides an existing decision — even "no project"', () => {
    const p = store.createProject('IØ', '#339af0')
    store.setSetting('calendarLabels', { '9': { projectId: p.id } })
    // A human already said "no project" for this one.
    store.assignMeetingProject(
      { eventKey: 'ev-1::2026-07-30', title: 'Design review', date: '2026-07-30' },
      null
    )

    const filed = autoFileMeetingsByLabel(store, [event('ev-1::2026-07-30', '9')])

    expect(filed).toBe(0)
    expect(store.getMeeting('ev-1::2026-07-30')?.projectId).toBeNull()
  })

  it('ignores associations to archived projects', () => {
    const p = store.createProject('Old', '#339af0')
    store.updateProject(p.id, { status: 'archived' })
    store.setSetting('calendarLabels', { '9': { projectId: p.id } })

    expect(autoFileMeetingsByLabel(store, [event('ev-1::2026-07-30', '9')])).toBe(0)
    expect(store.getMeeting('ev-1::2026-07-30')).toBeNull()
  })

  it('is a no-op when no label has a project', () => {
    store.setSetting('calendarLabels', { '9': { name: 'Deep work' } })
    expect(autoFileMeetingsByLabel(store, [event('ev-1::2026-07-30', '9')])).toBe(0)
  })
})

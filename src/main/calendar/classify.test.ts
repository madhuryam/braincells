import { beforeEach, describe, expect, it } from 'vitest'
import { Store } from '../store'
import { autoClassifyMeetings } from './classify'
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

describe('label auto-classification', () => {
  it('files labeled meetings into the mapped project', () => {
    const p = store.createProject('IØ', '#339af0')
    store.setSetting('labelProjects', { '9': p.id })

    autoClassifyMeetings(store, [event('ev-1::2026-07-30', '9'), event('ev-2::2026-07-30', '3')])

    expect(store.getMeeting('ev-1::2026-07-30')?.projectId).toBe(p.id)
    expect(store.getMeeting('ev-2::2026-07-30')).toBeNull() // unmapped label
  })

  it('never overrides an existing decision, even "no project"', () => {
    const p = store.createProject('IØ', '#339af0')
    store.setSetting('labelProjects', { '9': p.id })
    // The user explicitly unassigned this meeting.
    store.assignMeetingProject({ eventKey: 'ev-1::2026-07-30', title: 'x', date: '2026-07-30' }, null)

    autoClassifyMeetings(store, [event('ev-1::2026-07-30', '9')])

    expect(store.getMeeting('ev-1::2026-07-30')?.projectId).toBeNull()
  })

  it('ignores mappings to deleted projects and unlabeled events', () => {
    store.setSetting('labelProjects', { '9': 'gone-project-id' })

    autoClassifyMeetings(store, [event('ev-1::2026-07-30', '9'), event('ev-2::2026-07-30', null)])

    expect(store.getMeeting('ev-1::2026-07-30')).toBeNull()
    expect(store.getMeeting('ev-2::2026-07-30')).toBeNull()
  })
})

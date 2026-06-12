import { describe, expect, it } from 'vitest'
import { parseShorthand } from './shorthand'
import { todayYmd, ymdAddDays } from './dates'

const projects = [
  { id: 'p1', name: 'Money stuff' },
  { id: 'p2', name: 'Roadmap' }
]

describe('parseShorthand', () => {
  it('plain text passes through untouched', () => {
    const r = parseShorthand('call the dentist', projects)
    expect(r).toEqual({
      title: 'call the dentist',
      projectId: null,
      scheduledDate: null,
      isTask: false
    })
  })

  it('#project matches by case-insensitive prefix', () => {
    const r = parseShorthand('pay rent #money', projects)
    expect(r.projectId).toBe('p1')
    expect(r.title).toBe('pay rent')
  })

  it('!today and !tomorrow schedule (and imply a task)', () => {
    expect(parseShorthand('standup prep !today', projects).scheduledDate).toBe(todayYmd())
    const r = parseShorthand('buy cake !tomorrow #road', projects)
    expect(r).toEqual({
      title: 'buy cake',
      projectId: 'p2',
      scheduledDate: ymdAddDays(todayYmd(), 1),
      isTask: true
    })
  })

  it('unknown tags degrade gracefully — they stay in the title', () => {
    const r = parseShorthand('read #thatbook !sometime', projects)
    expect(r).toEqual({
      title: 'read #thatbook !sometime',
      projectId: null,
      scheduledDate: null,
      isTask: false
    })
  })

  it('a lone # is not a tag', () => {
    expect(parseShorthand('issue # 42', projects).title).toBe('issue # 42')
  })
})

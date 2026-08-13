import { describe, expect, it } from 'vitest'
import type { Collision } from '@dnd-kit/core'
import { preferEventPrep } from './dndCollision'

// Drop targets, by id, mimicking the timeline: a meeting block and the
// invisible 15-minute time-blocking slots that sit over the same pixels.
const TYPE: Record<string, string> = {
  'event-standup': 'event-prep',
  'slot-09:00': 'timeblock',
  'slot-09:15': 'timeblock',
  'project-abc': 'project'
}
const typeOf = (id: string | number): string | undefined => TYPE[String(id)]
const c = (id: string): Collision => ({ id })

describe('preferEventPrep', () => {
  it('lets a meeting win when it overlaps time-blocking slots', () => {
    // The regression: a task dragged onto a meeting must attach as prep,
    // not silently time-block, even when a slot collides too (and even
    // when the slot was ranked first by rect-distance).
    const collisions = [c('slot-09:00'), c('event-standup'), c('slot-09:15')]
    expect(preferEventPrep(collisions, typeOf)).toEqual([c('event-standup')])
  })

  it('leaves collisions untouched when no meeting is under the pointer', () => {
    const collisions = [c('slot-09:00'), c('project-abc')]
    expect(preferEventPrep(collisions, typeOf)).toBe(collisions)
  })

  it('handles an empty collision list', () => {
    expect(preferEventPrep([], typeOf)).toEqual([])
  })
})

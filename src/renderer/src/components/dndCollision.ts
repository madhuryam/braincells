import type { Collision, UniqueIdentifier } from '@dnd-kit/core'

/**
 * A meeting block on the timeline sits over the very same pixels as the
 * invisible 15-minute time-blocking slots (both are drop targets). When
 * the pointer is inside a meeting, the intent is "prep for this meeting"
 * — not "time-block a task at that minute" — so an event-prep target
 * wins the overlap.
 *
 * Without this tiebreak, whichever rect's centre happened to sit nearer
 * the pointer won, so dropping a task onto a meeting *silently
 * time-blocked it* instead of attaching it as prep — the whole
 * drag-a-task-into-a-meeting gesture stopped working. Pure and exported
 * so the behaviour has a unit test (dndCollision.test.ts).
 */
export function preferEventPrep(
  collisions: Collision[],
  typeOf: (id: UniqueIdentifier) => string | undefined
): Collision[] {
  const prep = collisions.find((c) => typeOf(c.id) === 'event-prep')
  return prep ? [prep] : collisions
}

import { todayYmd, ymdAddDays } from './dates'

export interface ParsedCapture {
  title: string
  projectId: string | null
  scheduledDate: string | null
  /** True when shorthand made this a dated task rather than a raw note. */
  isTask: boolean
}

/**
 * Optional inline shorthand for quick capture (SPEC §5):
 *
 *   "call bank #money !tomorrow"  →  task in project 'money', tomorrow
 *
 * - `#name` assigns a project (case-insensitive prefix match)
 * - `!today` / `!tomorrow` schedules it (which also makes it a task)
 *
 * Parsing failures degrade gracefully: an unknown `#tag` or `!word`
 * simply stays in the title and the capture lands as a plain inbox
 * item. Capture must never require a decision — or error.
 */
export function parseShorthand(
  raw: string,
  projects: Array<{ id: string; name: string }>
): ParsedCapture {
  let projectId: string | null = null
  let scheduledDate: string | null = null
  const keptWords: string[] = []

  for (const word of raw.trim().split(/\s+/)) {
    if (word.startsWith('#') && word.length > 1 && projectId === null) {
      const tag = word.slice(1).toLowerCase()
      const match = projects.find((p) => p.name.toLowerCase().startsWith(tag))
      if (match) {
        projectId = match.id
        continue
      }
    }
    if (word === '!today' && scheduledDate === null) {
      scheduledDate = todayYmd()
      continue
    }
    if (word === '!tomorrow' && scheduledDate === null) {
      scheduledDate = ymdAddDays(todayYmd(), 1)
      continue
    }
    keptWords.push(word)
  }

  return {
    title: keptWords.join(' '),
    projectId,
    scheduledDate,
    isTask: scheduledDate !== null
  }
}

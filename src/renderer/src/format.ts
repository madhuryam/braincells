import { todayYmd, ymdAddDays } from '@shared/dates'

/** 'today' / 'tomorrow' / 'yesterday' / 'Jun 12' — for date pills. */
export function prettyDate(date: string): string {
  const today = todayYmd()
  if (date === today) return 'today'
  if (date === ymdAddDays(today, 1)) return 'tomorrow'
  if (date === ymdAddDays(today, -1)) return 'yesterday'
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** 'Thursday, June 12' — for screen headers. */
export function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  })
}

export const KIND_ICON: Record<string, string> = {
  task: '✅',
  note: '📝',
  journal: '📓',
  prep: '🎯'
}

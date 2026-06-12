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

export function weekdayName(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long' })
}

export interface RollingDay {
  date: string
  /** 'today · Monday', 'tomorrow · Tuesday', then plain weekday names. */
  label: string
  /** Compact form for chips/keys: 'today', 'tmrw', 'Wed'… */
  chip: string
}

/**
 * The scheduling vocabulary: a 5-day rolling window starting today,
 * and beyond that only 'someday' (no date). Deliberately no date
 * picker required — five buttons cover the planning horizon.
 */
export function rollingDays(count = 5): RollingDay[] {
  const today = todayYmd()
  return Array.from({ length: count }, (_, i) => {
    const date = ymdAddDays(today, i)
    const weekday = weekdayName(date)
    return {
      date,
      label: i === 0 ? `today · ${weekday}` : i === 1 ? `tomorrow · ${weekday}` : weekday,
      chip: i === 0 ? 'today' : i === 1 ? 'tmrw' : weekday.slice(0, 3)
    }
  })
}

export const KIND_ICON: Record<string, string> = {
  task: '✅',
  note: '📝',
  journal: '📓',
  prep: '🎯'
}

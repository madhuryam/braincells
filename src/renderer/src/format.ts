import { todayYmd, ymdAddDays } from '@shared/dates'
import type { Project } from '@shared/types'

/** What tight spots (pills, chips) call a project: its nickname when
 *  one is set, the full name otherwise. Full-name surfaces (sidebar,
 *  Projects page, project headers) don't use this. */
export function projectLabel(p: Project): string {
  return p.nickname?.trim() || p.name
}

/** 'today' / 'tomorrow' / 'yesterday' / 'Jun 12' — for date pills. */
export function prettyDate(date: string): string {
  const today = todayYmd()
  if (date === today) return 'today'
  if (date === ymdAddDays(today, 1)) return 'tomorrow'
  if (date === ymdAddDays(today, -1)) return 'yesterday'
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** '06/12' — compact fixed-width date for dense rows. */
export function mmdd(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}`
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
  /** Group headers: 'today · Friday, June 13', 'tomorrow · Saturday, June 14', then 'Sunday, June 15'. */
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
    const [y, m, d] = date.split('-').map(Number)
    const full = new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    })
    const weekday = full.split(',')[0]
    return {
      date,
      label: i === 0 ? `today · ${full}` : i === 1 ? `tomorrow · ${full}` : full,
      chip: i === 0 ? 'today' : i === 1 ? 'tmrw' : weekday.slice(0, 3)
    }
  })
}

/** '14:30' → '2:30 PM'; '09:00' → '9 AM'. All displayed times are 12-hour. */
export function ampm(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const suffix = h < 12 ? 'AM' : 'PM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return m ? `${hour}:${String(m).padStart(2, '0')} ${suffix}` : `${hour} ${suffix}`
}

export const KIND_ICON: Record<string, string> = {
  task: '✓', // quiet check — the green ✅ shouted from every list
  note: '📝',
  journal: '📓',
  prep: '🎯',
  page: '📄'
}

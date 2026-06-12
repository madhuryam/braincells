// Tiny date helpers. Everything works on local wall-clock time as
// plain strings — see the conventions note in types.ts.

/** '2026-06-12' for a Date, in local time. */
export function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayYmd(): string {
  return ymd(new Date())
}

/** '2026-06-12 14:30:05' — the timestamp format stored in the database. */
export function nowStamp(): string {
  const d = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${ymd(d)} ${hh}:${mm}:${ss}`
}

export function ymdAddDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return ymd(dt)
}

/** 'HH:MM' for a Date, in local time. */
export function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

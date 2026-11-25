// Date/time formatting for Indian users. Always uses Indian conventions (DD/MM/YYYY)
// and India Standard Time, so server-rendered pages (servers run in UTC) and the
// browser show the same values.

const TZ = 'Asia/Kolkata'
type DateInput = string | number | Date | null | undefined

function toDate(v: DateInput): Date | null {
  if (v === null || v === undefined || v === '') return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 23 Nov 2026 */
export function formatDate(v: DateInput, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  const d = toDate(v)
  return d ? d.toLocaleDateString('en-IN', { timeZone: TZ, ...opts }) : '—'
}

/** 23 Nov 2026, 4:05 pm */
export function formatDateTime(v: DateInput): string {
  const d = toDate(v)
  return d ? d.toLocaleString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
}

/** 4:05 pm */
export function formatTime(v: DateInput): string {
  const d = toDate(v)
  return d ? d.toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }) : '—'
}

/** Hour of day (0–23) in India, for greetings. */
export function indiaHour(v: DateInput = new Date()): number {
  const d = toDate(v) ?? new Date()
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(d))
}

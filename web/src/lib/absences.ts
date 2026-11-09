// WebUntis absences: types, API calls, queries and formatting for /absences and the WebUntis card in Settings.
import { queryOptions } from '@tanstack/react-query'
import { ApiError, post, request } from './api'

export type AbsenceSync = { configured: boolean; lastSync: string | null; lastError: string | null; blocked: boolean; stale: boolean }

/** One absence entry of a day; times are minutes since midnight. `late` entries never count against attendance. */
export type AbsenceEntry = {
  id: number
  start: number
  end: number
  excused: boolean
  untisReason: string
  late: boolean
  lateMinutes: number
  /** Lesson numbers of the time grid, e.g. ["3", "4"]. */
  units: string[]
}

export type AbsenceDay = {
  date: string
  status: 'excused' | 'partial' | 'open'
  /** The owner's own reason: what goes into the letter. */
  reason: string
  exportedAt: string | null
  absences: AbsenceEntry[]
}

export type Absences = { sync: AbsenceSync; name: string; klasse: string; days: AbsenceDay[] }

export type SubjectStats = {
  subject: string
  subjectLong: string
  held: number
  excused: number
  unexcused: number
  present: number
  /** Present share in percent, null when no lesson was held. */
  percent: number | null
}

export type RangeKey = 's1' | 's2' | 'year'
export type SubjectGroup = { name: string; subjects: string[] }
export type Attendance = {
  /** null: nothing synced yet. */
  range: { key: RangeKey | 'custom'; start: string; end: string; current: 's1' | 's2' } | null
  total: SubjectStats | null
  subjects: SubjectStats[]
  groups: SubjectGroup[]
  allSubjects: string[]
}

export type UntisLogin = { configured: boolean; server: string; school: string; user: string; place: string }
export type UntisLoginInput = Omit<UntisLogin, 'configured'> & { password: string }

const enc = encodeURIComponent
const base = '/api/absences'

export const absencesApi = {
  days: () => request<Absences>(base),
  sync: (force: boolean) => post<AbsenceSync>(`${base}/sync?force=${force}`),
  reason: (date: string, reason: string) =>
    request<void>(`${base}/${date}/reason`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    }),
  attendance: (range?: RangeKey, from?: string, to?: string) =>
    request<Attendance>(`${base}/attendance?range=${range ?? ''}${from && to ? `&from=${from}&to=${to}` : ''}`),
  saveGroup: (name: string, subjects: string[]) => post(`${base}/groups`, { name, subjects }),
  deleteGroup: (name: string) => request<void>(`${base}/groups/${enc(name)}`, { method: 'DELETE' }),
  login: () => request<UntisLogin>(`${base}/login`),
  saveLogin: (login: UntisLoginInput) => post(`${base}/login`, login),
  /** The Entschuldigung PDF for these days; the server marks them as exported. */
  letter: async (dates: string[]): Promise<{ blob: Blob; name: string }> => {
    const res = await fetch(`${base}/letter`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dates }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string }
      throw new ApiError(res.status, body.error ?? 'http_' + res.status, body.detail)
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'Entschuldigung.pdf'
    return { blob: await res.blob(), name }
  },
}

export const absencesQ = {
  days: () => queryOptions({ queryKey: ['absences'], queryFn: absencesApi.days, staleTime: 60_000 }),
  attendance: (range?: RangeKey, from?: string, to?: string) =>
    queryOptions({
      queryKey: ['absences', 'attendance', range ?? '', from ?? '', to ?? ''],
      queryFn: () => absencesApi.attendance(range, from, to),
      staleTime: 60_000,
    }),
  login: () => queryOptions({ queryKey: ['absences', 'login'], queryFn: absencesApi.login, staleTime: 5 * 60_000 }),
}

const weekdayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' })

/** "2026-10-06" -> "06.10.2026" */
export function dateText(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

/** "2026-10-06" -> "Tuesday, 06.10.2026" */
export const dayText = (iso: string) => `${weekdayFmt.format(new Date(iso + 'T12:00:00Z'))}, ${dateText(iso)}`

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** 530, 645 -> "08:50 - 10:45" */
export const rangeText = (start: number, end: number) => `${clock(start)} - ${clock(end)}`

/** ["3","4","5","7"] -> "Lesson 3-5, 7" */
export function unitsText(units: string[]): string {
  if (!units.length) return ''
  const nums = units.map(Number)
  if (nums.some(Number.isNaN)) return `Lesson ${units.join(', ')}`
  const runs: [number, number][] = []
  for (const n of nums) {
    const last = runs.at(-1)
    if (last && n === last[1] + 1) last[1] = n
    else runs.push([n, n])
  }
  return 'Lesson ' + runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ')
}

/** "3 min ago", "2 h ago", or the date. */
export function agoText(iso: string | null): string {
  if (!iso) return 'never'
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return h < 24 ? `${h} h ago` : dateText(iso.slice(0, 10))
}

/** Green above 70 %, amber from 50 %, red below. */
export function toneClass(percent: number | null): string {
  if (percent == null) return 'text-muted-foreground'
  return percent > 70 ? 'text-emerald-400' : percent >= 50 ? 'text-amber-400' : 'text-destructive'
}

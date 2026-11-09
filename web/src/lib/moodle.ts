// Moodle tab: API shapes (docs/API.md), calls and queries.
import { queryOptions } from '@tanstack/react-query'
import { post, request } from './api'

export type MoodleFile = { name: string; url: string; view: string; mime: string; size: number; modified: string | null }
export type MoodleDue = {
  cmid: number | null
  name: string
  course: string
  courseId: number | null
  type: string
  due: string | null
  overdue: boolean
  action: string | null
  url: string
}
export type MoodleCourse = {
  id: number
  name: string
  short: string
  progress: number | null
  lastAccess: string | null
  ended: boolean
  favourite: boolean
  grade: string | null
}
export type MoodleHome = { due: MoodleDue[]; courses: MoodleCourse[] }
export type MoodleModule = {
  cmid: number
  name: string
  type: string
  instance: number | null
  url: string
  description: string
  files: MoodleFile[]
  link: string | null
  done: boolean
  restricted: string | null
  /** assignments only: own submission (none, draft, submitted, reopened) and grade */
  status: string | null
  grade: string | null
  dates: { id: string; label: string; time: string | null }[]
}
export type MoodleSection = { id: number; number: number; name: string; summary: string; modules: MoodleModule[] }
export type MoodleGrade = {
  name: string
  type: string
  total: boolean
  cmid: number | null
  grade: string
  range: string
  percentage: string
  weight: string
  feedback: string
  gradedAt: string | null
}
/** total: the course total when graded; grades: graded items that are not an assignment row */
export type MoodleCourseContent = { id: number; name: string; total: string | null; grades: MoodleGrade[]; sections: MoodleSection[] }
export type MoodleSubmission = {
  status: 'none' | 'draft' | 'submitted' | 'reopened' | string
  grading: string
  modified: string | null
  canEdit: boolean
  needsSubmit: boolean
  locked: boolean
  files: MoodleFile[]
  text: string
}
export type MoodleAssignment = {
  id: number
  cmid: number
  courseId: number
  course: string
  name: string
  url: string
  opens: string | null
  due: string | null
  cutoff: string | null
  extensionDue: string | null
  description: string
  attachments: MoodleFile[]
  files: boolean
  maxFiles: number | null
  maxBytes: number | null
  fileTypes: string
  onlineText: boolean
  submitButton: boolean
  team: boolean
  submission: MoodleSubmission | null
  feedback: { grade: string; gradedAt: string | null; comments: string; files: MoodleFile[] } | null
}
export type MoodleLogin = { configured: boolean; url: string; user: string; blocked: boolean }

const enc = encodeURIComponent
const base = '/api/moodle'

export const moodleApi = {
  home: () => request<MoodleHome>(base),
  /** Empties the server's short cache: the next reads ask Moodle again. */
  refresh: () => post(`${base}/refresh`),
  course: (id: number) => request<MoodleCourseContent>(`${base}/courses/${id}`),
  grades: (id: number) => request<MoodleGrade[]>(`${base}/courses/${id}/grades`),
  assignment: (cmid: number, course: number) => request<MoodleAssignment>(`${base}/assignments/${cmid}?course=${course}`),
  page: (url: string) => request<{ html: string }>(`${base}/page?url=${enc(url)}`),
  upload: (file: File) =>
    request<{ id: string; size: number }>(`${base}/uploads?name=${enc(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    }),
  change: (cmid: number, course: number, change: { add?: string[]; remove?: string[]; text?: string }) =>
    post<MoodleAssignment>(`${base}/assignments/${cmid}/submission?course=${course}`, change),
  submit: (cmid: number, course: number) => post<MoodleAssignment>(`${base}/assignments/${cmid}/submit?course=${course}`),
  login: () => request<MoodleLogin>(`${base}/login`),
  saveLogin: (login: { user: string; password: string }) => post(`${base}/login`, login),
}

// The last answer of the slow-changing reads stays in the browser, so the tab paints at once after a reload
// and the fresh data replaces it in the background.
const KEEP = 'moodle:2:'

function kept<T>(key: string): { initialData?: T; initialDataUpdatedAt?: number } {
  try {
    const raw = localStorage.getItem(KEEP + key)
    if (!raw) return {}
    const { at, data } = JSON.parse(raw) as { at: number; data: T }
    return { initialData: data, initialDataUpdatedAt: at }
  } catch {
    return {}
  }
}

async function keep<T>(key: string, load: () => Promise<T>): Promise<T> {
  const data = await load()
  try {
    localStorage.setItem(KEEP + key, JSON.stringify({ at: Date.now(), data }))
  } catch {
    /* storage full or off */
  }
  return data
}

/** Forgets what the browser kept (the Moodle login changed). */
export function forgetMoodle() {
  for (const k of Object.keys(localStorage)) if (k.startsWith('moodle:')) localStorage.removeItem(k)
}

const STALE = 60_000

export const moodleQ = {
  home: () =>
    queryOptions({ queryKey: ['moodle', 'home'], queryFn: () => keep('home', moodleApi.home), staleTime: STALE, ...kept<MoodleHome>('home') }),
  course: (id: number) =>
    queryOptions({
      queryKey: ['moodle', 'course', id],
      queryFn: () => keep(`course:${id}`, () => moodleApi.course(id)),
      staleTime: STALE,
      ...kept<MoodleCourseContent>(`course:${id}`),
    }),
  grades: (id: number) =>
    queryOptions({
      queryKey: ['moodle', 'grades', id],
      queryFn: () => keep(`grades:${id}`, () => moodleApi.grades(id)),
      staleTime: STALE,
      ...kept<MoodleGrade[]>(`grades:${id}`),
    }),
  assignment: (cmid: number, course: number) =>
    queryOptions({ queryKey: ['moodle', 'assignment', cmid], queryFn: () => moodleApi.assignment(cmid, course), staleTime: STALE }),
  page: (url: string) => queryOptions({ queryKey: ['moodle', 'page', url], queryFn: () => moodleApi.page(url), staleTime: 5 * STALE }),
  login: () => queryOptions({ queryKey: ['moodle-login'], queryFn: moodleApi.login, staleTime: 5 * STALE }),
}

export function sizeText(n: number): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}

/** "NSCS - Netzwerksysteme und Cyber Security - 5EHIF - SJ2627" -> code "NSCS", title "Netzwerksysteme und Cyber Security" */
export function courseTitle(c: { name: string; short?: string }): { code: string; title: string } {
  // teachers type a hyphen or an en dash (–) between the parts
  const parts = c.name.split(/\s+[-–]\s+/)
  if (parts.length >= 2 && parts[0].length <= 8) return { code: parts[0], title: parts[1] }
  return { code: (c.short ?? c.name).split(/[_\s]/)[0].slice(0, 6), title: c.name }
}

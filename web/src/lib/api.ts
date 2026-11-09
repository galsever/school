import type { Mail, MailAddress, MailPage, Assignment, AssignmentDetail, ChannelFolder, Chat, DeviceLogin, Folder, MessagePage, MsStatus, Resource, Team } from './types'

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, detail?: string) {
    super(detail || code)
    this.status = status
    this.code = code
  }
}

type AuthHandler = (code: 'login_required' | 'ms_not_connected') => void
let authHandler: AuthHandler = () => {}
/** Installed at startup: redirects to /login or /connect. */
export function setAuthHandler(h: AuthHandler) {
  authHandler = h
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, 'network', 'Offline')
  }
  if (!res.ok) {
    let code = 'http_' + res.status
    let detail: string | undefined
    try {
      const body = (await res.json()) as { error?: string; detail?: string }
      if (body.error) code = body.error
      detail = body.detail
    } catch {
      /* not json */
    }
    if (res.status === 401 && code === 'login_required') authHandler('login_required')
    else if (res.status === 409 && code === 'ms_not_connected') authHandler('ms_not_connected')
    throw new ApiError(res.status, code, detail)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export function post<T = void>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const enc = encodeURIComponent

export const api = {
  me: () => request<{ authenticated: boolean }>('/api/auth/me'),
  login: (password: string) => post('/api/auth/login', { password }),
  msStatus: () => request<MsStatus>('/api/ms/status'),
  msDevice: () => post<DeviceLogin>('/api/ms/device'),
  msDeviceState: () => request<DeviceLogin>('/api/ms/device'),
  msLogout: () => post('/api/ms/logout'),
  chats: () => request<Chat[]>('/api/chats'),
  messages: (id: string, cursor?: string) =>
    request<MessagePage>(`/api/chats/${enc(id)}/messages${cursor ? `?cursor=${enc(cursor)}` : ''}`),
  send: (id: string, text: string) => post<{ id: string; clientId: string }>(`/api/chats/${enc(id)}/messages`, { text }),
  markRead: (id: string, messageId: string) => post(`/api/chats/${enc(id)}/read`, { messageId }),
  teams: () => request<Team[]>('/api/teams'),
  mailList: (folder: string, q: string, cursor?: string) =>
    request<MailPage>(`/api/mail?folder=${folder}${q ? `&q=${enc(q)}` : ''}${cursor ? `&cursor=${enc(cursor)}` : ''}`),
  mail: (id: string) => request<Mail>(`/api/mail/${enc(id)}`),
  mailUnread: () => request<{ count: number }>('/api/mail/unread'),
  mailPeople: (q: string) => request<MailAddress[]>(`/api/mail/people?q=${enc(q)}`),
  mailSend: (m: { to: string[]; cc: string[]; subject: string; text: string }) => post('/api/mail/send', m),
  mailReply: (id: string, text: string, all: boolean) => post(`/api/mail/${enc(id)}/reply`, { text, all }),
  /** Own name (null = Microsoft's again) and hidden flag of a team or channel. */
  setPref: (id: string, p: { name?: string | null; hidden?: boolean }) =>
    request<void>(`/api/prefs/${enc(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }),
  channelFiles: (teamId: string, channelId: string) =>
    request<ChannelFolder>(`/api/teams/${enc(teamId)}/channels/${enc(channelId)}/files`),
  folder: (drive: string, item: string) => request<Folder>(`/api/drives/${enc(drive)}/items/${enc(item)}/children`),
  assignments: () => request<Assignment[]>('/api/assignments'),
  assignment: (classId: string, id: string) => request<AssignmentDetail>(`/api/assignments/${enc(classId)}/${enc(id)}`),
  uploadWork: (classId: string, id: string, file: File) =>
    request<Resource>(`/api/assignments/${enc(classId)}/${enc(id)}/files?name=${enc(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    }),
  removeWork: (classId: string, id: string, rid: string) =>
    request<void>(`/api/assignments/${enc(classId)}/${enc(id)}/files/${enc(rid)}`, { method: 'DELETE' }),
  turnIn: (classId: string, id: string) => post(`/api/assignments/${enc(classId)}/${enc(id)}/turn-in`),
  undoTurnIn: (classId: string, id: string) => post(`/api/assignments/${enc(classId)}/${enc(id)}/undo-turn-in`),
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.code === 'network' ? 'Offline' : e.message
  return 'Something went wrong'
}

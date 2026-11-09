export type Me = { id: string; name: string; mail: string }

export type DeviceLogin = {
  state: 'none' | 'pending' | 'done' | 'failed' | 'expired'
  userCode?: string
  url?: string
  expiresAt?: number
}

export type MsStatus = { connected: true; me: Me } | { connected: false; device: DeviceLogin | null }

export type ChatKind = 'chat' | 'meeting' | 'channel'

export type Chat = {
  id: string
  kind: ChatKind
  title: string
  last: { text: string; from: string; time: string; mine: boolean } | null
  unread: boolean
}

export type Message = {
  id: string
  fromId: string
  from: string
  mine: boolean
  time: string
  html: string
  format: 'html' | 'text'
  edited: boolean
  deleted: boolean
  subject: string | null
}

export type MessagePage = { messages: Message[]; cursor: string | null }

export type Team = { id: string; name: string; channels: { id: string; name: string }[] }

export type Resource = { id: string; name: string; kind: string; url: string | null }

export type Assignment = {
  id: string
  classId: string
  className: string
  title: string
  due: string | null
  closes: string | null
  assigned: string | null
  done: boolean
  status: string
  points: number | null
  webUrl: string | null
}

export type AssignmentDetail = Assignment & {
  instructions: string
  resources: Resource[]
  submission?: {
    id: string
    status: string
    submitted: string | null
    returned: string | null
    resources: Resource[]
    feedback: string[]
    points: number | null
  }
}

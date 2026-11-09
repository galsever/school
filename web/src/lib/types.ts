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

export type CardBlock = { text: string; size: string; bold: boolean; subtle: boolean }
export type CardAction = { title: string; url: string; assignment: { classId: string; id: string } | null }
export type Card = { blocks: CardBlock[]; images: string[]; actions: CardAction[] }
export type MessageFile = { name: string; url: string | null; type: string; size: number | null }

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
  cards: Card[]
  files: MessageFile[]
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
  canEdit?: boolean
  canUndo?: boolean
  lateAllowed?: boolean
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

export type DriveItem = {
  id: string
  name: string
  folder: boolean
  count: number | null
  size: number | null
  modified: string | null
  webUrl: string | null
}

export type Folder = { items: DriveItem[] }
export type ChannelFolder = Folder & { drive: string; id: string; name: string; webUrl: string | null }

export type MailAddress = { name: string; address: string }
export type MailSummary = {
  id: string
  subject: string
  from: MailAddress
  to: MailAddress[]
  time: string
  read: boolean
  preview: string
  attachments: boolean
  flagged: boolean
}
export type MailPage = { messages: MailSummary[]; cursor: string | null }
export type MailFolder = 'inbox' | 'sent' | 'archive'
export type Mail = MailSummary & {
  cc: MailAddress[]
  html: string
  files: { id: string; name: string; size: number | null; type: string; url: string }[]
}

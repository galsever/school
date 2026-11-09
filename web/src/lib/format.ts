import DOMPurify from 'dompurify'

const time = new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit' })
const day = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit' })
const full = new Intl.DateTimeFormat('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

/** List timestamp: time today, date otherwise. */
export function shortTime(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return sameDay(d, new Date()) ? time.format(d) : day.format(d)
}

export function longTime(iso?: string | null): string {
  return iso ? full.format(new Date(iso)) : ''
}

/** "in 3 d", "today", "2 d late" relative to now, for due dates. */
export function dueText(iso: string | null): { text: string; late: boolean; soon: boolean } {
  if (!iso) return { text: 'No due date', late: false, soon: false }
  const d = new Date(iso)
  const days = Math.floor((d.getTime() - Date.now()) / 86_400_000)
  if (d.getTime() < Date.now()) return { text: `${-days} d late`, late: true, soon: false }
  if (days === 0) return { text: `Today ${time.format(d)}`, late: false, soon: true }
  if (days === 1) return { text: `Tomorrow ${time.format(d)}`, late: false, soon: true }
  return { text: full.format(d), late: false, soon: days < 4 }
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/** Teams message HTML is untrusted: sanitize before rendering. */
export function safeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe'],
    FORBID_ATTR: ['style', 'class', 'id'],
  })
}

export function initials(name: string): string {
  const parts = name.replace(/\(.*?\)/g, '').trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

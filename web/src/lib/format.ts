import DOMPurify from 'dompurify'

const time = new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit' })
const day = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit' })
const dayYear = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit' })
const full = new Intl.DateTimeFormat('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const fullYear = new Intl.DateTimeFormat('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

/** List timestamp: time today, date otherwise (with the year when it is not this year). */
export function shortTime(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (sameDay(d, now)) return time.format(d)
  return (d.getFullYear() === now.getFullYear() ? day : dayYear).format(d)
}

export function longTime(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return (d.getFullYear() === new Date().getFullYear() ? full : fullYear).format(d)
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

const MEDIA_HOST = /^https:\/\/[^/]+\.(asyncgw\.teams\.microsoft\.com|asm\.skype\.com)\//

/** Set while a mail is sanitized (the hooks are global and sanitize is synchronous). */
let mail: { images: boolean; blocked: number; quote: boolean } | null = null

// Preheaders and other parts the sender hides with inline CSS. We strip all styles, so they would show.
const HIDDEN = /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all|opacity\s*:\s*0|max-height\s*:\s*0(px)?)\s*(!important)?\s*(;|$)/i
// Where the quoted older mails start: Outlook (web, mobile, desktop), Apple Mail, Gmail, Thunderbird, Yahoo, Proton
const QUOTE_ID = /^(x_)*(divRplyFwdMsg|mail-editor-reference-message-container|OLK_SRC_BODY_SECTION)$/
const QUOTE_CLASS = /(^|\s)(x_)*(gmail_quote|gmail_quote_container|moz-cite-prefix|yahoo_quoted|protonmail_quote)(\s|$)/
const QUOTE_STYLE = /border-top\s*:\s*solid\s+#(e1e1e1|b5c4df)/i

DOMPurify.addHook('uponSanitizeElement', (node) => {
  // runs before id, class and style are dropped
  if (!mail || node.nodeType !== 1) return
  const el = node as Element
  if (el.tagName === 'BODY' || el.tagName === 'HTML') return
  const style = el.getAttribute('style') ?? ''
  if (HIDDEN.test(style)) return el.remove()
  el.removeAttribute('data-tm-quote')
  if (mail.quote) return
  const start =
    QUOTE_ID.test(el.id) ||
    QUOTE_CLASS.test(el.getAttribute('class') ?? '') ||
    (el.tagName === 'BLOCKQUOTE' && el.getAttribute('type') === 'cite') ||
    (el.tagName === 'DIV' && QUOTE_STYLE.test(style))
  if (start) {
    mail.quote = true
    el.setAttribute('data-tm-quote', '')
  }
})

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'IMG') {
    const src = node.getAttribute('src') ?? ''
    if (mail && !/^\/api\/mail\/[^/]+\/attachments\//.test(src) && !src.startsWith('data:')) {
      // a remote image tells the sender that the mail was opened (and from where): only on request
      const remote = /^(https?:)?\/\//i.test(src)
      if (remote && !mail.images) mail.blocked++
      if (!remote || !mail.images) return node.remove()
    }
    // pasted images need the skype token: load them through our server
    if (MEDIA_HOST.test(src)) node.setAttribute('src', '/api/media?url=' + encodeURIComponent(src))
    node.setAttribute('loading', 'lazy')
  }
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

const FORBID_TAGS = ['style', 'form', 'input', 'button', 'iframe']
// color, bgcolor and co: Outlook mail sets black text (<font color>) that is unreadable on the dark theme
const FORBID_ATTR = ['style', 'class', 'id', 'color', 'bgcolor', 'background', 'face', 'size', 'text', 'link', 'vlink']

/** Teams message HTML is untrusted: sanitize before rendering. */
export function safeHtml(html: string): string {
  return DOMPurify.sanitize(html, { FORBID_TAGS, FORBID_ATTR })
}

const BLANK = /[\s\u00a0\u200b\ufeff]/g
const hasContent = (n: Node) => !!n.textContent?.replace(BLANK, '') || (n.nodeType === 1 && ((n as Element).tagName === 'IMG' || !!(n as Element).querySelector('img')))

/** Drops empty lines and wrappers at the end (what is left over where the quote was cut off). */
function trimEnd(root: Node) {
  for (let n = root.lastChild; n; n = root.lastChild) {
    if (hasContent(n)) {
      if (n.nodeType === 1) trimEnd(n)
      return
    }
    root.removeChild(n)
  }
}

/**
 * A mail body, sanitized like safeHtml and also: remote images only with `images` (`blocked` counts the hidden ones),
 * hidden preheaders removed, and with `collapse` the quoted older mails split off into `quoted`.
 */
export function mailHtml(html: string, opts: { images: boolean; collapse: boolean }): { main: string; quoted: string; blocked: number } {
  mail = { images: opts.images, blocked: 0, quote: !opts.collapse }
  let frag: DocumentFragment
  let blocked: number
  try {
    frag = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: [...FORBID_TAGS, 'video', 'audio', 'source', 'track'],
      FORBID_ATTR: [...FORBID_ATTR, 'srcset'],
      RETURN_DOM_FRAGMENT: true,
    })
    blocked = mail.blocked
  } finally {
    mail = null
  }
  const doc = frag.ownerDocument
  const text = (n: Node) => {
    const d = doc.createElement('div')
    d.appendChild(n)
    return d.innerHTML
  }
  let quoted = ''
  const mark = frag.querySelector('[data-tm-quote]')
  if (mark && frag.lastChild) {
    mark.removeAttribute('data-tm-quote')
    const prev = mark.previousElementSibling
    const range = doc.createRange()
    range.setStartBefore(prev?.tagName === 'HR' ? prev : mark) // Outlook puts a line above the quote header
    range.setEndAfter(frag.lastChild)
    const rest = range.extractContents()
    if (hasContent(frag)) {
      trimEnd(frag)
      quoted = text(rest)
    } else frag.appendChild(rest) // nothing but the quote (a forward without a comment): show it
  }
  return { main: text(frag), quoted, blocked }
}

export function initials(name: string): string {
  const parts = name.replace(/\(.*?\)/g, '').trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

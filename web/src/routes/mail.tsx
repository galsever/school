import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { Link, Outlet, useBlocker, useNavigate, useParams, useRouterState, useSearch } from '@tanstack/react-router'
import { type InfiniteData, keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  Bold,
  Ellipsis,
  Forward,
  ImageOff,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Mail as MailIcon,
  Moon,
  Paperclip,
  Reply,
  ReplyAll,
  Search,
  SendHorizontal,
  SquarePen,
  Sun,
  Trash2,
  Underline,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/Avatar'
import { ErrorView } from '@/components/ErrorView'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api, errorText } from '@/lib/api'
import { dayLabel, fileSize, longTime, mailHtml, shortTime } from '@/lib/format'
import { q, queryClient } from '@/lib/query'
import type { Mail, MailAddress, MailFile, MailFolder, MailMode, MailPage as MailListPage } from '@/lib/types'
import { cn } from '@/lib/utils'

const FOLDERS: { key: MailFolder; label: string }[] = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'sent', label: 'Sent' },
  { key: 'archive', label: 'Archive' },
]

export type MailSearch = { folder?: 'sent' | 'archive'; compose?: boolean }

/** Search params for a folder (inbox is the default and stays out of the URL). */
const fs = (f: MailFolder | undefined): { folder?: 'sent' | 'archive' } => (f && f !== 'inbox' ? { folder: f } : {})

export function MailLayout() {
  const open = useRouterState({ select: (s) => /^\/mail\/.+/.test(s.location.pathname) })
  const { compose } = useSearch({ strict: false }) as MailSearch
  return (
    <div className="flex h-full">
      <MailList className={cn('w-full md:w-80 md:border-r', (open || compose) && 'hidden md:flex')} />
      <section className={cn('min-w-0 flex-1', !open && !compose && 'hidden md:block')}>
        {compose ? <Compose /> : <Outlet />}
      </section>
    </div>
  )
}

export function NoMail() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <MailIcon className="size-10 opacity-30" />
    </div>
  )
}

function MailList({ className }: { className?: string }) {
  const folder: MailFolder = (useSearch({ strict: false }) as MailSearch).folder ?? 'inbox'
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearch(term.trim()), 400)
    return () => clearTimeout(t)
  }, [term])
  const list = useInfiniteQuery(q.mailList(folder, search))
  const items = list.data?.pages.flatMap((p) => p.messages) ?? []

  return (
    <aside className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search" className="h-9 pr-8 pl-9" />
            {term && (
              <button
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                onClick={() => setTerm('')}
                aria-label="Clear"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <Button size="icon" className="size-9 shrink-0" aria-label="New mail" onClick={() => void navigate({ to: '/mail', search: { ...fs(folder), compose: true } })}>
            <SquarePen />
          </Button>
        </div>
        <div className="flex gap-1.5">
          {FOLDERS.map((f) => (
            <Link
              key={f.key}
              to="/mail"
              search={fs(f.key)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                folder === f.key ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-accent',
              )}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>
      <div
        className={cn('tm-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 transition-opacity', list.isPlaceholderData && 'opacity-50')}
        onScroll={(e) => {
          const el = e.currentTarget
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 400 && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage()
        }}
      >
        {list.isError && <ErrorView error={list.error} retry={() => void list.refetch()} />}
        {list.isPending &&
          Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="px-2 py-2.5">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="mt-2 h-3 w-3/4" />
            </div>
          ))}
        {list.data && !items.length && <p className="p-10 text-center text-muted-foreground">No mail</p>}
        {items.map((m) => {
          const who = folder === 'sent' ? m.to.map((r) => r.name).join(', ') : m.from.name
          return (
            <Link
              key={m.id}
              to="/mail/$id"
              params={{ id: m.id }}
              search={fs(folder)}
              className="block rounded-lg px-2.5 py-2 transition-colors hover:bg-white/5"
              activeProps={{ className: 'bg-white/10' }}
            >
              <span className="flex items-baseline gap-2">
                {!m.read && <span className="size-2 shrink-0 self-center rounded-full bg-primary" />}
                <span className={cn('flex-1 truncate text-sm', m.read ? 'font-medium' : 'font-semibold')}>{who}</span>
                {m.attachments && <Paperclip className="size-3.5 shrink-0 self-center text-muted-foreground" />}
                <span className="shrink-0 text-xs text-muted-foreground">{shortTime(m.time)}</span>
              </span>
              <span className={cn('block truncate text-[13px]', m.read ? 'text-muted-foreground' : 'text-foreground')}>{m.subject || '(no subject)'}</span>
              <span className="block truncate text-xs text-muted-foreground">{m.preview}</span>
            </Link>
          )
        })}
        {list.isFetchingNextPage && <Loader2 className="mx-auto my-3 animate-spin text-muted-foreground" />}
      </div>
    </aside>
  )
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
/** Forwards keep their quoted part open: it is the content. */
const FORWARD = /^\s*(fwd?|wg|tr)\s*:/i
const clock = new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit' })
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

/** Who a reply goes to. A reply to an own sent mail goes to its recipients, like in Outlook. */
function recipients(mode: MailMode, m: Mail, me: string): { to: MailAddress[]; cc: MailAddress[] } {
  if (mode === 'forward' || mode === 'new') return { to: [], cc: [] }
  const mine = same(m.from.address, me)
  const to = mine ? m.to : [m.from]
  if (mode === 'reply') return { to, cc: [] }
  const others = (l: MailAddress[]) => l.filter((r) => !same(r.address, me) && !to.some((x) => same(x.address, r.address)))
  return { to: [...to, ...others(mine ? [] : m.to)], cc: others(m.cc) }
}

export function MailPage() {
  const { id } = useParams({ from: '/shell/mail/$id' })
  return <Thread key={id} id={id} />
}

function Thread({ id }: { id: string }) {
  const { folder } = useSearch({ strict: false }) as MailSearch
  const t = useQuery(q.mailThread(id))
  const ms = useQuery(q.ms()).data
  const me = ms?.connected ? ms.me.mail : ''
  const [images, setImages] = useState(false)
  const [draft, setDraft] = useState<MailMode | null>(null)
  const msgs = t.data?.messages ?? []
  const last = msgs[msgs.length - 1]

  // opening marks the unread mails of the conversation read on the server: clear the list's dots and the badge without a refetch
  useEffect(() => {
    const unread = new Set(msgs.filter((m) => !m.read).map((m) => m.id))
    if (!unread.size) return
    queryClient.setQueriesData<InfiniteData<MailListPage>>({ queryKey: ['mail'] }, (d) =>
      d && { ...d, pages: d.pages.map((p) => ({ ...p, messages: p.messages.map((x) => (unread.has(x.id) ? { ...x, read: true } : x)) })) },
    )
    void queryClient.invalidateQueries({ queryKey: ['mail-unread'] })
  }, [t.data]) // eslint-disable-line react-hooks/exhaustive-deps

  // r reply, a reply all, f forward
  useEffect(() => {
    const keys: Record<string, MailMode> = { r: 'reply', a: 'replyAll', f: 'forward' }
    const onKey = (e: KeyboardEvent) => {
      if (draft || !last || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || !keys[e.key]) return
      e.preventDefault()
      setDraft(keys[e.key])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft, last])

  const replyAll = last && recipients('replyAll', last, me)
  const canAll = !!replyAll && replyAll.to.length + replyAll.cc.length > recipients('reply', last, me).to.length

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-3">
        <Link to="/mail" search={fs(folder)} className="-ml-1 rounded-md p-1.5 hover:bg-white/10 md:hidden" aria-label="Back">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-semibold">{t.data ? t.data.subject || '(no subject)' : ''}</h1>
        {msgs.length > 1 && <span className="shrink-0 text-xs text-muted-foreground">{msgs.length}</span>}
      </header>
      <div className="tm-scroll flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-3 py-4 md:px-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
          {t.isError && <ErrorView error={t.error} retry={() => void t.refetch()} />}
          {t.isPending && (
            <>
              <Skeleton className="mr-16 h-40 rounded-2xl" />
              <Skeleton className="ml-16 h-24 rounded-2xl" />
            </>
          )}
          {msgs.map((m, i) => (
            <Fragment key={m.id}>
              {(i === 0 || new Date(m.time ?? 0).toDateString() !== new Date(msgs[i - 1].time ?? 0).toDateString()) && (
                <div className="mt-1 text-center text-xs text-muted-foreground">{dayLabel(m.time)}</div>
              )}
              <Bubble mail={m} own={same(m.from.address, me)} images={images} onImages={() => setImages(true)} />
            </Fragment>
          ))}
          {draft && last && (
            <Editor
              mode={draft}
              id={last.id}
              init={{ ...recipients(draft, last, me), subject: '' }}
              onDone={(sent) => {
                setDraft(null)
                if (sent) setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['mail-thread', id] }), 2500) // Sent Items gets the copy a moment later
              }}
            />
          )}
        </div>
      </div>
      {!draft && last && (
        <div className="flex shrink-0 items-center gap-2 border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:px-6 md:py-3">
          <div className="mx-auto flex w-full max-w-4xl items-center gap-2">
            <button
              className="flex h-10 flex-1 items-center gap-2 rounded-full border bg-card px-4 text-left text-sm text-muted-foreground hover:bg-accent"
              onClick={() => setDraft('reply')}
            >
              <Reply className="size-4" /> Reply
            </button>
            {canAll && (
              <Tip label="Reply all">
                <Button variant="secondary" size="icon" className="size-10 rounded-full" onClick={() => setDraft('replyAll')} aria-label="Reply all">
                  <ReplyAll />
                </Button>
              </Tip>
            )}
            <Tip label="Forward">
              <Button variant="secondary" size="icon" className="size-10 rounded-full" onClick={() => setDraft('forward')} aria-label="Forward">
                <Forward />
              </Button>
            </Tip>
          </div>
        </div>
      )}
    </div>
  )
}

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function Bubble({ mail, own, images, onImages }: { mail: Mail; own: boolean; images: boolean; onImages: () => void }) {
  const [quoted, setQuoted] = useState(false)
  const [details, setDetails] = useState(false)
  const [light, setLight] = useState(false)
  const body = useMemo(() => mailHtml(mail.html, { images, collapse: !FORWARD.test(mail.subject), styled: true }), [mail.html, mail.subject, images])
  const names = (l: MailAddress[]) => l.map((r) => (details && r.address && r.address !== r.name ? `${r.name} <${r.address}>` : r.name)).join(', ')

  return (
    <div className={cn('flex items-start gap-2.5', own && 'justify-end')}>
      {!own && <Avatar name={mail.from.name} className="mt-0.5 size-8 text-xs" />}
      <div className={cn('min-w-0 flex-1 rounded-2xl px-4 py-3', own ? 'ml-8 rounded-tr-md bg-primary/15 md:ml-20' : 'mr-8 rounded-tl-md bg-card md:mr-20')}>
        <div className="flex items-start gap-2 text-sm">
          <button className="min-w-0 flex-1 text-left" onClick={() => setDetails(!details)} aria-expanded={details}>
            <span className="font-semibold">{mail.from.name}</span>
            {details && <span className="ml-2 break-all text-muted-foreground">{mail.from.address}</span>}
            <span className={cn('block text-xs text-muted-foreground', details ? 'break-words' : 'truncate')}>
              To {names(mail.to)}
              {mail.cc.length > 0 && (details ? <span className="block">Cc {names(mail.cc)}</span> : ` · Cc ${names(mail.cc)}`)}
            </span>
          </button>
          <Tip label={light ? 'Dark' : 'Original colors'}>
            <button
              className="-my-1 rounded-md p-1 text-muted-foreground opacity-60 hover:bg-white/10 hover:text-foreground hover:opacity-100"
              onClick={() => setLight(!light)}
              aria-label={light ? 'Dark' : 'Original colors'}
            >
              {light ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
            </button>
          </Tip>
          <Tip label={longTime(mail.time)}>
            <span className="shrink-0 text-xs text-muted-foreground">{mail.time ? clock.format(new Date(mail.time)) : ''}</span>
          </Tip>
        </div>
        {body.blocked > 0 && (
          <button className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={onImages}>
            <ImageOff className="size-3.5" /> Show images
          </button>
        )}
        <div className={cn('mt-2', light && 'rounded-lg bg-white p-3')}>
          <MailFrame html={body.main + (quoted ? body.quoted : '')} css={body.css} images={images} dark={!light} />
        </div>
        {body.quoted && (
          <button
            className="mt-2 flex h-4 items-center rounded-full bg-secondary px-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setQuoted(!quoted)}
            aria-expanded={quoted}
            aria-label="Earlier mails"
          >
            <Ellipsis className="size-4" />
          </button>
        )}
        {mail.files.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {mail.files.map((f) => (
              <a
                key={f.id}
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex max-w-64 items-center gap-2.5 rounded-lg bg-background/60 p-1.5 pr-3 text-sm hover:bg-accent"
              >
                {f.type.startsWith('image/') && !f.type.includes('svg') ? (
                  <img src={f.url} alt="" loading="lazy" className="size-9 shrink-0 rounded object-cover" />
                ) : (
                  <span className="flex size-9 shrink-0 items-center justify-center rounded bg-secondary">
                    <Paperclip className="size-4 text-muted-foreground" />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate">{f.name}</span>
                  <span className="block text-xs text-muted-foreground">{fileSize(f.size)}</span>
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Inside the frame. Dark: the whole mail is inverted and turned back in hue (light backgrounds get dark, dark text light,
// colors keep their hue), pictures are turned back to normal. That is what Outlook and Gmail do for HTML mail in dark mode.
const FRAME_BASE =
  "html{color-scheme:light}body{margin:0;padding:1px 0;color:#111;background:transparent;font:14px/1.55 'Inter Variable',system-ui,-apple-system,'Segoe UI',sans-serif;overflow-wrap:break-word}" +
  'img{max-width:100%;height:auto}table{max-width:100%}a{color:#0b57d0}pre{white-space:pre-wrap}' +
  'blockquote{margin:0 0 0 .4em;padding-left:.8em;border-left:3px solid #c8c8c8}'
const FRAME_DARK =
  'body{filter:invert(1) hue-rotate(180deg)}' +
  'img,picture,video,[background],[style*="background-image"],[style*="url("]{filter:invert(1) hue-rotate(180deg)}'

/**
 * A mail body (already through mailHtml) in a sandboxed frame: the sender's CSS stays inside it, no scripts run
 * (no allow-scripts), and the CSP only lets in our attachment routes and data: images unless remote images are allowed.
 * The frame grows with its content.
 */
function MailFrame({ html, css, images, dark }: { html: string; css: string; images: boolean; dark: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(0)
  const doc = useMemo(() => {
    const remote = images ? ' https: http:' : ''
    const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:${remote}; font-src data:${remote}`
    return (
      `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">` +
      `<base target="_blank"><style>${FRAME_BASE}${dark ? FRAME_DARK : ''}</style><style>${css}</style></head><body>${html}</body></html>`
    )
  }, [html, css, images, dark])

  const ro = useRef<ResizeObserver | null>(null)
  useEffect(() => () => ro.current?.disconnect(), [])
  const fit = () => {
    const d = ref.current?.contentDocument
    if (!d?.body) return
    const measure = () => {
      const sideways = d.documentElement.scrollWidth > d.documentElement.clientWidth ? 18 : 0
      setHeight(Math.ceil(d.body.getBoundingClientRect().height) + sideways)
    }
    ro.current?.disconnect()
    ro.current = new ResizeObserver(measure) // late images and a narrower pane change the height
    ro.current.observe(d.body)
    measure()
  }

  return (
    <iframe
      ref={ref}
      srcDoc={doc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      title="Mail"
      onLoad={fit}
      className="block w-full border-0"
      style={{ height: height || 24, colorScheme: 'light' }}
    />
  )
}

function RecipientField({
  label,
  list,
  setList,
  input,
  setInput,
  autoFocus,
  children,
}: {
  label: string
  list: MailAddress[]
  setList: (l: MailAddress[]) => void
  input: string
  setInput: (v: string) => void
  autoFocus?: boolean
  children?: React.ReactNode
}) {
  const typed = input.trim()
  const [term, setTerm] = useState('')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setTerm(typed), 250)
    return () => clearTimeout(t)
  }, [typed])
  const wanted = typed.length >= 2 && !typed.includes('@')
  const people = useQuery({
    queryKey: ['people', term],
    queryFn: () => api.mailPeople(term),
    enabled: wanted && term.length >= 2 && !term.includes('@'),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
  const options = open && wanted ? (people.data ?? []) : []
  const fresh = term === typed && !people.isPlaceholderData // the list belongs to what is typed now
  useEffect(() => setActive(0), [people.data])

  const add = (a: MailAddress) => {
    if (!list.some((r) => r.address === a.address)) setList([...list, a])
    setInput('')
  }
  const addTyped = () => {
    const v = typed.replace(/[,;]$/, '')
    if (EMAIL.test(v)) add({ name: v, address: v })
  }

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2 py-1.5">
        <span className="text-sm text-muted-foreground">{label}</span>
        {list.map((r) => (
          <span key={r.address} className="flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-2.5 text-sm">
            {r.name}
            <button onClick={() => setList(list.filter((x) => x !== r))} className="rounded-full p-0.5 hover:bg-white/10" aria-label="Remove">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={input}
          autoFocus={autoFocus}
          aria-label={label}
          onChange={(e) => {
            setInput(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && options.length) {
              e.preventDefault()
              setActive((active + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
            } else if (['Enter', ',', ';'].includes(e.key) && typed) {
              e.preventDefault()
              if (wanted) {
                if (fresh && options[active]) add(options[active])
              } else addTyped()
            } else if (e.key === 'Escape' && options.length) {
              e.preventDefault()
              setOpen(false)
            } else if (e.key === 'Backspace' && !input && list.length) setList(list.slice(0, -1))
          }}
          onBlur={() => {
            addTyped()
            setOpen(false)
          }}
          className="min-w-40 flex-1 bg-transparent py-0.5 text-sm outline-none"
        />
        {children}
      </div>
      {options.length > 0 && (
        <div className={cn('absolute top-full z-10 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-lg', !fresh && 'opacity-60')}>
          {options.map((p, i) => (
            <button
              key={p.address}
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault()
                add(p)
              }}
              onMouseEnter={() => setActive(i)}
              className={cn('flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm', i === active && 'bg-accent')}
            >
              <span className="font-medium">{p.name}</span>
              <span className="truncate text-muted-foreground">{p.address}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const MAX_FILES = 25 << 20

const readFile = (f: File) =>
  new Promise<MailFile>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve({ name: f.name || 'file', type: f.type || 'application/octet-stream', data: String(r.result).split(',', 2)[1] ?? '' })
    r.onerror = () => reject(r.error)
    r.readAsDataURL(f)
  })

const TOOLS = [
  { cmd: 'bold', icon: Bold, label: 'Bold' },
  { cmd: 'italic', icon: Italic, label: 'Italic' },
  { cmd: 'underline', icon: Underline, label: 'Underline' },
  { cmd: 'insertUnorderedList', icon: List, label: 'List' },
  { cmd: 'insertOrderedList', icon: ListOrdered, label: 'Numbered list' },
  { cmd: 'createLink', icon: Link2, label: 'Link' },
] as const

const MODE_ICON = { new: SquarePen, reply: Reply, replyAll: ReplyAll, forward: Forward }

/**
 * New mail, reply, reply all and forward: recipients, formatted text (sent as HTML), attachments by button, drop or paste.
 * Ctrl+Enter sends, Esc discards. `page` = the full-page new mail (with subject).
 */
function Editor({
  mode,
  id,
  init,
  onDone,
  page,
}: {
  mode: MailMode
  id?: string
  init: { to: MailAddress[]; cc: MailAddress[]; subject: string }
  onDone: (sent: boolean) => void
  page?: boolean
}) {
  const [to, setTo] = useState(init.to)
  const [toInput, setToInput] = useState('')
  const [cc, setCc] = useState(init.cc)
  const [ccInput, setCcInput] = useState('')
  const [showCc, setShowCc] = useState(init.cc.length > 0)
  const [subject, setSubject] = useState(init.subject)
  const [files, setFiles] = useState<File[]>([])
  const [empty, setEmpty] = useState(true)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [asking, setAsking] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const pick = useRef<HTMLInputElement>(null)
  const sent = useRef(false)
  const dirty = !empty || files.length > 0 || (!!page && !!(to.length || cc.length || toInput.trim() || ccInput.trim() || subject.trim()))
  // leaving (another mail, a folder) would drop what is written: ask first
  const leave = useBlocker({ shouldBlockFn: () => dirty && !sent.current, enableBeforeUnload: () => dirty && !sent.current, withResolver: true })
  const all = (list: MailAddress[], input: string) => [...list.map((r) => r.address), ...(EMAIL.test(input.trim()) ? [input.trim()] : [])]
  const ready = all(to, toInput).length > 0 && (!empty || files.length > 0 || mode === 'forward')
  const Icon = MODE_ICON[mode]

  useEffect(() => {
    document.execCommand('defaultParagraphSeparator', false, 'div')
    if (!page || init.to.length) body.current?.focus()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const update = () => {
    const el = body.current
    setEmpty(!el || (!el.textContent?.replace(/[\s ​]/g, '') && !el.querySelector('img')))
  }
  const tool = (cmd: string) => {
    body.current?.focus()
    if (cmd === 'createLink') {
      const url = window.prompt('Link')?.trim()
      if (!url) return
      document.execCommand(cmd, false, /^[a-z]+:/i.test(url) ? url : `https://${url}`)
    } else document.execCommand(cmd)
    update()
  }
  const addFiles = (list: FileList | File[] | null) => {
    const next = [...files, ...Array.from(list ?? [])]
    if (next.reduce((n, f) => n + f.size, 0) > MAX_FILES) return void toast.error(`Attachments over ${MAX_FILES >> 20} MB`)
    setFiles(next)
  }
  const discard = () => (dirty ? setAsking(true) : onDone(false))

  const send = async () => {
    if (!ready || busy) return
    setBusy(true)
    try {
      const html = empty ? '' : `<div>${DOMPurify.sanitize(body.current?.innerHTML ?? '')}</div>`
      await api.mailCompose({ mode, id, to: all(to, toInput), cc: all(cc, ccInput), subject: page ? subject : '', html, files: await Promise.all(files.map(readFile)) })
      sent.current = true
      toast('Sent')
      void queryClient.invalidateQueries({ queryKey: ['mail'] })
      void queryClient.invalidateQueries({ queryKey: ['mail-thread'] })
      onDone(true)
    } catch (e) {
      toast.error(errorText(e))
      setBusy(false)
    }
  }

  return (
    <div
      className={cn('relative flex flex-col gap-2', page ? 'min-h-0 flex-1' : 'rounded-2xl border bg-card p-3', drag && 'ring-2 ring-primary')}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          void send()
        } else if (e.key === 'Escape' && !e.defaultPrevented && !page) {
          e.preventDefault()
          discard()
        }
      }}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrag(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setDrag(false)
        addFiles(e.dataTransfer.files)
      }}
    >
      <RecipientField label="To" list={to} setList={setTo} input={toInput} setInput={setToInput} autoFocus={page || mode === 'forward'}>
        {!page && <Icon className="order-first size-4 text-muted-foreground" />}
        {!showCc && (
          <button className="rounded px-1.5 text-sm text-muted-foreground hover:text-foreground" onClick={() => setShowCc(true)}>
            Cc
          </button>
        )}
      </RecipientField>
      {showCc && <RecipientField label="Cc" list={cc} setList={setCc} input={ccInput} setInput={setCcInput} autoFocus={!init.cc.length} />}
      {page && <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />}
      <div className={cn('relative rounded-md border', page ? 'flex min-h-0 flex-1 flex-col' : '')}>
        <div
          ref={body}
          contentEditable={!busy}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline
          aria-label="Message"
          data-placeholder="Message"
          onInput={update}
          onPaste={(e) => {
            if (!e.clipboardData.files.length) return
            e.preventDefault()
            addFiles(e.clipboardData.files)
          }}
          className={cn(
            'tm-msg tm-editor tm-scroll overflow-y-auto px-3 py-2 text-[15px] leading-relaxed outline-none',
            page ? 'min-h-60 flex-1' : 'max-h-[50vh] min-h-28',
            empty && 'tm-empty',
          )}
        />
      </div>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <span key={i} className="flex max-w-64 items-center gap-2 rounded-lg bg-secondary py-1.5 pr-1.5 pl-3 text-sm">
              <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{f.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{fileSize(f.size)}</span>
              <button className="rounded-full p-0.5 hover:bg-white/10" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-0.5">
        {TOOLS.map((t) => (
          <Tip key={t.cmd} label={t.label}>
            <button
              className="rounded-md p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => tool(t.cmd)}
              aria-label={t.label}
            >
              <t.icon className="size-4" />
            </button>
          </Tip>
        ))}
        <Tip label="Attach">
          <button className="rounded-md p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground" onClick={() => pick.current?.click()} aria-label="Attach">
            <Paperclip className="size-4" />
          </button>
        </Tip>
        <input
          ref={pick}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <span className="flex-1" />
        {!page && (
          <Tip label="Discard">
            <button className="mr-1 rounded-md p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground" onClick={discard} aria-label="Discard">
              <Trash2 className="size-4" />
            </button>
          </Tip>
        )}
        <Button size="sm" disabled={busy || !ready} onClick={() => void send()}>
          {busy ? <Loader2 className="animate-spin" /> : <SendHorizontal />} Send
        </Button>
      </div>
      {(leave.status === 'blocked' || asking) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => (asking ? setAsking(false) : leave.reset?.())}
        >
          <div className="w-full max-w-xs rounded-xl border bg-popover p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold">Discard this mail?</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => (asking ? setAsking(false) : leave.reset?.())}>
                Keep
              </Button>
              <Button
                variant="destructive"
                size="sm"
                autoFocus
                onClick={() => {
                  sent.current = true // nothing to keep anymore: do not ask again on the way out
                  if (asking) onDone(false)
                  else leave.proceed?.()
                }}
              >
                Discard
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Compose() {
  const navigate = useNavigate()
  const { folder } = useSearch({ strict: false }) as MailSearch
  const close = () => void navigate({ to: '/mail', search: fs(folder) })
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-3">
        <h1 className="flex-1 font-semibold">New mail</h1>
        <button className="rounded-md p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground" onClick={close} aria-label="Close">
          <X className="size-5" />
        </button>
      </header>
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col p-3 md:p-6">
        <Editor mode="new" page init={{ to: [], cc: [], subject: '' }} onDone={close} />
      </div>
    </div>
  )
}

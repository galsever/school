import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useBlocker, useNavigate, useParams, useRouterState, useSearch } from '@tanstack/react-router'
import { type InfiniteData, keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ArrowLeft, Ellipsis, ImageOff, Loader2, Mail as MailIcon, Paperclip, Reply, ReplyAll, Search, SendHorizontal, SquarePen, X } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/Avatar'
import { ErrorView } from '@/components/ErrorView'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api, errorText } from '@/lib/api'
import { longTime, mailHtml, shortTime } from '@/lib/format'
import { q, queryClient } from '@/lib/query'
import type { Mail, MailAddress, MailFolder, MailPage as MailListPage } from '@/lib/types'
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

export function MailPage() {
  const { id } = useParams({ from: '/shell/mail/$id' })
  const { folder } = useSearch({ strict: false }) as MailSearch
  const m = useQuery(q.mail(id))

  // opening an unread mail marks it read on the server: clear the list's dot and the badge without a refetch
  useEffect(() => {
    if (!m.data || m.data.read) return
    queryClient.setQueriesData<InfiniteData<MailListPage>>({ queryKey: ['mail'] }, (d) =>
      d && { ...d, pages: d.pages.map((p) => ({ ...p, messages: p.messages.map((x) => (x.id === id ? { ...x, read: true } : x)) })) },
    )
    void queryClient.invalidateQueries({ queryKey: ['mail-unread'] })
  }, [m.data?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-3">
        <Link to="/mail" search={fs(folder)} className="-ml-1 rounded-md p-1.5 hover:bg-white/10 md:hidden" aria-label="Back">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-semibold">{m.data?.subject || (m.data ? '(no subject)' : '')}</h1>
      </header>
      <div className="tm-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-8">
        {m.isError && <ErrorView error={m.error} retry={() => void m.refetch()} />}
        {m.isPending && (
          <>
            <Skeleton className="h-10 w-1/2" />
            <Skeleton className="mt-6 h-60" />
          </>
        )}
        {m.data && <MailView key={id} mail={m.data} />}
      </div>
      {m.data && folder !== 'sent' && <ReplyBox id={id} key={id} />}
    </div>
  )
}

function MailView({ mail }: { mail: Mail }) {
  const [images, setImages] = useState(false)
  const [quoted, setQuoted] = useState(false)
  const [recipients, setRecipients] = useState(false)
  const body = useMemo(() => mailHtml(mail.html, { images, collapse: !FORWARD.test(mail.subject) }), [mail.html, mail.subject, images])
  const names = (l: MailAddress[]) => l.map((r) => (recipients && r.address && r.address !== r.name ? `${r.name} <${r.address}>` : r.name)).join(', ')

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-start gap-3">
        <Avatar name={mail.from.name} />
        <div className="min-w-0 flex-1 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">{mail.from.name}</span>
            <span className="text-muted-foreground">{mail.from.address}</span>
          </div>
          <button
            className={cn('block max-w-full text-left text-muted-foreground hover:text-foreground', recipients ? 'break-words' : 'truncate')}
            onClick={() => setRecipients(!recipients)}
            aria-expanded={recipients}
          >
            To {names(mail.to)}
            {mail.cc.length > 0 && (recipients ? <span className="block">Cc {names(mail.cc)}</span> : ` · Cc ${names(mail.cc)}`)}
          </button>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{longTime(mail.time)}</span>
      </div>
      {mail.files.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {mail.files.map((f) => (
            <a
              key={f.id}
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex max-w-64 items-center gap-2 rounded-lg bg-card px-3 py-2 text-sm hover:bg-accent"
            >
              <Paperclip className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{f.name}</span>
            </a>
          ))}
        </div>
      )}
      {body.blocked > 0 && (
        <button className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => setImages(true)}>
          <ImageOff className="size-3.5" /> Show images
        </button>
      )}
      <div className="tm-msg tm-mail mt-6 overflow-x-auto leading-relaxed" dangerouslySetInnerHTML={{ __html: body.main }} />
      {body.quoted && (
        <>
          <button
            className="mt-3 flex h-4 items-center rounded-full bg-secondary px-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setQuoted(!quoted)}
            aria-expanded={quoted}
            aria-label="Earlier mails"
          >
            <Ellipsis className="size-4" />
          </button>
          {quoted && <div className="tm-msg tm-mail mt-3 overflow-x-auto leading-relaxed" dangerouslySetInnerHTML={{ __html: body.quoted }} />}
        </>
      )}
    </div>
  )
}

function ReplyBox({ id }: { id: string }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async (all: boolean) => {
    if (!text.trim()) return
    setBusy(true)
    try {
      await api.mailReply(id, text.trim(), all)
      setText('')
      toast('Sent')
      void queryClient.invalidateQueries({ queryKey: ['mail'] })
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="shrink-0 border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:p-3">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply" rows={2} className="max-h-60 min-h-16 resize-none" />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="secondary" size="sm" disabled={busy || !text.trim()} onClick={() => void send(true)}>
          <ReplyAll /> Reply all
        </Button>
        <Button size="sm" disabled={busy || !text.trim()} onClick={() => void send(false)}>
          {busy ? <Loader2 className="animate-spin" /> : <Reply />} Reply
        </Button>
      </div>
    </div>
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

function Compose() {
  const navigate = useNavigate()
  const { folder } = useSearch({ strict: false }) as MailSearch
  const [to, setTo] = useState<MailAddress[]>([])
  const [toInput, setToInput] = useState('')
  const [cc, setCc] = useState<MailAddress[]>([])
  const [ccInput, setCcInput] = useState('')
  const [showCc, setShowCc] = useState(false)
  const [subject, setSubject] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const sent = useRef(false)
  const dirty = !!(to.length || cc.length || toInput.trim() || ccInput.trim() || subject.trim() || text.trim())
  // leaving (another mail, a folder, the X) would drop what is written: ask first
  const leave = useBlocker({ shouldBlockFn: () => dirty && !sent.current, enableBeforeUnload: () => dirty && !sent.current, withResolver: true })
  const close = () => void navigate({ to: '/mail', search: fs(folder) })
  const all = (list: MailAddress[], input: string) => [...list.map((r) => r.address), ...(EMAIL.test(input.trim()) ? [input.trim()] : [])]

  const send = async () => {
    const recipients = all(to, toInput)
    if (!recipients.length || !text.trim()) return
    setBusy(true)
    try {
      await api.mailSend({ to: recipients, cc: all(cc, ccInput), subject, text: text.trim() })
      toast('Sent')
      void queryClient.invalidateQueries({ queryKey: ['mail'] })
      sent.current = true
      close()
    } catch (e) {
      toast.error(errorText(e))
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-3">
        <h1 className="flex-1 font-semibold">New mail</h1>
        <button className="rounded-md p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground" onClick={close} aria-label="Close">
          <X className="size-5" />
        </button>
      </header>
      <div className="tm-scroll mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-2 overflow-y-auto p-3 md:p-6">
        <RecipientField label="To" list={to} setList={setTo} input={toInput} setInput={setToInput} autoFocus>
          {!showCc && (
            <button className="rounded px-1.5 text-sm text-muted-foreground hover:text-foreground" onClick={() => setShowCc(true)}>
              Cc
            </button>
          )}
        </RecipientField>
        {showCc && <RecipientField label="Cc" list={cc} setList={setCc} input={ccInput} setInput={setCcInput} autoFocus />}
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" className="min-h-60 flex-1 resize-none" />
        <div className="flex justify-end">
          <Button disabled={busy || !all(to, toInput).length || !text.trim()} onClick={() => void send()}>
            {busy ? <Loader2 className="animate-spin" /> : <SendHorizontal />} Send
          </Button>
        </div>
      </div>
      {leave.status === 'blocked' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={leave.reset}>
          <div className="w-full max-w-xs rounded-xl border bg-popover p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold">Discard this mail?</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={leave.reset}>
                Keep
              </Button>
              <Button variant="destructive" size="sm" autoFocus onClick={leave.proceed}>
                Discard
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

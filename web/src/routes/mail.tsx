import { useEffect, useMemo, useState } from 'react'
import { Link, Outlet, useNavigate, useParams, useRouterState, useSearch } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Mail as MailIcon, Paperclip, Reply, ReplyAll, Search, SendHorizontal, SquarePen, X } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/Avatar'
import { ErrorView } from '@/components/ErrorView'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api, errorText } from '@/lib/api'
import { longTime, safeHtml, shortTime } from '@/lib/format'
import { q, queryClient } from '@/lib/query'
import type { MailAddress, MailFolder } from '@/lib/types'
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
      <MailList className={cn('w-full md:w-96 md:border-r', (open || compose) && 'hidden md:flex')} />
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
            <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search" className="h-9 pl-9" />
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
        className="tm-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pb-3"
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

export function MailPage() {
  const { id } = useParams({ from: '/shell/mail/$id' })
  const { folder } = useSearch({ strict: false }) as MailSearch
  const m = useQuery(q.mail(id))
  const html = useMemo(() => safeHtml(m.data?.html ?? ''), [m.data?.html])

  // opening marks it read on the server: refresh the list's dot
  useEffect(() => {
    if (m.data) void queryClient.invalidateQueries({ queryKey: ['mail'] })
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
        {m.data && (
          <div className="mx-auto max-w-3xl">
            <div className="flex items-start gap-3">
              <Avatar name={m.data.from.name} />
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{m.data.from.name}</span>
                  <span className="text-muted-foreground">{m.data.from.address}</span>
                </div>
                <div className="truncate text-muted-foreground">
                  To {m.data.to.map((r) => r.name).join(', ')}
                  {m.data.cc.length > 0 && ` · Cc ${m.data.cc.map((r) => r.name).join(', ')}`}
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{longTime(m.data.time)}</span>
            </div>
            {m.data.files.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {m.data.files.map((f) => (
                  <a
                    key={f.id}
                    href={`/api/mail/${encodeURIComponent(id)}/attachments/${encodeURIComponent(f.id)}`}
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
            <div className="tm-msg mt-6 leading-relaxed break-words" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        )}
      </div>
      {m.data && folder !== 'sent' && <ReplyBox id={id} key={id} />}
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

function Compose() {
  const navigate = useNavigate()
  const { folder } = useSearch({ strict: false }) as MailSearch
  const [to, setTo] = useState<MailAddress[]>([])
  const [input, setInput] = useState('')
  const [subject, setSubject] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const people = useQuery({
    queryKey: ['people', input.trim()],
    queryFn: () => api.mailPeople(input.trim()),
    enabled: input.trim().length >= 2 && !input.includes('@'),
    staleTime: 60_000,
  })
  const close = () => void navigate({ to: '/mail', search: fs(folder) })
  const add = (a: MailAddress) => {
    if (!to.some((r) => r.address === a.address)) setTo([...to, a])
    setInput('')
  }
  const addTyped = () => {
    const v = input.trim().replace(/[,;]$/, '')
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) add({ name: v, address: v })
  }

  const send = async () => {
    const recipients = [...to.map((r) => r.address), ...(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.trim()) ? [input.trim()] : [])]
    if (!recipients.length || !text.trim()) return
    setBusy(true)
    try {
      await api.mailSend({ to: recipients, cc: [], subject, text: text.trim() })
      toast('Sent')
      void queryClient.invalidateQueries({ queryKey: ['mail'] })
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
        <div className="relative">
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2 py-1.5">
            <span className="text-sm text-muted-foreground">To</span>
            {to.map((r) => (
              <span key={r.address} className="flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-2.5 text-sm">
                {r.name}
                <button onClick={() => setTo(to.filter((x) => x !== r))} className="rounded-full p-0.5 hover:bg-white/10" aria-label="Remove">
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <input
              value={input}
              autoFocus
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (['Enter', ',', ';', 'Tab'].includes(e.key) && input.trim()) {
                  e.preventDefault()
                  if (people.data?.[0] && !input.includes('@')) add(people.data[0])
                  else addTyped()
                }
                if (e.key === 'Backspace' && !input && to.length) setTo(to.slice(0, -1))
              }}
              onBlur={addTyped}
              className="min-w-40 flex-1 bg-transparent py-0.5 text-sm outline-none"
            />
          </div>
          {!!people.data?.length && input.trim().length >= 2 && (
            <div className="absolute top-full z-10 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-lg">
              {people.data.map((p) => (
                <button
                  key={p.address}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    add(p)
                  }}
                  className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="truncate text-muted-foreground">{p.address}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" className="min-h-60 flex-1 resize-none" />
        <div className="flex justify-end">
          <Button disabled={busy || (!to.length && !input.includes('@')) || !text.trim()} onClick={() => void send()}>
            {busy ? <Loader2 className="animate-spin" /> : <SendHorizontal />} Send
          </Button>
        </div>
      </div>
    </div>
  )
}

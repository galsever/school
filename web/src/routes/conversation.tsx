import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ClipboardList, ExternalLink, FileText, Loader2, SendHorizontal, Video } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/Avatar'
import { Lightbox } from '@/components/Lightbox'
import { ErrorView } from '@/components/ErrorView'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api, errorText } from '@/lib/api'
import { ChannelFiles } from '@/routes/files'
import { ClassAssignments } from '@/routes/classwork'
import { longTime, safeHtml, shortTime } from '@/lib/format'
import { q, queryClient } from '@/lib/query'
import type { Card, Message, MessageFile } from '@/lib/types'
import { cn } from '@/lib/utils'

export function ConversationPage() {
  const { id } = useParams({ from: '/shell/chats/$id' })
  return <Conversation id={id} back="/chats" />
}

export function ChannelPage() {
  const { id } = useParams({ from: '/shell/teams/$id' })
  const { tab } = useSearch({ from: '/shell/teams/$id' })
  const teams = useQuery(q.teams())
  const teamId = teams.data?.find((t) => t.channels.some((c) => c.id === id))?.id
  return <Conversation id={id} back="/teams" channelTab={{ teamId, files: tab === 'files' }} />
}

function Conversation({
  id,
  back,
  channelTab,
}: {
  id: string
  back: '/chats' | '/teams'
  channelTab?: { teamId?: string; files: boolean }
}) {
  const chats = useQuery(q.chats())
  const teams = useQuery({ ...q.teams(), enabled: !!chats.data && !chats.data.some((c) => c.id === id) })
  const chat = chats.data?.find((c) => c.id === id)
  const channel = teams.data?.flatMap((t) => t.channels.map((c) => ({ ...c, team: t.name }))).find((c) => c.id === id)
  const title = chat?.title ?? (channel ? `${channel.team} · ${channel.name}` : '')
  const kind = chat?.kind ?? (channel ? 'channel' : 'chat')

  const latest = useQuery(q.messages(id))
  const assignments = useQuery({ ...q.assignments(), enabled: !!channelTab?.teamId })
  const openCount = channelTab?.teamId
    ? (assignments.data ?? []).filter((a) => a.classId === channelTab.teamId && !a.done && !(a.closes && Date.parse(a.closes) < Date.now())).length
    : 0
  // open by default only where it fits next to the posts
  const [panel, setPanel] = useState(() => {
    const v = localStorage.getItem('tm-class-panel')
    return v === null ? matchMedia('(min-width: 1024px)').matches : v === '1'
  })
  const togglePanel = (v: boolean) => {
    localStorage.setItem('tm-class-panel', v ? '1' : '0')
    setPanel(v)
  }
  const showPanel = !!channelTab?.teamId && panel
  const [older, setOlder] = useState<Message[]>([])
  const [cursor, setCursor] = useState<string | null | undefined>(undefined)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [pending, setPending] = useState<Message[]>([])

  useEffect(() => {
    setOlder([])
    setCursor(undefined)
    setPending([])
  }, [id])

  const messages = useMemo(() => {
    const byId = new Map<string, Message>()
    for (const m of [...older, ...(latest.data?.messages ?? [])]) if (!m.deleted) byId.set(m.id, m)
    return [...byId.values()].sort((a, b) => a.time.localeCompare(b.time))
  }, [older, latest.data])

  const nextCursor = cursor === undefined ? latest.data?.cursor : cursor

  const loadOlder = async () => {
    if (!nextCursor || loadingOlder) return
    setLoadingOlder(true)
    try {
      const page = await api.messages(id, nextCursor)
      setOlder((o) => [...page.messages, ...o])
      setCursor(page.cursor)
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setLoadingOlder(false)
    }
  }

  // mark as read when a new message from someone else is shown
  const last = messages[messages.length - 1]
  useEffect(() => {
    if (!last || last.mine || !chat?.unread) return
    api
      .markRead(id, last.id)
      .then(() => queryClient.invalidateQueries({ queryKey: ['chats'] }))
      .catch(() => {})
  }, [id, last?.id, chat?.unread]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (text: string) => {
    const temp: Message = {
      id: 'pending-' + Date.now(),
      fromId: '',
      from: '',
      mine: true,
      time: new Date().toISOString(),
      html: text,
      format: 'text',
      edited: false,
      deleted: false,
      subject: null,
      cards: [],
      files: [],
    }
    setPending((p) => [...p, temp])
    try {
      await api.send(id, text)
      await latest.refetch()
      void queryClient.invalidateQueries({ queryKey: ['chats'] })
    } catch (e) {
      toast.error(errorText(e))
      return false
    } finally {
      setPending((p) => p.filter((m) => m !== temp))
    }
    return true
  }

  const [zoom, setZoom] = useState<string | null>(null)

  return (
    <div
      className="flex h-full flex-col"
      onClick={(e) => {
        const img = e.target as HTMLElement
        if (img.tagName === 'IMG' && img.closest('[data-zoomable]')) setZoom((img as HTMLImageElement).src)
      }}
    >
      <Lightbox src={zoom} onClose={() => setZoom(null)} />
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-3">
        <Link to={back} className="-ml-1 rounded-md p-1.5 hover:bg-white/10 md:hidden" aria-label="Back">
          <ArrowLeft className="size-5" />
        </Link>
        {title && <Avatar name={title} kind={kind} className="size-8 text-xs" />}
        <h1 className="min-w-0 flex-1 truncate font-semibold">{title}</h1>
        {channelTab?.teamId && (
          <button
            onClick={() => togglePanel(!panel)}
            className={cn(
              'relative flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
              panel ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-white/10 hover:text-foreground',
            )}
            aria-label="Assignments"
          >
            <ClipboardList className="size-4" />
            <span className="hidden sm:inline">Assignments</span>
            {openCount > 0 && (
              <span className="min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground">
                {openCount}
              </span>
            )}
          </button>
        )}
        {channelTab && (
          <div className="flex shrink-0 rounded-lg bg-secondary p-0.5 text-sm">
            {(['Posts', 'Files'] as const).map((label) => {
              const active = (label === 'Files') === channelTab.files
              return (
                <Link
                  key={label}
                  to="/teams/$id"
                  params={{ id }}
                  search={label === 'Files' ? { tab: 'files' } : {}}
                  replace
                  className={cn(
                    'rounded-md px-3 py-1 transition-colors',
                    active ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </Link>
              )
            })}
          </div>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
      <div className={cn('flex min-w-0 flex-1 flex-col', showPanel && 'hidden lg:flex')}>
      {channelTab?.files ? (
        channelTab.teamId ? (
          <ChannelFiles teamId={channelTab.teamId} channelId={id} />
        ) : (
          <div className="p-6">
            <Skeleton className="h-10 rounded-lg" />
          </div>
        )
      ) : (
        <>
      <div className="tm-scroll flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-3 py-3 md:px-6">
        <div className="flex flex-col">
          {nextCursor && (
            <Button variant="ghost" size="sm" className="mx-auto mb-3" onClick={loadOlder} disabled={loadingOlder}>
              {loadingOlder && <Loader2 className="animate-spin" />} Older messages
            </Button>
          )}
          {latest.isPending &&
            Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className={cn('mb-3 h-12 w-2/3 rounded-xl', i % 2 && 'ml-auto')} />
            ))}
          {latest.isError && <ErrorView error={latest.error} retry={() => void latest.refetch()} />}
          {messages.map((m, i) => (
            <Bubble key={m.id} m={m} grouped={i > 0 && messages[i - 1].fromId === m.fromId && sameBlock(messages[i - 1], m)} showName={kind !== 'chat' || title.includes(',')} />
          ))}
          {pending.map((m) => (
            <Bubble key={m.id} m={m} grouped={false} showName={false} pending />
          ))}
        </div>
      </div>
      <Composer onSend={send} key={id} />
        </>
      )}
      </div>
      {showPanel && (
        <div className="w-full shrink-0 border-l lg:w-96">
          <ClassAssignments key={channelTab!.teamId} classId={channelTab!.teamId!} onClose={() => togglePanel(false)} />
        </div>
      )}
      </div>
    </div>
  )
}

const sameBlock = (a: Message, b: Message) => new Date(b.time).getTime() - new Date(a.time).getTime() < 5 * 60_000

function Bubble({ m, grouped, showName, pending }: { m: Message; grouped: boolean; showName: boolean; pending?: boolean }) {
  const html = useMemo(() => (m.format === 'html' ? safeHtml(m.html) : ''), [m.html, m.format])
  return (
    <div className={cn('flex flex-col', m.mine ? 'items-end' : 'items-start', grouped ? 'mt-0.5' : 'mt-3')}>
      {!grouped && (
        <div className="mb-1 flex gap-2 px-1 text-xs text-muted-foreground" title={longTime(m.time)}>
          {!m.mine && showName && <span className="font-medium text-foreground/80">{m.from}</span>}
          <span>{shortTime(m.time)}</span>
          {m.edited && <span>edited</span>}
        </div>
      )}
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed break-words md:max-w-[70%]',
          m.mine ? 'bg-primary/20' : 'bg-card',
          pending && 'opacity-60',
        )}
      >
        {m.subject && <div className="mb-1 font-semibold">{m.subject}</div>}
        {m.format === 'html' ? (
          html && <div className="tm-msg" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className="whitespace-pre-wrap">{m.html}</div>
        )}
        {m.cards.map((c, i) => (
          <CardView key={i} card={c} />
        ))}
        {m.files.length > 0 && <Files files={m.files} />}
      </div>
    </div>
  )
}

const TEXT_SIZE: Record<string, string> = {
  small: 'text-[13px]',
  default: 'text-[15px]',
  medium: 'text-base',
  large: 'text-lg',
  extralarge: 'text-xl',
}

function CardView({ card }: { card: Card }) {
  return (
    <div className="flex flex-col gap-1 py-0.5">
      {card.blocks.map((b, i) => (
        <p
          key={i}
          className={cn(TEXT_SIZE[b.size] ?? 'text-[15px]', b.bold && 'font-semibold', (b.subtle || b.size === 'small') && 'text-muted-foreground')}
        >
          {b.text}
        </p>
      ))}
      {card.images.map((src) => (
        <img key={src} src={src} alt="" loading="lazy" data-zoomable className="max-h-60 cursor-zoom-in rounded-lg" />
      ))}
      {card.actions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {card.actions.map((a, i) =>
            a.assignment ? (
              <Button key={i} size="sm" variant="secondary" asChild>
                <Link to="/assignments/$classId/$id" params={a.assignment}>
                  {a.title}
                </Link>
              </Button>
            ) : (
              <Button key={i} size="sm" variant="secondary" asChild>
                <a href={a.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink /> {a.title}
                </a>
              </Button>
            ),
          )}
        </div>
      )}
    </div>
  )
}

function Files({ files }: { files: MessageFile[] }) {
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {files.map((f, i) => {
        const body = (
          <>
            {f.type === 'recording' ? (
              <Video className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <FileText className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{f.name}</span>
          </>
        )
        return f.url ? (
          <a
            key={i}
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg bg-black/20 px-3 py-2 text-sm hover:bg-black/30"
          >
            {body}
          </a>
        ) : (
          <div key={i} className="flex items-center gap-2 rounded-lg bg-black/20 px-3 py-2 text-sm">
            {body}
          </div>
        )
      })}
    </div>
  )
}

function Composer({ onSend }: { onSend: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (matchMedia('(pointer: fine)').matches) ref.current?.focus()
  }, [])

  const submit = async () => {
    const t = text.trim()
    if (!t) return
    setText('')
    if (!(await onSend(t))) setText(t)
  }

  return (
    <form
      className="flex shrink-0 items-end gap-2 border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:p-3"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          }
        }}
        rows={1}
        placeholder="Message"
        className="max-h-40 min-h-10 resize-none"
      />
      <Button type="submit" size="icon" className="size-10 shrink-0" disabled={!text.trim()} aria-label="Send">
        <SendHorizontal />
      </Button>
    </form>
  )
}

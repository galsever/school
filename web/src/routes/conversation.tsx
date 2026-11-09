import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Loader2, SendHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/Avatar'
import { ErrorView } from '@/components/ErrorView'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { api, errorText } from '@/lib/api'
import { longTime, safeHtml, shortTime } from '@/lib/format'
import { q, queryClient } from '@/lib/query'
import type { Message } from '@/lib/types'
import { cn } from '@/lib/utils'

export function ConversationPage() {
  const { id } = useParams({ from: '/shell/chats/$id' })
  const chats = useQuery(q.chats())
  const teams = useQuery({ ...q.teams(), enabled: !!chats.data && !chats.data.some((c) => c.id === id) })
  const chat = chats.data?.find((c) => c.id === id)
  const channel = teams.data?.flatMap((t) => t.channels.map((c) => ({ ...c, team: t.name }))).find((c) => c.id === id)
  const title = chat?.title ?? (channel ? `${channel.team} · ${channel.name}` : '')
  const kind = chat?.kind ?? (channel ? 'channel' : 'chat')

  const latest = useQuery(q.messages(id))
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
    for (const m of [...older, ...(latest.data?.messages ?? [])]) byId.set(m.id, m)
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

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-3">
        <Link to="/chats" className="-ml-1 rounded-md p-1.5 hover:bg-white/10 md:hidden" aria-label="Back">
          <ArrowLeft className="size-5" />
        </Link>
        {title && <Avatar name={title} kind={kind} className="size-8 text-xs" />}
        <h1 className="truncate font-semibold">{title}</h1>
      </header>
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
        {m.deleted ? (
          <span className="text-muted-foreground italic">Deleted</span>
        ) : m.format === 'html' ? (
          <div className="tm-msg" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div className="whitespace-pre-wrap">{m.html}</div>
        )}
      </div>
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

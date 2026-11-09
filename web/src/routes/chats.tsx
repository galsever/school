import { useMemo, useState } from 'react'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { MessageSquare, Search } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { ErrorView } from '@/components/ErrorView'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { shortTime } from '@/lib/format'
import { q } from '@/lib/query'
import { cn } from '@/lib/utils'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'chat', label: 'Chats' },
  { key: 'channel', label: 'Channels' },
  { key: 'meeting', label: 'Meetings' },
] as const

type Filter = (typeof FILTERS)[number]['key']

export function ChatsLayout() {
  const open = useRouterState({ select: (s) => s.location.pathname !== '/chats' && s.location.pathname !== '/chats/' })
  return (
    <div className="flex h-full">
      <ChatList className={cn('w-full md:w-80 md:border-r', open && 'hidden md:flex')} />
      <section className={cn('min-w-0 flex-1', !open && 'hidden md:block')}>
        <Outlet />
      </section>
    </div>
  )
}

export function NoChat() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <MessageSquare className="size-10 opacity-30" />
    </div>
  )
}

function ChatList({ className }: { className?: string }) {
  const chats = useQuery(q.chats())
  const [filter, setFilter] = useState<Filter>('all')
  const [term, setTerm] = useState('')

  const shown = useMemo(() => {
    const t = term.trim().toLowerCase()
    return (chats.data ?? []).filter(
      (c) =>
        (filter === 'all' || (filter === 'unread' ? c.unread : c.kind === filter)) &&
        (!t || c.title.toLowerCase().includes(t)),
    )
  }, [chats.data, filter, term])

  return (
    <aside className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex flex-col gap-2 p-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search" className="h-9 pl-9" />
        </div>
        <div className="tm-scroll flex gap-1.5 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                filter === f.key ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-accent',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="tm-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {chats.isError && <ErrorView error={chats.error} retry={() => void chats.refetch()} />}
        {chats.isPending &&
          Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="mt-2 h-3 w-3/4" />
              </div>
            </div>
          ))}
        {shown.map((c) => (
          <Link
            key={c.id}
            to="/chats/$id"
            params={{ id: c.id }}
            className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/5"
            activeProps={{ className: 'bg-white/10' }}
          >
            <Avatar name={c.title} kind={c.kind} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className={cn('flex-1 truncate text-sm', c.unread ? 'font-semibold' : 'font-medium')}>{c.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{shortTime(c.last?.time)}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className={cn('flex-1 truncate text-[13px]', c.unread ? 'text-foreground' : 'text-muted-foreground')}>
                  {c.last && (c.last.mine ? 'You: ' : c.kind !== 'chat' || c.title.includes(',') ? `${c.last.from.split(' ')[0]}: ` : '')}
                  {c.last?.text}
                </span>
                {c.unread && <span className="size-2 shrink-0 rounded-full bg-primary" />}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </aside>
  )
}

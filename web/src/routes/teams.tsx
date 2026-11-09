import { useEffect, useMemo, useState } from 'react'
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Hash, Search, Users } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { ErrorView } from '@/components/ErrorView'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { q } from '@/lib/query'
import { cn } from '@/lib/utils'

const activeChannel = (path: string) => {
  const m = path.match(/^\/teams\/([^/]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

export function TeamsLayout() {
  const active = useRouterState({ select: (s) => activeChannel(s.location.pathname) })
  return (
    <div className="flex h-full">
      <TeamList active={active} className={cn('w-full md:w-80 md:border-r', active && 'hidden md:flex')} />
      <section className={cn('min-w-0 flex-1', !active && 'hidden md:block')}>
        <Outlet />
      </section>
    </div>
  )
}

export function NoChannel() {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <Users className="size-10 opacity-30" />
    </div>
  )
}

function TeamList({ active, className }: { active: string | null; className?: string }) {
  const teams = useQuery(q.teams())
  const chats = useQuery(q.chats())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [term, setTerm] = useState('')
  const navigate = useNavigate()

  // channels with unread messages (only those with activity show up in the chat service list)
  const unread = useMemo(
    () => new Set(chats.data?.filter((c) => c.kind === 'channel' && c.unread).map((c) => c.id)),
    [chats.data],
  )

  // the team of the open channel starts expanded
  useEffect(() => {
    const team = active && teams.data?.find((t) => t.channels.some((c) => c.id === active))
    if (team) setOpen((s) => (s.has(team.id) ? s : new Set(s).add(team.id)))
  }, [active, teams.data])

  const shown = useMemo(() => {
    const t = term.trim().toLowerCase()
    if (!t) return teams.data ?? []
    return (teams.data ?? [])
      .map((team) =>
        team.name.toLowerCase().includes(t)
          ? team
          : { ...team, channels: team.channels.filter((c) => c.name.toLowerCase().includes(t)) },
      )
      .filter((team) => team.channels.length)
  }, [teams.data, term])

  return (
    <aside className={cn('flex min-h-0 flex-col', className)}>
      <div className="p-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search" className="h-9 pl-9" />
        </div>
      </div>
      <div className="tm-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {teams.isError && <ErrorView error={teams.error} retry={() => void teams.refetch()} />}
        {teams.isPending &&
          Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2">
              <Skeleton className="size-8 rounded-lg" />
              <Skeleton className="h-3.5 flex-1" />
            </div>
          ))}
        {shown.map((t) => {
          const isOpen = !!term.trim() || open.has(t.id)
          const hasUnread = t.channels.some((c) => unread.has(c.id))
          return (
            <Collapsible
              key={t.id}
              open={isOpen}
              onOpenChange={(o) => {
                setOpen((s) => {
                  const n = new Set(s)
                  if (o) n.add(t.id)
                  else n.delete(t.id)
                  return n
                })
                // opening a team shows its main channel (with the class assignments next to it)
                const main = t.channels.find((c) => c.name === 'General' || c.name === 'Allgemein') ?? t.channels[0]
                if (o && main && !t.channels.some((c) => c.id === active)) void navigate({ to: '/teams/$id', params: { id: main.id } })
              }}
            >
              <CollapsibleTrigger className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/5">
                <Avatar name={t.name} className="size-8 rounded-lg text-xs" />
                <span className={cn('flex-1 truncate text-sm', hasUnread && !isOpen ? 'font-semibold' : 'font-medium')}>
                  {t.name}
                </span>
                {hasUnread && !isOpen && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                {t.channels.map((c) => (
                  <Link
                    key={c.id}
                    to="/teams/$id"
                    params={{ id: c.id }}
                    className={cn(
                      'ml-6 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-white/5',
                      unread.has(c.id) ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                    activeProps={{ className: 'bg-white/10 !text-foreground' }}
                  >
                    <Hash className="size-4 shrink-0" />
                    <span className="flex-1 truncate">{c.name}</span>
                    {unread.has(c.id) && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                  </Link>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )
        })}
      </div>
    </aside>
  )
}

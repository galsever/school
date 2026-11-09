import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Eye, EyeOff, Hash, Pencil, Search, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/Avatar'
import { ErrorView } from '@/components/ErrorView'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { api, errorText } from '@/lib/api'
import { q, queryClient } from '@/lib/query'
import type { Channel, Team } from '@/lib/types'
import { cn, mainChannel } from '@/lib/utils'

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

/** Search finds a team or channel by its own name and by Microsoft's. */
const match = (x: Channel, t: string) => x.name.toLowerCase().includes(t) || x.original.toLowerCase().includes(t)

/** Own name and hidden flag live on the server, so they are the same on every device. */
async function setPref(id: string, p: { name?: string | null; hidden?: boolean }) {
  try {
    await api.setPref(id, p)
    await queryClient.invalidateQueries({ queryKey: ['teams'] })
    for (const key of ['chats', 'assignments', 'assignment']) void queryClient.invalidateQueries({ queryKey: [key] })
  } catch (e) {
    toast.error(errorText(e))
  }
}

/** Right click (long press on touch) on a team or channel row: Rename, Hide or Show. */
function RowMenu({ hidden, onRename, onHide, children }: { hidden: boolean; onRename: () => void; onHide: () => void; children: React.ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      {/* the rename field takes the focus: do not hand it back to the row */}
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <ContextMenuItem onSelect={onRename}>
          <Pencil /> Rename
        </ContextMenuItem>
        <ContextMenuItem onSelect={onHide}>
          {hidden ? <Eye /> : <EyeOff />} {hidden ? 'Show' : 'Hide'}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Inline rename: Enter or leaving saves, Escape cancels, empty puts Microsoft's name back. */
function NameInput({ item, onDone }: { item: Channel; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(item.name)
  const state = useRef<'opening' | 'open' | 'done'>('opening')
  useEffect(() => {
    // after the menu has closed
    const t = setTimeout(() => {
      ref.current?.focus()
      ref.current?.select()
      state.current = 'open'
    }, 80)
    return () => clearTimeout(t)
  }, [])
  const finish = (save: boolean) => {
    if (state.current === 'done') return
    state.current = 'done'
    const name = value.trim()
    if (save && name !== item.name) void setPref(item.id, { name: name && name !== item.original ? name : null })
    onDone()
  }
  return (
    <input
      ref={ref}
      value={value}
      placeholder={item.original}
      maxLength={80}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true)
        if (e.key === 'Escape') finish(false)
      }}
      onBlur={() => state.current === 'open' && finish(true)}
      className="min-w-0 flex-1 rounded-md border border-ring bg-transparent px-1.5 py-0.5 text-sm text-foreground outline-none"
    />
  )
}

function TeamList({ active, className }: { active: string | null; className?: string }) {
  const teams = useQuery(q.teams())
  const chats = useQuery(q.chats())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [hiddenOpen, setHiddenOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [term, setTerm] = useState('')
  const navigate = useNavigate()
  const done = () => setEditing(null)

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

  const { shown, hidden } = useMemo(() => {
    const t = term.trim().toLowerCase()
    const all = teams.data ?? []
    const shown = all
      .filter((team) => !team.hidden)
      .map((team) => {
        const channels = team.channels.filter((c) => !c.hidden)
        return { ...team, channels: !t || match(team, t) ? channels : channels.filter((c) => match(c, t)) }
      })
      .filter((team) => !t || match(team, t) || team.channels.length)
    // hidden teams, and hidden channels of the teams that still show
    const hidden = all
      .flatMap((team): { team: Team; channel?: Channel }[] => (team.hidden ? [{ team }] : team.channels.filter((c) => c.hidden).map((channel) => ({ team, channel }))))
      .filter((r) => !t || match(r.team, t) || (r.channel && match(r.channel, t)))
    return { shown, hidden }
  }, [teams.data, term])

  const channelRow = 'ml-6 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-white/5'

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
                const main = mainChannel(t.channels)
                if (o && main && !t.channels.some((c) => c.id === active)) void navigate({ to: '/teams/$id', params: { id: main.id } })
              }}
            >
              {editing === t.id ? (
                <div className="flex items-center gap-3 px-2 py-2">
                  <Avatar name={t.name} className="size-8 rounded-lg text-xs" />
                  <NameInput item={t} onDone={done} />
                </div>
              ) : (
                <RowMenu hidden={false} onRename={() => setEditing(t.id)} onHide={() => void setPref(t.id, { hidden: true })}>
                  <CollapsibleTrigger className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/5">
                    <Avatar name={t.name} className="size-8 rounded-lg text-xs" />
                    <span className={cn('flex-1 truncate text-sm', hasUnread && !isOpen ? 'font-semibold' : 'font-medium')}>{t.name}</span>
                    {hasUnread && !isOpen && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                    <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
                  </CollapsibleTrigger>
                </RowMenu>
              )}
              <CollapsibleContent>
                {t.channels.map((c) =>
                  editing === c.id ? (
                    <div key={c.id} className="ml-6 flex items-center gap-2 px-3 py-1 text-muted-foreground">
                      <Hash className="size-4 shrink-0" />
                      <NameInput item={c} onDone={done} />
                    </div>
                  ) : (
                    <RowMenu key={c.id} hidden={false} onRename={() => setEditing(c.id)} onHide={() => void setPref(c.id, { hidden: true })}>
                      <Link
                        to="/teams/$id"
                        params={{ id: c.id }}
                        className={cn(channelRow, unread.has(c.id) ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground')}
                        activeProps={{ className: 'bg-white/10 !text-foreground' }}
                      >
                        <Hash className="size-4 shrink-0" />
                        <span className="flex-1 truncate">{c.name}</span>
                        {unread.has(c.id) && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                      </Link>
                    </RowMenu>
                  ),
                )}
              </CollapsibleContent>
            </Collapsible>
          )
        })}
        {hidden.length > 0 && (
          <Collapsible open={hiddenOpen || !!term.trim()} onOpenChange={setHiddenOpen} className="mt-2">
            <CollapsibleTrigger className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-muted-foreground transition-colors hover:bg-white/5">
              <span className="flex size-8 shrink-0 items-center justify-center">
                <EyeOff className="size-4" />
              </span>
              <span className="flex-1 text-sm font-medium">Hidden</span>
              <span className="text-xs">{hidden.length}</span>
              <ChevronRight className={cn('size-4 shrink-0 transition-transform', (hiddenOpen || !!term.trim()) && 'rotate-90')} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              {hidden.map(({ team, channel }) => {
                const item = channel ?? team
                const target = channel ?? mainChannel(team.channels)
                const icon = channel ? <Hash className="size-4 shrink-0" /> : <Users className="size-4 shrink-0" />
                if (editing === item.id)
                  return (
                    <div key={item.id} className="ml-6 flex items-center gap-2 px-3 py-1 text-muted-foreground">
                      {icon}
                      <NameInput item={item} onDone={done} />
                    </div>
                  )
                const label = (
                  <>
                    {icon}
                    <span className="min-w-0 flex-1 truncate">
                      {item.name}
                      {channel && <span className="ml-2 text-xs opacity-60">{team.name}</span>}
                    </span>
                  </>
                )
                const row = cn(channelRow, 'text-muted-foreground hover:text-foreground')
                return (
                  <RowMenu key={item.id} hidden onRename={() => setEditing(item.id)} onHide={() => void setPref(item.id, { hidden: false })}>
                    {target ? (
                      <Link to="/teams/$id" params={{ id: target.id }} className={row} activeProps={{ className: 'bg-white/10 !text-foreground' }}>
                        {label}
                      </Link>
                    ) : (
                      <div className={row}>{label}</div>
                    )}
                  </RowMenu>
                )
              })}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </aside>
  )
}

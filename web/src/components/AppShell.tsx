import { useEffect, useRef } from 'react'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { CalendarX, ClipboardList, Mail, MessageSquare, Settings, Users } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { q } from '@/lib/query'
import type { Chat } from '@/lib/types'
import { cn } from '@/lib/utils'

const nav = [
  { to: '/chats', label: 'Chats', icon: MessageSquare },
  { to: '/teams', label: 'Teams', icon: Users },
  { to: '/assignments', label: 'Assignments', icon: ClipboardList },
  { to: '/mail', label: 'Mail', icon: Mail },
  { to: '/absences', label: 'Absences', icon: CalendarX },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const

type NavItem = (typeof nav)[number]

function RailLink({ item, badge }: { item: NavItem; badge: number }) {
  const Icon = item.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={item.to}
          aria-label={item.label}
          className="group relative flex size-11 items-center justify-center rounded-xl text-muted-foreground outline-none transition-colors hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          activeProps={{ className: 'bg-primary/15 !text-primary' }}
        >
          <span className="absolute -left-2 h-5 w-1 rounded-r-full bg-primary opacity-0 transition-opacity group-data-[status=active]:opacity-100" />
          <Icon className="size-[22px]" strokeWidth={1.75} />
          {badge > 0 && <Badge n={badge} />}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

export function AppShell() {
  const chats = useQuery(q.chats())
  const unread = chats.data?.filter((c) => c.unread).length ?? 0
  const mailUnread = useQuery(q.mailUnread()).data?.count ?? 0
  const badge = (to: string) => (to === '/chats' ? unread : to === '/mail' ? mailUnread : 0)
  useNotifications(chats.data)
  useEffect(() => {
    document.title = unread ? `(${unread}) Teams` : 'Teams'
  }, [unread])
  // On phones a detail page covers the whole screen, without the bottom bar
  const detail = useRouterState({ select: (s) => /^\/(chats|teams|mail|assignments\/[^/]+)\/[^/]+/.test(s.location.pathname) })

  return (
    <div className="flex h-full flex-col md:flex-row">
      <nav className="hidden w-16 shrink-0 flex-col items-center gap-2 border-r border-sidebar-border bg-sidebar py-3 md:flex">
        <img src="/favicon.svg" alt="" className="mb-3 size-8" />
        {nav.slice(0, -1).map((item) => (
          <RailLink key={item.to} item={item} badge={badge(item.to)} />
        ))}
        <div className="flex-1" />
        <RailLink item={nav[nav.length - 1]} badge={0} />
      </nav>
      <main className="min-h-0 min-w-0 flex-1">
        <Outlet />
      </main>
      <nav
        className={cn(
          'flex shrink-0 border-t border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden',
          detail && 'hidden',
        )}
      >
        {nav.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground"
            activeProps={{ className: '!text-primary' }}
          >
            <Icon className="size-5" strokeWidth={1.75} />
            {label}
            {badge(to) > 0 && <Badge n={badge(to)} />}
          </Link>
        ))}
      </nav>
    </div>
  )
}

function Badge({ n }: { n: number }) {
  return (
    <span className="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground">
      {n > 99 ? '99+' : n}
    </span>
  )
}

/** Desktop notification for a new unread message while the tab is in the background. */
function useNotifications(chats: Chat[] | undefined) {
  const seen = useRef<Map<string, string> | null>(null)
  useEffect(() => {
    if (!chats) return
    const prev = seen.current
    seen.current = new Map(chats.map((c) => [c.id, c.last?.time ?? '']))
    if (!prev || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (document.visibilityState === 'visible') return
    for (const c of chats) {
      if (!c.unread || !c.last || c.last.mine || prev.get(c.id) === c.last.time) continue
      const n = new Notification(c.title, { body: `${c.kind === 'chat' ? '' : c.last.from + ': '}${c.last.text}`, tag: c.id })
      n.onclick = () => {
        window.focus()
        location.assign(`/chats/${encodeURIComponent(c.id)}`)
      }
    }
  }, [chats])
}

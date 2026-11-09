import { useEffect, useRef } from 'react'
import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, MessageSquare, Settings, Users } from 'lucide-react'
import { q } from '@/lib/query'
import type { Chat } from '@/lib/types'
import { cn } from '@/lib/utils'

const nav = [
  { to: '/chats', label: 'Chats', icon: MessageSquare },
  { to: '/teams', label: 'Teams', icon: Users },
  { to: '/assignments', label: 'Assignments', icon: ClipboardList },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const

export function AppShell() {
  const chats = useQuery(q.chats())
  const unread = chats.data?.filter((c) => c.unread).length ?? 0
  useNotifications(chats.data)
  useEffect(() => {
    document.title = unread ? `(${unread}) Teams` : 'Teams'
  }, [unread])
  // On phones a detail page covers the whole screen, without the bottom bar
  const detail = useRouterState({ select: (s) => /^\/(chats|teams|assignments\/[^/]+)\/[^/]+/.test(s.location.pathname) })

  return (
    <div className="flex h-full flex-col md:flex-row">
      <nav className="hidden w-[72px] shrink-0 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar py-3 md:flex">
        {nav.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="relative flex w-16 flex-col items-center gap-1 rounded-lg py-2 text-[11px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            activeProps={{ className: 'bg-white/10 !text-foreground' }}
          >
            <Icon className="size-5" strokeWidth={1.75} />
            {label}
            {to === '/chats' && unread > 0 && <Badge n={unread} />}
          </Link>
        ))}
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
            {to === '/chats' && unread > 0 && <Badge n={unread} />}
          </Link>
        ))}
      </nav>
    </div>
  )
}

function Badge({ n }: { n: number }) {
  return (
    <span className="absolute top-1 right-3 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground">
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

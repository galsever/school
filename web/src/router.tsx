import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet, redirect } from '@tanstack/react-router'
import { AppShell } from '@/components/AppShell'
import { RouteError } from '@/components/ErrorView'

const rootRoute = createRootRoute({ component: Outlet })

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (s: Record<string, unknown>): { redirect?: string } =>
    typeof s.redirect === 'string' ? { redirect: s.redirect } : {},
  component: lazyRouteComponent(() => import('@/routes/login'), 'LoginPage'),
})

const connectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/connect',
  component: lazyRouteComponent(() => import('@/routes/connect'), 'ConnectPage'),
})

const shellRoute = createRoute({ getParentRoute: () => rootRoute, id: 'shell', component: AppShell })

const indexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/chats', replace: true })
  },
})

const chatsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/chats',
  component: lazyRouteComponent(() => import('@/routes/chats'), 'ChatsLayout'),
})

const chatsIndexRoute = createRoute({
  getParentRoute: () => chatsRoute,
  path: '/',
  component: lazyRouteComponent(() => import('@/routes/chats'), 'NoChat'),
})

const chatRoute = createRoute({
  getParentRoute: () => chatsRoute,
  path: '$id',
  component: lazyRouteComponent(() => import('@/routes/conversation'), 'ConversationPage'),
})

const teamsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/teams',
  component: lazyRouteComponent(() => import('@/routes/teams'), 'TeamsLayout'),
})

const teamsIndexRoute = createRoute({
  getParentRoute: () => teamsRoute,
  path: '/',
  component: lazyRouteComponent(() => import('@/routes/teams'), 'NoChannel'),
})

const channelRoute = createRoute({
  getParentRoute: () => teamsRoute,
  path: '$id',
  validateSearch: (s: Record<string, unknown>): { tab?: 'files' } => (s.tab === 'files' ? { tab: 'files' } : {}),
  component: lazyRouteComponent(() => import('@/routes/conversation'), 'ChannelPage'),
})

const mailSearch = (s: Record<string, unknown>): { folder?: 'sent' | 'archive'; compose?: boolean } => {
  const out: { folder?: 'sent' | 'archive'; compose?: boolean } = {}
  if (s.folder === 'sent' || s.folder === 'archive') out.folder = s.folder
  if (s.compose === true || s.compose === 'true') out.compose = true
  return out
}

const mailRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/mail',
  validateSearch: mailSearch,
  component: lazyRouteComponent(() => import('@/routes/mail'), 'MailLayout'),
})

const mailIndexRoute = createRoute({
  getParentRoute: () => mailRoute,
  path: '/',
  component: lazyRouteComponent(() => import('@/routes/mail'), 'NoMail'),
})

const mailItemRoute = createRoute({
  getParentRoute: () => mailRoute,
  path: '$id',
  component: lazyRouteComponent(() => import('@/routes/mail'), 'MailPage'),
})

const assignmentsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/assignments',
  validateSearch: (s: Record<string, unknown>): { all?: boolean } => (s.all === true || s.all === 'true' ? { all: true } : {}),
  component: lazyRouteComponent(() => import('@/routes/assignments'), 'AssignmentsPage'),
})

const assignmentRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/assignments/$classId/$id',
  component: lazyRouteComponent(() => import('@/routes/assignment'), 'AssignmentPage'),
})

const absencesSearch = (s: Record<string, unknown>) => {
  const out: { tab?: 'attendance'; range?: 's1' | 's2' | 'year'; from?: string; to?: string } = {}
  const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
  if (s.tab === 'attendance') out.tab = 'attendance'
  if (s.range === 's1' || s.range === 's2' || s.range === 'year') out.range = s.range
  if (day(s.from) && day(s.to)) {
    out.from = day(s.from)
    out.to = day(s.to)
  }
  return out
}

const absencesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/absences',
  validateSearch: absencesSearch,
  component: lazyRouteComponent(() => import('@/routes/absences'), 'AbsencesPage'),
})

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/settings',
  component: lazyRouteComponent(() => import('@/routes/settings'), 'SettingsPage'),
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  connectRoute,
  shellRoute.addChildren([
    indexRoute,
    chatsRoute.addChildren([chatsIndexRoute, chatRoute]),
    teamsRoute.addChildren([teamsIndexRoute, channelRoute]),
    mailRoute.addChildren([mailIndexRoute, mailItemRoute]),
    assignmentsRoute,
    assignmentRoute,
    absencesRoute,
    settingsRoute,
  ]),
])

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  defaultErrorComponent: RouteError,
  defaultPendingMs: 400,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

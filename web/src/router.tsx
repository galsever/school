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
  component: lazyRouteComponent(() => import('@/routes/teams'), 'TeamsPage'),
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
    teamsRoute,
    assignmentsRoute,
    assignmentRoute,
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

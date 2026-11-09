import { QueryClient, queryOptions } from '@tanstack/react-query'
import { api, ApiError } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (n, e) => !(e instanceof ApiError && [401, 404, 409].includes(e.status)) && n < 2,
    },
  },
})

export const q = {
  ms: () => queryOptions({ queryKey: ['ms'], queryFn: api.msStatus, staleTime: 5 * 60_000 }),
  chats: () => queryOptions({ queryKey: ['chats'], queryFn: api.chats, refetchInterval: 10_000 }),
  messages: (id: string) =>
    queryOptions({ queryKey: ['messages', id], queryFn: () => api.messages(id), refetchInterval: 4_000, staleTime: 0 }),
  teams: () => queryOptions({ queryKey: ['teams'], queryFn: api.teams, staleTime: 10 * 60_000 }),
  assignments: () => queryOptions({ queryKey: ['assignments'], queryFn: api.assignments, staleTime: 5 * 60_000 }),
  assignment: (classId: string, id: string) =>
    queryOptions({ queryKey: ['assignment', classId, id], queryFn: () => api.assignment(classId, id) }),
}

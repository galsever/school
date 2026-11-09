import { QueryClient, infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { api, ApiError } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (n, e) => !(e instanceof ApiError && [400, 401, 404, 409].includes(e.status)) && n < 2,
    },
  },
})

export const q = {
  ms: () => queryOptions({ queryKey: ['ms'], queryFn: api.msStatus, staleTime: 5 * 60_000 }),
  chats: () => queryOptions({ queryKey: ['chats'], queryFn: api.chats, refetchInterval: 10_000 }),
  messages: (id: string) =>
    queryOptions({ queryKey: ['messages', id], queryFn: () => api.messages(id), refetchInterval: 4_000, staleTime: 0 }),
  teams: () => queryOptions({ queryKey: ['teams'], queryFn: api.teams, staleTime: 10 * 60_000 }),
  channelFiles: (teamId: string, channelId: string) =>
    queryOptions({ queryKey: ['files', teamId, channelId], queryFn: () => api.channelFiles(teamId, channelId), staleTime: 60_000 }),
  folder: (drive: string, item: string) =>
    queryOptions({ queryKey: ['folder', drive, item], queryFn: () => api.folder(drive, item), staleTime: 60_000 }),
  mailList: (folder: string, search: string) =>
    infiniteQueryOptions({
      queryKey: ['mail', folder, search],
      queryFn: ({ pageParam }) => api.mailList(folder, search, pageParam || undefined),
      initialPageParam: '',
      getNextPageParam: (last) => last.cursor ?? undefined,
      refetchInterval: 60_000,
      // searching keeps the list on screen until the result is there (not across folders)
      placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === folder ? prev : undefined),
    }),
  mailUnread: () => queryOptions({ queryKey: ['mail-unread'], queryFn: api.mailUnread, refetchInterval: 60_000 }),
  mail: (id: string) => queryOptions({ queryKey: ['mail-item', id], queryFn: () => api.mail(id), staleTime: 5 * 60_000 }),
  assignments: () => queryOptions({ queryKey: ['assignments'], queryFn: api.assignments, staleTime: 5 * 60_000 }),
  assignment: (classId: string, id: string) =>
    queryOptions({ queryKey: ['assignment', classId, id], queryFn: () => api.assignment(classId, id) }),
}

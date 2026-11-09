import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Hash } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { ErrorView } from '@/components/ErrorView'
import { Skeleton } from '@/components/ui/skeleton'
import { q } from '@/lib/query'
import { cn } from '@/lib/utils'

export function TeamsPage() {
  const teams = useQuery(q.teams())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <div className="tm-scroll mx-auto h-full max-w-2xl overflow-y-auto p-3 md:p-6">
      <h1 className="mb-3 px-2 text-xl font-semibold">Teams</h1>
      {teams.isError && <ErrorView error={teams.error} retry={() => void teams.refetch()} />}
      {teams.isPending && Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="mb-2 h-12 rounded-lg" />)}
      {teams.data?.map((t) => (
        <div key={t.id}>
          <button
            onClick={() => toggle(t.id)}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/5"
          >
            <Avatar name={t.name} className="size-9 rounded-lg text-xs" />
            <span className="flex-1 truncate font-medium">{t.name}</span>
            <ChevronRight className={cn('size-4 text-muted-foreground transition-transform', open.has(t.id) && 'rotate-90')} />
          </button>
          {open.has(t.id) &&
            t.channels.map((c) => (
              <Link
                key={c.id}
                to="/chats/$id"
                params={{ id: c.id }}
                className="ml-8 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              >
                <Hash className="size-4" />
                {c.name}
              </Link>
            ))}
        </div>
      ))}
    </div>
  )
}

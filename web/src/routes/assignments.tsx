import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { ErrorView } from '@/components/ErrorView'
import { Skeleton } from '@/components/ui/skeleton'
import { dueText } from '@/lib/format'
import { q } from '@/lib/query'
import type { Assignment } from '@/lib/types'
import { cn } from '@/lib/utils'

const STALE = 60 * 86_400_000

/** Still worth doing: not turned in, not closed, and not abandoned long ago. */
function isOpen(a: Assignment) {
  const now = Date.now()
  if (a.done || (a.closes && Date.parse(a.closes) < now)) return false
  return !a.due || Date.parse(a.due) > now - STALE
}

export function AssignmentsPage() {
  const { all } = useSearch({ from: '/shell/assignments' })
  const navigate = useNavigate()
  const list = useQuery(q.assignments())
  const shown = (list.data ?? []).filter((a) => all || isOpen(a))
  const ordered = all ? [...shown].sort((a, b) => (b.due ?? '').localeCompare(a.due ?? '')) : shown

  return (
    <div className="tm-scroll mx-auto h-full max-w-2xl overflow-y-auto p-3 md:p-6">
      <div className="mb-3 flex items-center gap-2 px-2">
        <h1 className="flex-1 text-xl font-semibold">Assignments</h1>
        {(['Open', 'All'] as const).map((label) => {
          const active = (label === 'All') === !!all
          return (
            <button
              key={label}
              onClick={() => void navigate({ to: '/assignments', search: label === 'All' ? { all: true } : {}, replace: true })}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium',
                active ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-accent',
              )}
            >
              {label}
            </button>
          )
        })}
      </div>
      {list.isError && <ErrorView error={list.error} retry={() => void list.refetch()} />}
      {list.isPending && Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="mb-2 h-16 rounded-lg" />)}
      {list.data && !ordered.length && <p className="p-10 text-center text-muted-foreground">Nothing open</p>}
      {ordered.map((a) => {
        const due = dueText(a.due)
        return (
          <Link
            key={a.id}
            to="/assignments/$classId/$id"
            params={{ classId: a.classId, id: a.id }}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/5"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{a.title}</span>
              <span className="block truncate text-[13px] text-muted-foreground">{a.className}</span>
            </span>
            {a.done ? (
              <CheckCircle2 className="size-5 shrink-0 text-primary" />
            ) : (
              <span
                className={cn(
                  'shrink-0 text-right text-xs',
                  due.late ? 'text-destructive' : due.soon ? 'text-amber-400' : 'text-muted-foreground',
                )}
              >
                {due.text}
              </span>
            )}
          </Link>
        )
      })}
    </div>
  )
}

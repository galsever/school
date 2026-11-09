import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, ChevronRight, X } from 'lucide-react'
import { ErrorView } from '@/components/ErrorView'
import { Skeleton } from '@/components/ui/skeleton'
import { dueText } from '@/lib/format'
import { q } from '@/lib/query'
import type { Assignment } from '@/lib/types'
import { cn } from '@/lib/utils'
import { AssignmentView } from '@/routes/assignment'

const isOpen = (a: Assignment) => !a.done && !(a.closes && Date.parse(a.closes) < Date.now())

/** Assignments of one class (team id = class id), shown next to its channel. */
export function ClassAssignments({ classId, onClose }: { classId: string; onClose: () => void }) {
  const list = useQuery(q.assignments())
  const [selected, setSelected] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const mine = (list.data ?? []).filter((a) => a.classId === classId)
  const open = mine.filter(isOpen)
  const done = mine.filter((a) => !isOpen(a)).sort((a, b) => (b.due ?? '').localeCompare(a.due ?? ''))

  return (
    <aside className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        {selected ? (
          <button
            className="-ml-1 flex items-center gap-1 rounded-md p-1 text-sm text-muted-foreground hover:bg-white/10 hover:text-foreground"
            onClick={() => setSelected(null)}
          >
            <ArrowLeft className="size-4" /> Assignments
          </button>
        ) : (
          <span className="text-sm font-semibold">Assignments</span>
        )}
        <span className="flex-1" />
        <button
          className="rounded-md p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="tm-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {selected ? (
          <AssignmentView classId={classId} id={selected} compact />
        ) : (
          <>
            {list.isError && <ErrorView error={list.error} retry={() => void list.refetch()} />}
            {list.isPending && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="mb-2 h-12 rounded-lg" />)}
            {list.data && !open.length && <p className="py-6 text-center text-sm text-muted-foreground">Nothing open</p>}
            {open.map((a) => (
              <Item key={a.id} a={a} onClick={() => setSelected(a.id)} />
            ))}
            {done.length > 0 && (
              <>
                <button
                  className="mt-3 flex w-full items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowDone((v) => !v)}
                >
                  <ChevronRight className={cn('size-3.5 transition-transform', showDone && 'rotate-90')} />
                  Done and closed ({done.length})
                </button>
                {showDone && done.map((a) => <Item key={a.id} a={a} onClick={() => setSelected(a.id)} />)}
              </>
            )}
          </>
        )}
      </div>
    </aside>
  )
}

function Item({ a, onClick }: { a: Assignment; onClick: () => void }) {
  const due = dueText(a.due)
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/5">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{a.title}</span>
        {!a.done && (
          <span className={cn('block text-xs', due.late ? 'text-destructive' : due.soon ? 'text-amber-400' : 'text-muted-foreground')}>
            {due.text}
          </span>
        )}
      </span>
      {a.done && <CheckCircle2 className="size-4 shrink-0 text-primary" />}
    </button>
  )
}

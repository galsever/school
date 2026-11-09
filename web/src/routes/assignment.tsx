import { useMemo } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, FileText, Link2 } from 'lucide-react'
import { ErrorView } from '@/components/ErrorView'
import { Skeleton } from '@/components/ui/skeleton'
import { dueText, longTime, safeHtml } from '@/lib/format'
import { q } from '@/lib/query'
import type { Resource } from '@/lib/types'
import { cn } from '@/lib/utils'

const STATUS: Record<string, string> = {
  working: 'Not turned in',
  submitted: 'Turned in',
  returned: 'Returned',
  reassigned: 'Returned for revision',
}

export function AssignmentPage() {
  const { classId, id } = useParams({ from: '/shell/assignments/$classId/$id' })
  const a = useQuery(q.assignment(classId, id))
  const instructions = useMemo(() => safeHtml(a.data?.instructions ?? ''), [a.data?.instructions])
  const due = dueText(a.data?.due ?? null)
  const sub = a.data?.submission

  return (
    <div className="tm-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl p-3 md:p-6">
        <Link to="/assignments" className="mb-3 inline-flex items-center gap-1 rounded-md p-1.5 text-sm text-muted-foreground hover:bg-white/10">
          <ArrowLeft className="size-4" /> Assignments
        </Link>
        {a.isError && <ErrorView error={a.error} retry={() => void a.refetch()} />}
        {a.isPending && (
          <>
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="mt-3 h-4 w-1/3" />
            <Skeleton className="mt-6 h-40" />
          </>
        )}
        {a.data && (
          <>
            <p className="text-sm text-muted-foreground">{a.data.className}</p>
            <h1 className="mt-1 text-2xl font-semibold">{a.data.title}</h1>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span className={cn(!a.data.done && due.late && 'text-destructive')}>Due {longTime(a.data.due) || 'never'}</span>
              {a.data.points != null && <span className="text-muted-foreground">{a.data.points} points</span>}
              {sub && <span className="text-primary">{STATUS[sub.status] ?? sub.status}</span>}
            </div>

            {instructions && <div className="tm-msg mt-6 leading-relaxed" dangerouslySetInnerHTML={{ __html: instructions }} />}

            {!!a.data.resources.length && <Files title="Material" items={a.data.resources} />}
            {sub && !!sub.resources.length && <Files title="My work" items={sub.resources} />}

            {sub && (sub.feedback.length > 0 || sub.points != null) && (
              <section className="mt-6 rounded-xl bg-card p-4">
                <h2 className="mb-2 text-sm font-semibold">
                  Feedback{sub.points != null && a.data.points != null && ` · ${sub.points}/${a.data.points}`}
                </h2>
                {sub.feedback.map((f, i) => (
                  <div key={i} className="tm-msg text-sm" dangerouslySetInnerHTML={{ __html: safeHtml(f) }} />
                ))}
              </section>
            )}

            {a.data.webUrl && (
              <a
                href={a.data.webUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="size-4" /> Open in Teams
              </a>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Files({ title, items }: { title: string; items: Resource[] }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <div className="flex flex-col gap-1.5">
        {items.map((r) => {
          const Icon = r.kind.toLowerCase().includes('link') ? Link2 : FileText
          const body = (
            <>
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{r.name || 'File'}</span>
            </>
          )
          return r.url ? (
            <a
              key={r.id}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg bg-card px-3 py-2 text-sm hover:bg-accent"
            >
              {body}
            </a>
          ) : (
            <div key={r.id} className="flex items-center gap-2 rounded-lg bg-card px-3 py-2 text-sm">
              {body}
            </div>
          )
        })}
      </div>
    </section>
  )
}

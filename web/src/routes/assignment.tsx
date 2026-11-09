import { useMemo, useRef, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarClock, ExternalLink, FileText, Link2, Loader2, Paperclip, Star, Undo2, X } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorView } from '@/components/ErrorView'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { api, errorText } from '@/lib/api'
import { dueText, longTime, safeHtml } from '@/lib/format'
import { q, queryClient } from '@/lib/query'
import type { AssignmentDetail, Resource } from '@/lib/types'
import { cn } from '@/lib/utils'

const STATUS: Record<string, string> = {
  working: 'Not turned in',
  submitted: 'Turned in',
  returned: 'Returned',
  reassigned: 'Returned for revision',
}

export function AssignmentPage() {
  const { classId, id } = useParams({ from: '/shell/assignments/$classId/$id' })
  return (
    <div className="tm-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl p-3 md:p-6">
        <Link to="/assignments" className="-ml-1.5 mb-4 inline-flex items-center gap-1 rounded-md p-1.5 text-sm text-muted-foreground hover:bg-white/10 hover:text-foreground">
          <ArrowLeft className="size-4" /> Assignments
        </Link>
        <AssignmentView classId={classId} id={id} />
      </div>
    </div>
  )
}

/** Assignment details with "My work"; used on its own page and in a channel's class panel. */
export function AssignmentView({ classId, id, compact }: { classId: string; id: string; compact?: boolean }) {
  const a = useQuery(q.assignment(classId, id))
  const instructions = useMemo(() => safeHtml(a.data?.instructions ?? ''), [a.data?.instructions])
  const due = dueText(a.data?.due ?? null)
  const sub = a.data?.submission

  return (
    <>
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
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                {!compact && <ClassLink classId={a.data.classId} name={a.data.className} />}
                <h1 className={cn('font-semibold tracking-tight', compact ? 'text-lg' : 'mt-1 text-2xl')}>{a.data.title}</h1>
              </div>
              {a.data.webUrl && (
                <a
                  href={a.data.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in Teams"
                  className="mt-0.5 shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                >
                  <ExternalLink className="size-4" />
                </a>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1',
                  !a.data.done && due.late ? 'text-destructive' : !a.data.done && due.soon ? 'text-amber-400' : 'text-muted-foreground',
                )}
              >
                <CalendarClock className="size-3.5" /> {longTime(a.data.due) || 'No due date'}
              </span>
              {a.data.points != null && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-muted-foreground">
                  <Star className="size-3.5" /> {a.data.points}
                </span>
              )}
              {sub && (
                <span
                  className={cn(
                    'rounded-full px-2.5 py-1 font-medium',
                    sub.status === 'working' ? 'bg-white/5 text-muted-foreground' : 'bg-primary/15 text-primary',
                  )}
                >
                  {STATUS[sub.status] ?? sub.status}
                </span>
              )}
            </div>

            {instructions && <div className="tm-msg mt-6 leading-relaxed" dangerouslySetInnerHTML={{ __html: instructions }} />}

            {!!a.data.resources.length && <Files title="Material" items={a.data.resources} />}
            {sub && <MyWork a={a.data} />}

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

          </>
        )}
    </>
  )
}

/** Class name as a link to the class team's main channel (team id = class id). */
function ClassLink({ classId, name }: { classId: string; name: string }) {
  const teams = useQuery(q.teams())
  const team = teams.data?.find((t) => t.id === classId)
  const main = team && (team.channels.find((c) => c.name === 'General' || c.name === 'Allgemein') ?? team.channels[0])
  if (!main) return <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">{name}</p>
  return (
    <Link
      to="/teams/$id"
      params={{ id: main.id }}
      className="block truncate text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"
    >
      {name || team.name}
    </Link>
  )
}

function MyWork({ a }: { a: AssignmentDetail }) {
  const sub = a.submission!
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['assignment', a.classId, a.id] }),
      queryClient.invalidateQueries({ queryKey: ['assignments'] }),
    ])

  const upload = async (files: FileList | File[]) => {
    const list = [...files]
    if (!list.length || !a.canEdit) return
    setUploading((u) => [...u, ...list.map((f) => f.name)])
    for (const f of list) {
      try {
        await api.uploadWork(a.classId, a.id, f)
      } catch (e) {
        toast.error(`${f.name}: ${errorText(e)}`)
      } finally {
        setUploading((u) => u.filter((n) => n !== f.name))
      }
    }
    await refresh()
  }

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await refresh()
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const late = !!a.due && Date.parse(a.due) < Date.now()
  const closed = !!a.closes && Date.parse(a.closes) < Date.now()

  return (
    <section
      className={cn('mt-6 rounded-xl border bg-card p-4 transition-colors', drag && 'border-primary bg-primary/5')}
      onDragOver={(e) => {
        if (!a.canEdit) return
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        void upload(e.dataTransfer.files)
      }}
    >
      <h2 className="mb-3 text-sm font-semibold">My work</h2>
      {a.canEdit && !sub.resources.length && !uploading.length && (
        <button
          onClick={() => input.current?.click()}
          className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed py-6 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          <Paperclip className="size-5" /> Add file
        </button>
      )}
      <div className="flex flex-col gap-1.5">
        {sub.resources.map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            {r.url ? (
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate hover:underline">
                {r.name || 'File'}
              </a>
            ) : (
              <span className="flex-1 truncate">{r.name || 'File'}</span>
            )}
            {a.canEdit && (
              <button
                className="rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-50"
                disabled={busy}
                onClick={() => void run(() => api.removeWork(a.classId, a.id, r.id))}
                aria-label="Remove"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        ))}
        {uploading.map((n, i) => (
          <div key={n + i} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            <span className="truncate">{n}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {a.canEdit && (
          <>
            <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && void upload(e.target.files)} />
            {(sub.resources.length > 0 || uploading.length > 0) && (
              <Button variant="ghost" size="sm" onClick={() => input.current?.click()} disabled={busy}>
                <Paperclip /> Add file
              </Button>
            )}
            <Button
              size="sm"
              disabled={busy || uploading.length > 0 || closed || (late && !a.lateAllowed)}
              onClick={() => void run(() => api.turnIn(a.classId, a.id))}
            >
              {busy && <Loader2 className="animate-spin" />} Turn in{late ? ' late' : ''}
            </Button>
          </>
        )}
        {a.canUndo && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => api.undoTurnIn(a.classId, a.id))}>
            <Undo2 /> Undo turn in
          </Button>
        )}
      </div>
    </section>
  )
}

function Files({ title, items }: { title: string; items: Resource[] }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
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

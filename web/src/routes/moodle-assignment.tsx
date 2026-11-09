import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarClock, ExternalLink, FileText, Loader2, Paperclip, Star, X } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorView } from '@/components/ErrorView'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { errorText } from '@/lib/api'
import { dueText, longTime, safeHtml } from '@/lib/format'
import { moodleApi, moodleQ, sizeText, type MoodleAssignment, type MoodleFile } from '@/lib/moodle'
import { cn } from '@/lib/utils'

const STATUS: Record<string, string> = { none: 'Not submitted', new: 'Not submitted', draft: 'Draft', submitted: 'Submitted', reopened: 'Reopened' }

/** One Moodle assignment next to its course: task, material, own work (upload, submit), feedback. */
export function MoodleAssignmentView({ cmid, courseId, onClose }: { cmid: number; courseId: number; onClose: () => void }) {
  const a = useQuery(moodleQ.assignment(cmid, courseId))
  const description = useMemo(() => safeHtml(a.data?.description ?? ''), [a.data?.description])
  const sub = a.data?.submission
  const done = sub?.status === 'submitted'
  const due = dueText(a.data?.extensionDue ?? a.data?.due ?? null)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-2 lg:px-3">
        <button className="rounded-md p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground lg:hidden" onClick={onClose} aria-label="Back">
          <ArrowLeft className="size-5" />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">Assignment</span>
        {a.data && (
          <a
            href={a.data.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in Moodle"
            aria-label="Open in Moodle"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
          >
            <ExternalLink className="size-4" />
          </a>
        )}
        <button className="hidden rounded-md p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground lg:block" onClick={onClose} aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      <div className="tm-scroll min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
        {a.isError && <ErrorView error={a.error} retry={() => void a.refetch()} />}
        {a.isPending && (
          <>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="mt-3 h-4 w-1/3" />
            <Skeleton className="mt-6 h-32" />
          </>
        )}
        {a.data && (
          <>
            <h2 className="text-lg font-semibold tracking-tight">{a.data.name}</h2>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1',
                  !done && due.late ? 'text-destructive' : !done && due.soon ? 'text-amber-400' : 'text-muted-foreground',
                )}
              >
                <CalendarClock className="size-3.5" /> {longTime(a.data.extensionDue ?? a.data.due) || 'No due date'}
              </span>
              {sub && (
                <span className={cn('rounded-full px-2.5 py-1 font-medium', done ? 'bg-primary/15 text-primary' : 'bg-white/5 text-muted-foreground')}>
                  {STATUS[sub.status] ?? sub.status}
                </span>
              )}
              {a.data.feedback?.grade && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 font-medium text-primary">
                  <Star className="size-3.5" /> {a.data.feedback.grade}
                </span>
              )}
            </div>

            {description && <div className="tm-msg mt-5 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: description }} />}
            {!!a.data.attachments.length && <Files title="Material" items={a.data.attachments} />}
            {sub && <MyWork a={a.data} />}

            {a.data.feedback && (a.data.feedback.comments || !!a.data.feedback.files.length) && (
              <section className="mt-5 rounded-xl bg-card p-4">
                <h3 className="mb-2 text-sm font-semibold">Feedback</h3>
                {a.data.feedback.comments && (
                  <div className="tm-msg text-sm" dangerouslySetInnerHTML={{ __html: safeHtml(a.data.feedback.comments) }} />
                )}
                {a.data.feedback.files.map((f) => (
                  <FileLink key={f.url} f={f} />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function FileLink({ f, onRemove, busy }: { f: MoodleFile; onRemove?: () => void; busy?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm">
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <a href={f.view} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate hover:underline">
        {f.name}
      </a>
      <span className="shrink-0 text-xs text-muted-foreground">{sizeText(f.size)}</span>
      {onRemove && (
        <button
          className="rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-50"
          disabled={busy}
          onClick={onRemove}
          aria-label="Remove"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

function Files({ title, items }: { title: string; items: MoodleFile[] }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      <div className="flex flex-col gap-1.5">
        {items.map((f) => (
          <FileLink key={f.url} f={f} />
        ))}
      </div>
    </section>
  )
}

function MyWork({ a }: { a: MoodleAssignment }) {
  const sub = a.submission!
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [text, setText] = useState(sub.text)
  useEffect(() => setText(sub.text), [sub.text])
  useEffect(() => {
    if (!confirm) return
    const t = setTimeout(() => setConfirm(false), 4000)
    return () => clearTimeout(t)
  }, [confirm])

  const canFiles = sub.canEdit && a.files
  const full = a.maxFiles != null && sub.files.length + uploading.length >= a.maxFiles

  /** Moodle answers the assignment as it is after the change. */
  const run = async (fn: () => Promise<MoodleAssignment>) => {
    setBusy(true)
    try {
      qc.setQueryData(moodleQ.assignment(a.cmid, a.courseId).queryKey, await fn())
      void qc.invalidateQueries({ queryKey: ['moodle', 'home'] })
      void qc.invalidateQueries({ queryKey: ['moodle', 'course', a.courseId] })
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const upload = async (files: FileList | File[]) => {
    let list = [...files]
    if (!list.length || !canFiles) return
    if (a.maxFiles != null) list = list.slice(0, Math.max(0, a.maxFiles - sub.files.length))
    const tooBig = list.find((f) => a.maxBytes != null && f.size > a.maxBytes)
    if (tooBig) return void toast.error(`${tooBig.name}: larger than ${sizeText(a.maxBytes!)}`)
    if (!list.length) return void toast.error(`At most ${a.maxFiles} files`)
    setUploading(list.map((f) => f.name))
    try {
      const ids = await Promise.all(list.map((f) => moodleApi.upload(f).then((u) => u.id)))
      await run(() => moodleApi.change(a.cmid, a.courseId, { add: ids }))
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setUploading([])
    }
  }

  return (
    <section
      className={cn('mt-5 rounded-xl border bg-card p-4 transition-colors', drag && 'border-primary bg-primary/5')}
      onDragOver={(e) => {
        if (!canFiles) return
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
      <h3 className="mb-3 text-sm font-semibold">My work</h3>
      {canFiles && !sub.files.length && !uploading.length && (
        <button
          onClick={() => input.current?.click()}
          className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed py-6 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          <Paperclip className="size-5" /> Add file
        </button>
      )}
      <div className="flex flex-col gap-1.5">
        {sub.files.map((f) => (
          <FileLink
            key={f.url}
            f={f}
            busy={busy}
            onRemove={sub.canEdit ? () => void run(() => moodleApi.change(a.cmid, a.courseId, { remove: [f.name] })) : undefined}
          />
        ))}
        {uploading.map((n, i) => (
          <div key={n + i} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            <span className="truncate">{n}</span>
          </div>
        ))}
      </div>
      {a.onlineText &&
        (sub.canEdit ? (
          <Textarea className="mt-3 min-h-28" aria-label="Text" placeholder="Text" value={text} onChange={(e) => setText(e.target.value)} />
        ) : (
          sub.text && <div className="tm-msg mt-3 text-sm" dangerouslySetInnerHTML={{ __html: safeHtml(sub.text) }} />
        ))}
      {!sub.files.length && !a.files && !a.onlineText && <p className="text-sm text-muted-foreground">Nothing to hand in here</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files)
            e.target.value = ''
          }}
        />
        {canFiles && (sub.files.length > 0 || uploading.length > 0) && !full && (
          <Button variant="ghost" size="sm" onClick={() => input.current?.click()} disabled={busy || uploading.length > 0}>
            <Paperclip /> Add file
          </Button>
        )}
        {a.onlineText && sub.canEdit && text !== sub.text && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => moodleApi.change(a.cmid, a.courseId, { text }))}>
            Save text
          </Button>
        )}
        {sub.needsSubmit && (
          <Button
            size="sm"
            variant={confirm ? 'destructive' : 'default'}
            disabled={busy || uploading.length > 0}
            onClick={() => {
              if (!confirm) return setConfirm(true)
              setConfirm(false)
              void run(() => moodleApi.submit(a.cmid, a.courseId))
            }}
          >
            {busy && <Loader2 className="animate-spin" />} {confirm ? 'Really submit?' : 'Submit'}
          </Button>
        )}
      </div>
    </section>
  )
}

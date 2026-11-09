import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CheckCircle2, Download, FileText, Loader2, Paperclip, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorView } from '@/components/ErrorView'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { errorText } from '@/lib/api'
import { safeHtml } from '@/lib/format'
import { moodleApi, moodleQ } from '@/lib/moodle'
import { cn } from '@/lib/utils'

/** A Moodle choice opened in its course: the options, who took them, the own pick; picking needs Save. */
export function ChoiceBody({ cmid, courseId }: { cmid: number; courseId: number }) {
  const qc = useQueryClient()
  const choice = useQuery(moodleQ.choice(cmid, courseId))
  const c = choice.data
  const [picked, setPicked] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const mine = useMemo(() => (c?.options ?? []).filter((o) => o.checked).map((o) => o.id), [c])
  useEffect(() => setPicked(mine), [mine])
  const intro = useMemo(() => safeHtml(c?.intro ?? ''), [c?.intro])

  if (choice.isPending) return <Skeleton className="my-2 ml-12 h-24 rounded-lg" />
  if (choice.isError || !c) return <ErrorView error={choice.error} retry={() => void choice.refetch()} />

  const changed = picked.length > 0 && (picked.length !== mine.length || picked.some((id) => !mine.includes(id)))
  const toggle = (id: number) => setPicked((p) => (c.multiple ? (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]) : [id]))
  const save = async () => {
    setBusy(true)
    try {
      qc.setQueryData(moodleQ.choice(cmid, courseId).queryKey, await moodleApi.answerChoice(cmid, courseId, picked))
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-2 ml-12 rounded-lg bg-card p-3 text-sm">
      {intro.replace(/<[^>]+>|&nbsp;|\s/g, '') && <div className="tm-msg mb-3 overflow-x-auto leading-relaxed text-muted-foreground" dangerouslySetInnerHTML={{ __html: intro }} />}
      {c.note && <p className="mb-2 text-muted-foreground">{c.note}</p>}
      {c.canAnswer && (
        <div className="mb-3 flex flex-col gap-1">
          {c.options.map((o) => {
            const on = picked.includes(o.id)
            const free = !o.disabled || o.checked
            return (
              <button
                key={o.id}
                disabled={!free || busy}
                onClick={() => toggle(o.id)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors',
                  free ? 'hover:bg-white/5' : 'text-muted-foreground',
                  on && 'bg-primary/10',
                )}
              >
                <span
                  className={cn(
                    'grid size-4 shrink-0 place-items-center border',
                    c.multiple ? 'rounded' : 'rounded-full',
                    on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50',
                  )}
                >
                  {on && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">{o.text}</span>
                {!free && <span className="text-xs">Full</span>}
              </button>
            )
          })}
          {changed && (
            <div className="flex justify-end pt-1">
              <Button size="sm" disabled={busy} onClick={() => void save()}>
                {busy && <Loader2 className="animate-spin" />} Save
              </Button>
            </div>
          )}
        </div>
      )}
      <Responses c={c} />
    </div>
  )
}

/** Moodle's responses table: one column per option with its count (and limit) and who picked it. */
function Responses({ c }: { c: NonNullable<ReturnType<typeof useChoiceData>> }) {
  const cols = [
    ...(c.unanswered.length ? [{ id: 0, text: 'Not answered', count: c.unanswered.length, max: null, people: c.unanswered, checked: false }] : []),
    ...c.options,
  ]
  return (
    <div className="tm-scroll -mx-1 overflow-x-auto pb-1">
      <div className="flex min-w-max gap-1.5 px-1">
        {cols.map((o) => {
          const full = o.max != null && o.count != null && o.count >= o.max
          return (
            <div key={o.id} className={cn('flex w-36 shrink-0 flex-col rounded-lg border bg-background/40', o.checked && 'border-primary bg-primary/10')}>
              <div className="border-b px-2.5 py-2">
                <div className={cn('line-clamp-3 font-medium', o.id === 0 && 'text-muted-foreground')} title={o.text}>
                  {o.text}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {o.count ?? 0}
                  {o.max != null && ` / ${o.max}`}
                  {full && ' Full'}
                </div>
              </div>
              <div className="flex flex-col gap-0.5 px-2.5 py-2 text-xs">
                {o.people.map((n) => (
                  <span key={n} className={cn('truncate', o.checked ? 'text-foreground' : 'text-muted-foreground')} title={n}>
                    {n}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function useChoiceData(cmid: number, courseId: number) {
  return useQuery(moodleQ.choice(cmid, courseId)).data
}

/** A publication (files the students share): own files to add and remove (everyone sees them), then everybody's. */
export function PublicationBody({ cmid }: { cmid: number; url: string }) {
  const qc = useQueryClient()
  const pub = useQuery(moodleQ.publication(cmid))
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string[]>([])
  const [drag, setDrag] = useState(false)
  const [term, setTerm] = useState('')
  if (pub.isPending) return <Skeleton className="my-2 ml-12 h-24 rounded-lg" />
  if (pub.isError || !pub.data) return <ErrorView error={pub.error} retry={() => void pub.refetch()} />
  const p = pub.data
  const file = (id: number) => `/api/moodle/publications/${cmid}/files/${id}`
  const t = term.trim().toLowerCase()
  const shown = t ? p.files.filter((f) => f.name.toLowerCase().includes(t) || f.by.toLowerCase().includes(t)) : p.files

  const change = async (label: string[], fn: () => Promise<{ add?: string[]; remove?: string[] }>) => {
    setBusy(label)
    try {
      qc.setQueryData(moodleQ.publication(cmid).queryKey, await moodleApi.changePublication(cmid, await fn()))
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy([])
    }
  }
  const add = (files: FileList | File[]) => {
    const list = [...files]
    if (!list.length || !p.canUpload) return
    void change(
      list.map((f) => f.name),
      async () => ({ add: await Promise.all(list.map((f) => moodleApi.upload(f).then((u) => u.id))) }),
    )
  }

  const row = (f: { id: number; name: string; by?: string; state?: string }, remove?: () => void) => (
    <div key={f.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <a href={file(f.id)} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-3">
        <span className="min-w-0 flex-1 truncate">{f.name}</span>
        {f.by && <span className="hidden max-w-40 shrink-0 truncate text-xs text-muted-foreground sm:block">{f.by}</span>}
      </a>
      {f.state && <CheckCircle2 className="size-4 shrink-0 text-primary" aria-label={f.state} />}
      <a href={`${file(f.id)}?download=true`} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground" aria-label="Download">
        <Download className="size-4" />
      </a>
      {remove && (
        <button className="shrink-0 rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-50" disabled={busy.length > 0} onClick={remove} aria-label="Remove">
          <X className="size-4" />
        </button>
      )}
    </div>
  )

  return (
    <div className="mb-2 ml-12 flex flex-col gap-3 text-sm">
      <section
        className={cn('rounded-lg border bg-card p-3 transition-colors', drag && 'border-primary bg-primary/5')}
        onDragOver={(e) => {
          if (!p.canUpload) return
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          add(e.dataTransfer.files)
        }}
      >
        <div className="mb-1 flex items-center gap-2">
          <h3 className="flex-1 font-semibold">My files</h3>
          {p.canUpload && p.own.length > 0 && (
            <Button variant="ghost" size="sm" disabled={busy.length > 0} onClick={() => input.current?.click()}>
              <Paperclip /> Add file
            </Button>
          )}
        </div>
        {p.own.map((f) => row(f, p.canUpload ? () => void change([], async () => ({ remove: [f.name] })) : undefined))}
        {busy.map((n) => (
          <div key={n} className="flex items-center gap-2 px-2 py-1.5 text-muted-foreground">
            <Loader2 className="size-4 shrink-0 animate-spin" />
            <span className="truncate">{n}</span>
          </div>
        ))}
        {!p.own.length && !busy.length && p.canUpload && (
          <button
            onClick={() => input.current?.click()}
            className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed py-5 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <Paperclip className="size-5" /> Add file
          </button>
        )}
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) add(e.target.files)
            e.target.value = ''
          }}
        />
      </section>

      {p.files.length > 0 && (
        <section className="rounded-lg border bg-card p-3">
          <div className="mb-1 flex items-center gap-2">
            <h3 className="flex-1 font-semibold">
              Published <span className="font-normal text-muted-foreground">{p.files.length}</span>
            </h3>
            {p.files.length > 8 && (
              <div className="relative w-40">
                <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input className="h-7 pl-7 text-xs" placeholder="Filter" aria-label="Filter" value={term} onChange={(e) => setTerm(e.target.value)} />
              </div>
            )}
            <a
              href={`/api/moodle/publications/${cmid}/zip`}
              className="rounded p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
              aria-label="Download all"
              title="Download all"
            >
              <Download className="size-4" />
            </a>
          </div>
          {shown.map((f) => row(f))}
        </section>
      )}
    </div>
  )
}

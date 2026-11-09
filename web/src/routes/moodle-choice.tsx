import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorView } from '@/components/ErrorView'
import { Button } from '@/components/ui/button'
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
      <div className="flex flex-col gap-1">
        {c.options.map((o) => {
          const on = picked.includes(o.id)
          const free = c.canAnswer && (!o.disabled || o.checked)
          return (
            <button
              key={o.id}
              disabled={!free || busy}
              onClick={() => toggle(o.id)}
              className={cn(
                'flex items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors',
                free && 'hover:bg-white/5',
                on && 'bg-primary/10',
                !free && !on && 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 grid size-4 shrink-0 place-items-center border',
                  c.multiple ? 'rounded' : 'rounded-full',
                  on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50',
                )}
              >
                {on && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block">{o.text}</span>
                {o.people.length > 0 && <span className="mt-0.5 block text-xs text-muted-foreground">{o.people.join(', ')}</span>}
              </span>
              {o.count != null && (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {o.count}
                  {o.max != null && `/${o.max}`}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {c.canAnswer && changed && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            {busy && <Loader2 className="animate-spin" />} Save
          </Button>
        </div>
      )}
    </div>
  )
}

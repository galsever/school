import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { ErrorView } from '@/components/ErrorView'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  absencesApi,
  absencesQ,
  agoText,
  dateText,
  dayText,
  rangeText,
  toneClass,
  unitsText,
  type AbsenceDay,
  type Attendance,
  type RangeKey,
  type SubjectStats,
} from '@/lib/absences'
import { errorText } from '@/lib/api'
import { cn } from '@/lib/utils'

const chip = (active: boolean) =>
  cn('rounded-full px-3 py-1 text-xs font-medium', active ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-accent')

export function AbsencesPage() {
  const search = useSearch({ from: '/shell/absences' })
  const navigate = useNavigate()
  const qc = useQueryClient()
  const days = useQuery(absencesQ.days())
  const [syncing, setSyncing] = useState(false)
  const autoSynced = useRef(false)
  const status = days.data?.sync

  const sync = async (force: boolean) => {
    setSyncing(true)
    try {
      await absencesApi.sync(force)
      await qc.invalidateQueries({ queryKey: ['absences'] })
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setSyncing(false)
    }
  }

  // Pull WebUntis once when the stored data is older than 30 minutes.
  useEffect(() => {
    if (status?.stale && !status.blocked && !autoSynced.current) {
      autoSynced.current = true
      void sync(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  return (
    <div className="tm-scroll mx-auto h-full max-w-2xl overflow-y-auto p-3 md:p-6">
      <div className="mb-3 flex items-center gap-2 px-2">
        <h1 className="flex-1 text-xl font-semibold">Absences</h1>
        {(['Days', 'Attendance'] as const).map((label) => (
          <button
            key={label}
            onClick={() => void navigate({ to: '/absences', search: label === 'Attendance' ? { tab: 'attendance' } : {}, replace: true })}
            className={chip((label === 'Attendance') === (search.tab === 'attendance'))}
          >
            {label}
          </button>
        ))}
        {status?.configured && (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={syncing || status.blocked}
            onClick={() => void sync(true)}
            title={`WebUntis: ${agoText(status.lastSync)}`}
            aria-label="Refresh from WebUntis"
          >
            <RefreshCw className={cn(syncing && 'animate-spin')} />
          </Button>
        )}
      </div>
      {status?.lastError && !syncing && <p className="mb-3 px-2 text-xs text-destructive">{status.lastError}</p>}
      {days.isError && <ErrorView error={days.error} retry={() => void days.refetch()} />}
      {days.isPending && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="mb-3 h-36 rounded-xl" />)}
      {days.data && !status?.configured && (
        <div className="p-10 text-center">
          <Button onClick={() => void navigate({ to: '/settings' })}>Connect WebUntis</Button>
        </div>
      )}
      {days.data && status?.configured && (search.tab === 'attendance' ? <AttendanceTab /> : <DaysTab days={days.data.days} syncing={syncing} />)}
    </div>
  )
}

// ---- days: own reason per day, pick days for the Entschuldigung PDF -----------------

const STATUS = {
  excused: { label: 'Excused', cls: 'bg-emerald-400/15 text-emerald-400' },
  partial: { label: 'Partly excused', cls: 'bg-amber-400/15 text-amber-400' },
  open: { label: 'Open', cls: 'bg-destructive/15 text-destructive' },
} as const

type Saved = 'saving' | 'saved' | 'error'

function DaysTab({ days, syncing }: { days: AbsenceDay[]; syncing: boolean }) {
  const qc = useQueryClient()
  // Reasons typed here win over the loaded ones until the page is left.
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<Record<string, Saved>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), [])

  const reasonOf = (d: AbsenceDay) => edits[d.date] ?? d.reason

  const toggle = (date: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(date)
      else next.delete(date)
      return next
    })

  const change = (date: string, value: string) => {
    setEdits((prev) => ({ ...prev, [date]: value }))
    setSaved((prev) => ({ ...prev, [date]: 'saving' }))
    if (!value.trim()) toggle(date, false)
    clearTimeout(timers.current[date])
    timers.current[date] = setTimeout(() => {
      absencesApi
        .reason(date, value)
        .then(() => setSaved((prev) => ({ ...prev, [date]: 'saved' })))
        .catch(() => setSaved((prev) => ({ ...prev, [date]: 'error' })))
    }, 600)
  }

  const exportPdf = async () => {
    setExporting(true)
    try {
      const { blob, name } = await absencesApi.letter([...selected].sort())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      setSelected(new Set())
      void qc.invalidateQueries({ queryKey: ['absences'] })
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setExporting(false)
    }
  }

  if (!days.length) return <p className="p-10 text-center text-muted-foreground">{syncing ? 'Loading from WebUntis' : 'No absences'}</p>

  return (
    <>
      <div className="space-y-3">
        {days.map((d) => (
          <DayCard
            key={d.date}
            day={d}
            reason={reasonOf(d)}
            saved={saved[d.date]}
            selected={selected.has(d.date)}
            onReason={(value) => change(d.date, value)}
            onSelect={(on) => toggle(d.date, on)}
          />
        ))}
      </div>
      {selected.size > 0 && (
        <div className="sticky -bottom-3 -mx-3 mt-3 flex items-center gap-2 border-t border-border bg-background/90 px-5 py-3 backdrop-blur md:-bottom-6 md:-mx-6 md:px-8">
          <span className="flex-1 text-sm">{selected.size === 1 ? '1 day' : `${selected.size} days`}</span>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          <Button disabled={exporting} onClick={() => void exportPdf()}>
            Create PDF
          </Button>
        </div>
      )}
    </>
  )
}

function DayCard({
  day,
  reason,
  saved,
  selected,
  onReason,
  onSelect,
}: {
  day: AbsenceDay
  reason: string
  saved?: Saved
  selected: boolean
  onReason: (value: string) => void
  onSelect: (on: boolean) => void
}) {
  const status = STATUS[day.status]
  const canSelect = reason.trim().length > 0
  return (
    <article className={cn('rounded-xl border bg-card p-4', selected ? 'border-primary' : 'border-transparent')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">{dayText(day.date)}</h2>
          {day.exportedAt && (
            <p className="text-xs text-muted-foreground">In a PDF since {new Date(day.exportedAt).toLocaleDateString('de-AT')}</p>
          )}
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', status.cls)}>{status.label}</span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {day.absences.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="tabular-nums">{rangeText(a.start, a.end)}</span>
            {a.units.length > 0 && <span className="text-muted-foreground">{unitsText(a.units)}</span>}
            {a.lateMinutes > 0 && (
              <span className="rounded-md bg-amber-400/15 px-1.5 py-0.5 text-xs text-amber-400">
                {a.late ? `Late · ${a.lateMinutes} min` : `incl. ${a.lateMinutes} min late`}
              </span>
            )}
            {a.untisReason && a.untisReason !== 'Verspätung' && (
              <span className="text-xs text-muted-foreground">WebUntis: {a.untisReason}</span>
            )}
            {day.status === 'partial' && (
              <span className={cn('text-xs', a.excused ? 'text-emerald-400' : 'text-destructive')}>{a.excused ? 'Excused' : 'Open'}</span>
            )}
          </li>
        ))}
      </ul>
      <Textarea value={reason} onChange={(e) => onReason(e.target.value)} rows={2} placeholder="Reason" className="mt-3 min-h-0" />
      <div className="mt-2 flex items-center justify-between gap-3">
        <label className={cn('flex items-center gap-2 text-sm', !canSelect && 'text-muted-foreground')}>
          <input
            type="checkbox"
            checked={selected}
            disabled={!canSelect}
            onChange={(e) => onSelect(e.target.checked)}
            className="size-4 accent-[var(--primary)]"
          />
          PDF
        </label>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {saved === 'saving' ? 'Saving' : saved === 'saved' ? 'Saved' : saved === 'error' ? 'Not saved' : ''}
        </span>
      </div>
    </article>
  )
}

// ---- attendance per subject -------------------------------------------------------

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 's1', label: 'Semester 1' },
  { key: 's2', label: 'Semester 2' },
  { key: 'year', label: 'Year' },
]

function AttendanceTab() {
  const search = useSearch({ from: '/shell/absences' })
  const navigate = useNavigate()
  const att = useQuery(absencesQ.attendance(search.range, search.from, search.to))
  const range = att.data?.range

  const go = (next: { range?: RangeKey; from?: string; to?: string }) =>
    void navigate({ to: '/absences', search: { tab: 'attendance', ...next }, replace: true })

  if (att.isError) return <ErrorView error={att.error} retry={() => void att.refetch()} />
  if (att.isPending) return <Skeleton className="h-36 rounded-xl" />
  if (!range || !att.data.total) return <p className="p-10 text-center text-muted-foreground">No data yet</p>

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 px-2">
        {RANGES.map((r) => (
          <button key={r.key} onClick={() => go({ range: r.key })} className={chip(range.key === r.key)}>
            {r.label}
          </button>
        ))}
        <span className="flex-1" />
        {/* remounts when the shown range changes, so the fields always show it */}
        <DateRange key={`${range.start}|${range.end}`} start={range.start} end={range.end} onChange={(from, to) => go({ from, to })} />
      </div>
      {att.data.subjects.length === 0 ? (
        <p className="p-10 text-center text-muted-foreground">No lessons held yet</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <SubjectCard s={{ ...att.data.total, subject: 'Total', subjectLong: `${dateText(range.start)} - ${dateText(range.end)}` }} large />
          </div>
          {att.data.subjects.map((s) => (
            <SubjectCard key={s.subject} s={s} />
          ))}
        </div>
      )}
      <Groups data={att.data} />
    </>
  )
}

function DateRange({ start, end, onChange }: { start: string; end: string; onChange: (from: string, to: string) => void }) {
  const [from, setFrom] = useState(start)
  const [to, setTo] = useState(end)
  const set = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom)
    setTo(nextTo)
    if (nextFrom && nextTo && nextFrom <= nextTo) onChange(nextFrom, nextTo)
  }
  const cls = 'h-7 w-[8.5rem] px-2 text-xs md:text-xs'
  return (
    <>
      <Input type="date" aria-label="From" value={from} onChange={(e) => set(e.target.value, to)} className={cls} />
      <Input type="date" aria-label="To" value={to} onChange={(e) => set(from, e.target.value)} className={cls} />
    </>
  )
}

function SubjectCard({ s, large = false }: { s: SubjectStats; large?: boolean }) {
  const share = (n: number) => `${s.held ? (n / s.held) * 100 : 0}%`
  return (
    <article className="rounded-xl bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-medium">{s.subject}</h2>
          <p className="truncate text-xs text-muted-foreground">{s.subjectLong}</p>
        </div>
        <span className={cn('shrink-0 font-semibold tabular-nums', large ? 'text-4xl' : 'text-3xl', toneClass(s.percent))}>
          {s.percent == null ? '-' : `${Math.round(s.percent)} %`}
        </span>
      </div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-secondary" role="img" aria-label="Present, excused, unexcused">
        <div className="bg-emerald-400" style={{ width: share(s.present) }} />
        <div className="bg-sky-400" style={{ width: share(s.excused) }} />
        <div className="bg-destructive" style={{ width: share(s.unexcused) }} />
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div>
          <dt className="inline">Held </dt>
          <dd className="inline font-medium text-foreground">{s.held}</dd>
        </div>
        <div className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-sky-400" />
          <dt className="inline">Excused </dt>
          <dd className="inline font-medium text-foreground">{s.excused}</dd>
        </div>
        <div className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-destructive" />
          <dt className="inline">Unexcused </dt>
          <dd className="inline font-medium text-foreground">{s.unexcused}</dd>
        </div>
      </dl>
    </article>
  )
}

/** Subjects counted as one, e.g. BWM = BWM1 + BWM2. */
function Groups({ data }: { data: Attendance }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [name, setName] = useState('')

  const run = async (action: Promise<unknown>) => {
    try {
      await action
      setPicked([])
      setName('')
      await qc.invalidateQueries({ queryKey: ['absences', 'attendance'] })
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  return (
    <section className="mt-3 rounded-xl bg-card p-4 text-sm">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between font-medium">
        Group subjects
        <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {data.groups.map((g) => (
            <div key={g.name} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{g.name}</span> <span className="text-muted-foreground">{g.subjects.join(' + ')}</span>
              </span>
              <Button variant="ghost" size="xs" onClick={() => void run(absencesApi.deleteGroup(g.name))}>
                Remove
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-1.5">
            {data.allSubjects.map((s) => (
              <button
                key={s}
                onClick={() => setPicked((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))}
                className={chip(picked.includes(s))}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Name" />
            <Button disabled={!name.trim() || picked.length < 2} onClick={() => void run(absencesApi.saveGroup(name.trim(), picked))}>
              Group
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useNavigate, useParams, useRouterState, useSearch } from '@tanstack/react-router'
import { useIsFetching, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Download,
  ExternalLink,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  GraduationCap,
  Link2,
  Lock,
  Presentation,
  RotateCw,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { ErrorView } from '@/components/ErrorView'
import { Lightbox } from '@/components/Lightbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, errorText } from '@/lib/api'
import { dueText, safeHtml } from '@/lib/format'
import {
  courseTitle,
  moodleApi,
  moodleQ,
  sizeText,
  type MoodleCourse,
  type MoodleCourseContent,
  type MoodleDue,
  type MoodleFile,
  type MoodleGrade,
  type MoodleModule,
} from '@/lib/moodle'
import { cn } from '@/lib/utils'
import { MoodleAssignmentView } from '@/routes/moodle-assignment'

const activeCourse = (path: string) => {
  const m = path.match(/^\/moodle\/(\d+)/)
  return m ? Number(m[1]) : null
}

const notConnected = (e: unknown) => e instanceof ApiError && e.code === 'moodle_not_connected'

export function MoodleLayout() {
  const active = useRouterState({ select: (s) => activeCourse(s.location.pathname) })
  return (
    <div className="flex h-full">
      <CourseList active={active} className={cn('w-full md:w-80 md:border-r', active != null && 'hidden md:flex')} />
      <section className={cn('min-w-0 flex-1', active == null && 'hidden md:block')}>
        <Outlet />
      </section>
    </div>
  )
}

/** No course picked: on a wide screen the last used course opens by itself, so the tab never starts empty. */
export function NoCourse() {
  const home = useQuery(moodleQ.home())
  const navigate = useNavigate()
  const first = home.data?.courses[0]?.id
  useEffect(() => {
    if (first != null && matchMedia('(min-width: 768px)').matches) {
      void navigate({ to: '/moodle/$courseId', params: { courseId: String(first) }, replace: true })
    }
  }, [first, navigate])
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <GraduationCap className="size-10 opacity-30" />
    </div>
  )
}

/** Reload: empties the server cache and reads everything on screen again. */
function ReloadButton() {
  const qc = useQueryClient()
  const fetching = useIsFetching({ queryKey: ['moodle'] }) > 0
  const reload = async () => {
    try {
      await moodleApi.refresh()
      await qc.invalidateQueries({ queryKey: ['moodle'] })
    } catch (e) {
      toast.error(errorText(e))
    }
  }
  return (
    <button
      className="rounded-md p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
      onClick={() => void reload()}
      aria-label="Reload"
      title="Reload"
    >
      <RotateCw className={cn('size-4', fetching && 'animate-spin')} />
    </button>
  )
}

type Hit = { key: string; course: MoodleCourse; module: MoodleModule; file?: MoodleFile }

function CourseList({ active, className }: { active: number | null; className?: string }) {
  const home = useQuery(moodleQ.home())
  const courses = home.data?.courses ?? []
  // Every course is read as soon as the tab opens: a course opens without waiting and the search covers all files.
  const contents = useQueries({ queries: courses.map((c) => moodleQ.course(c.id)) })
  const [term, setTerm] = useState('')
  const t = term.trim().toLowerCase()

  const hits = useMemo(() => {
    if (!t) return []
    const out: Hit[] = []
    courses.forEach((course, i) => {
      for (const s of contents[i]?.data?.sections ?? []) {
        for (const module of s.modules) {
          if (module.type === 'label') continue
          const files = module.files.filter((f) => f.name.toLowerCase().includes(t))
          if (module.name.toLowerCase().includes(t)) out.push({ key: `m${module.cmid}`, course, module })
          else for (const file of files) out.push({ key: `f${module.cmid}${file.name}`, course, module, file })
        }
      }
    })
    return out.slice(0, 60)
    // contents is a new array on every render: its data only changes when a query updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, courses, contents.map((c) => c.dataUpdatedAt).join()])
  const courseHits = t ? courses.filter((c) => c.name.toLowerCase().includes(t)) : courses

  return (
    <aside className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <h1 className="flex-1 text-xl font-semibold">Moodle</h1>
        <ReloadButton />
      </div>
      <div className="relative mx-3 mb-2">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search" aria-label="Search" value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      <div className="tm-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {home.isError &&
          (notConnected(home.error) ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center text-muted-foreground">
              <p>Moodle is not connected</p>
              <Button size="sm" asChild>
                <Link to="/settings">Connect</Link>
              </Button>
            </div>
          ) : (
            !home.data && <ErrorView error={home.error} retry={() => void home.refetch()} />
          ))}
        {home.isPending && Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="mx-2 mb-2 h-12 rounded-lg" />)}

        {!t && !!home.data?.due.length && (
          <>
            <Heading>Open</Heading>
            {home.data.due.map((d) => (
              <DueRow key={d.url} d={d} course />
            ))}
            <Heading>Courses</Heading>
          </>
        )}

        {courseHits.map((c) => {
          const { code, title } = courseTitle(c)
          return (
            <Link
              key={c.id}
              to="/moodle/$courseId"
              params={{ courseId: String(c.id) }}
              className={cn('flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/5', active === c.id && 'bg-white/10')}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-[11px] font-semibold text-primary">{code}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
              {c.grade && <span className="shrink-0 text-xs text-muted-foreground">{c.grade}</span>}
            </Link>
          )
        })}

        {t && hits.length > 0 && <Heading>Files and activities</Heading>}
        {hits.map((h) => (
          <HitRow key={h.key} hit={h} />
        ))}
        {t && !courseHits.length && !hits.length && home.data && <p className="p-10 text-center text-muted-foreground">Nothing found</p>}
      </div>
    </aside>
  )
}

/** Something still to do (timeline): an assignment opens next to its course, everything else opens in Moodle. */
function DueRow({ d, course }: { d: MoodleDue; course?: boolean }) {
  const due = dueText(d.due)
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{d.name}</span>
        {course && <span className="block truncate text-xs text-muted-foreground">{courseTitle({ name: d.course }).code}</span>}
      </span>
      <span className={cn('shrink-0 text-xs', due.late ? 'text-destructive' : due.soon ? 'text-amber-400' : 'text-muted-foreground')}>{due.text}</span>
    </>
  )
  const cls = cn('flex items-center gap-3 rounded-lg py-2 transition-colors hover:bg-white/5', course ? 'px-3' : 'px-2')
  return d.type === 'assign' && d.cmid != null && d.courseId != null ? (
    <Link to="/moodle/$courseId" params={{ courseId: String(d.courseId) }} search={{ a: d.cmid }} className={cls}>
      {body}
    </Link>
  ) : (
    <a href={d.url} target="_blank" rel="noopener noreferrer" className={cls}>
      {body}
    </a>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="px-3 pt-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{children}</h2>
}

function HitRow({ hit }: { hit: Hit }) {
  const { course, module, file } = hit
  const Icon = file ? iconFor(file.name) : moduleIcon(module)
  const body = (
    <>
      <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{file?.name ?? module.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{courseTitle(course).code}</span>
      </span>
    </>
  )
  const cls = 'flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-white/5'
  const href = file?.view ?? (module.files.length === 1 && module.type === 'resource' ? module.files[0].view : module.link)
  if (href)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {body}
      </a>
    )
  return (
    <Link
      to="/moodle/$courseId"
      params={{ courseId: String(course.id) }}
      search={module.type === 'assign' ? { a: module.cmid } : {}}
      hash={module.type === 'assign' ? undefined : `m${module.cmid}`}
      className={cls}
    >
      {body}
    </Link>
  )
}

// ---- one course ------------------------------------------------------------------------

const ICONS: [RegExp, typeof File][] = [
  [/\.(pdf|docx?|odt|rtf|txt|md)$/i, FileText],
  [/\.(pptx?|ppsx?|odp|key)$/i, Presentation],
  [/\.(xlsx?|ods|csv)$/i, FileSpreadsheet],
  [/\.(png|jpe?g|gif|webp|heic|bmp)$/i, FileImage],
  [/\.(mp4|mov|webm|mkv|avi)$/i, FileVideo],
]
const iconFor = (name: string) => ICONS.find(([re]) => re.test(name))?.[1] ?? File

function moduleIcon(m: MoodleModule) {
  if (m.type === 'assign') return ClipboardList
  if (m.type === 'folder') return Folder
  if (m.type === 'url') return Link2
  if (m.type === 'resource' && m.files.length) return iconFor(m.files[0].name)
  if (m.type === 'page') return FileText
  return ExternalLink
}

export function CoursePage() {
  const { courseId } = useParams({ from: '/shell/moodle/$courseId' })
  const { a } = useSearch({ from: '/shell/moodle/$courseId' })
  const id = Number(courseId)
  const navigate = useNavigate()
  const home = useQuery(moodleQ.home())
  const course = useQuery(moodleQ.course(id))
  const meta = home.data?.courses.find((c) => c.id === id)
  const { code, title } = courseTitle({ name: course.data?.name || meta?.name || '', short: meta?.short })
  const open = (cmid?: number) => void navigate({ to: '/moodle/$courseId', params: { courseId }, search: cmid ? { a: cmid } : {}, replace: true })
  const due = (home.data?.due ?? []).filter((d) => d.courseId === id)
  const total = course.data?.total ?? meta?.grade

  return (
    <div className="flex h-full min-w-0">
      <div className={cn('flex h-full min-w-0 flex-1 flex-col', a != null && 'hidden lg:flex')}>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2 md:px-4">
          <Link to="/moodle" className="rounded-md p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground md:hidden" aria-label="Back">
            <ArrowLeft className="size-5" />
          </Link>
          <h1 className="min-w-0 flex-1 truncate font-semibold">
            {title}
            {code && title !== code && <span className="ml-2 text-sm font-normal text-muted-foreground">{code}</span>}
          </h1>
          {total && <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary tabular-nums">{total}</span>}
          <a
            href={`https://moodle.spengergasse.at/course/view.php?id=${id}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in Moodle"
            aria-label="Open in Moodle"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
          >
            <ExternalLink className="size-4" />
          </a>
        </header>
        <div className="tm-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-2 pb-10 md:px-6">
            {course.isError && !course.data && <ErrorView error={course.error} retry={() => void course.refetch()} />}
            {course.isPending && Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="mt-2 h-10 rounded-lg" />)}
            {due.length > 0 && (
              <section>
                <SectionHeading>Open</SectionHeading>
                {due.map((d) => (
                  <DueRow key={d.url} d={d} />
                ))}
              </section>
            )}
            {course.data && <Sections course={course.data} active={a} open={open} />}
            {!!course.data?.grades?.length && (
              <section>
                <SectionHeading>Grades</SectionHeading>
                {course.data.grades.map((g, i) => (
                  <GradeRow key={i} g={g} />
                ))}
              </section>
            )}
          </div>
        </div>
      </div>
      {a != null && (
        <aside className="h-full w-full min-w-0 lg:w-[26rem] lg:shrink-0 lg:border-l">
          <MoodleAssignmentView cmid={a} courseId={id} onClose={() => open()} />
        </aside>
      )}
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="sticky top-0 z-10 bg-background/95 px-2 pt-5 pb-2 text-sm font-semibold backdrop-blur">{children}</h2>
}

function Sections({ course, active, open }: { course: MoodleCourseContent; active?: number; open: (cmid: number) => void }) {
  const [zoom, setZoom] = useState<string | null>(null)
  // Teachers add the newest topic at the bottom: it goes on top here, and the general section (number 0) last.
  const sections = useMemo(
    () => [...course.sections].sort((x, y) => (x.number === 0 ? 1 : y.number === 0 ? -1 : y.number - x.number)),
    [course.sections],
  )
  // a search hit points at an activity with #m<cmid>
  const hash = useRouterState({ select: (s) => s.location.hash })
  useEffect(() => {
    if (hash) document.getElementById(hash)?.scrollIntoView({ block: 'center' })
  }, [hash, course.id])
  if (!course.sections.length) return <p className="p-10 text-center text-muted-foreground">Empty</p>
  return (
    <div
      onClick={(e) => {
        const el = e.target as HTMLElement
        if (el.tagName === 'IMG' && el.closest('.tm-msg')) setZoom((el as HTMLImageElement).src)
      }}
    >
      {sections.map((s) => (
        <section key={s.id}>
          <SectionHeading>{s.name}</SectionHeading>
          {s.summary && <Clamp html={s.summary} className="px-2 pb-2 text-sm text-muted-foreground" />}
          {s.modules.map((m) => (
            <ModuleRow key={m.cmid} m={m} active={active === m.cmid} open={open} />
          ))}
        </section>
      ))}
      <Lightbox src={zoom} onClose={() => setZoom(null)} />
    </div>
  )
}

function Html({ html, className }: { html: string; className?: string }) {
  const clean = useMemo(() => safeHtml(html), [html])
  if (!clean.replace(/<[^>]+>|&nbsp;|\s/g, '') && !clean.includes('<img')) return null
  return <div className={cn('tm-msg leading-relaxed', className)} dangerouslySetInnerHTML={{ __html: clean }} />
}

/** Teacher text (labels, section summaries) shows two lines; a click on it or on the arrow opens the rest. */
function Clamp({ html, className }: { html: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [long, setLong] = useState(false)
  useLayoutEffect(() => {
    const el = box.current
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 4)
  }, [html, open])
  return (
    <div
      className={cn('flex items-start gap-1', long && 'cursor-pointer', className)}
      onClick={(e) => {
        const tag = (e.target as HTMLElement).closest('a, img, button')
        if (long && !tag) setOpen((v) => !v)
      }}
    >
      <div ref={box} className={cn('min-w-0 flex-1', !open && 'max-h-[2.9rem] overflow-hidden')}>
        <Html html={html} />
      </div>
      {long && (
        <button className="shrink-0 rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground" onClick={() => setOpen((v) => !v)} aria-label={open ? 'Less' : 'More'}>
          <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
        </button>
      )}
    </div>
  )
}

const rowCls = 'flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left'

function FileRow({ f, indent }: { f: MoodleFile; indent?: boolean }) {
  const Icon = iconFor(f.name)
  return (
    <div className={cn('group flex items-center rounded-lg text-sm transition-colors hover:bg-white/5', indent && 'ml-7')}>
      <a className={rowCls} href={f.view} target="_blank" rel="noopener noreferrer">
        <Icon className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">{f.name}</span>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{sizeText(f.size)}</span>
      </a>
      <a
        href={`${f.view}&download=true`}
        className="mr-1 rounded p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-foreground focus-visible:opacity-100"
        aria-label="Download"
      >
        <Download className="size-4" />
      </a>
    </div>
  )
}

function ModuleRow({ m, active, open }: { m: MoodleModule; active: boolean; open: (cmid: number) => void }) {
  const [expanded, setExpanded] = useState(false)
  const id = `m${m.cmid}`
  if (m.type === 'label') return <Clamp html={m.description} className="px-2 py-2 text-sm text-muted-foreground" />

  const Icon = moduleIcon(m)
  const due = m.dates.find((d) => d.id === 'duedate')?.time ?? null
  const dueInfo = due ? dueText(due) : null
  const name = (
    <>
      <Icon className={cn('size-5 shrink-0', m.type === 'assign' || m.type === 'folder' ? 'text-primary' : 'text-muted-foreground')} strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate">{m.name}</span>
    </>
  )
  const wrap = (child: React.ReactNode, below?: React.ReactNode) => (
    <div id={id}>
      <div className={cn('group flex items-center rounded-lg text-sm transition-colors hover:bg-white/5', active && 'bg-white/10')}>{child}</div>
      {below}
    </div>
  )

  if (m.restricted)
    return wrap(
      <div className={cn(rowCls, 'text-muted-foreground')} title={m.restricted}>
        <Lock className="size-5 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">{m.name}</span>
      </div>,
    )
  if (m.type === 'assign')
    return wrap(
      <button className={rowCls} onClick={() => open(m.cmid)}>
        {name}
        {/* one rule for the right slot: the grade, else a check when handed in, else when it is due */}
        {m.grade ? (
          <span className="shrink-0 text-sm font-semibold tabular-nums">{m.grade}</span>
        ) : m.status === 'submitted' || m.done ? (
          <CheckCircle2 className="size-4 shrink-0 text-primary" />
        ) : (
          dueInfo && (
            <span className={cn('shrink-0 text-xs', dueInfo.late ? 'text-destructive' : dueInfo.soon ? 'text-amber-400' : 'text-muted-foreground')}>
              {dueInfo.text}
            </span>
          )
        )}
      </button>,
    )
  if (m.type === 'resource' && m.files.length === 1) return <div id={id}><FileRow f={{ ...m.files[0], name: m.name }} /></div>
  if (m.type === 'folder' || (m.type === 'resource' && m.files.length > 1))
    return wrap(
      <button className={rowCls} onClick={() => setExpanded((v) => !v)}>
        {name}
        <span className="shrink-0 text-xs text-muted-foreground">{m.files.length}</span>
        <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
      </button>,
      expanded && m.files.map((f) => <FileRow key={f.url} f={f} indent />),
    )
  if (m.type === 'page' && m.files.length)
    return wrap(
      <button className={rowCls} onClick={() => setExpanded((v) => !v)}>
        {name}
        <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
      </button>,
      expanded && <PageBody url={m.files.find((f) => f.name === 'index.html')?.url ?? m.files[0].url} />,
    )
  // links, forums, quizzes and everything else open where they live
  return wrap(
    <a className={rowCls} href={m.link ?? m.url} target="_blank" rel="noopener noreferrer">
      {name}
      {m.done && <CheckCircle2 className="size-4 shrink-0 text-primary" />}
    </a>,
  )
}

function PageBody({ url }: { url: string }) {
  const page = useQuery(moodleQ.page(url))
  if (page.isPending) return <Skeleton className="mx-2 my-2 ml-9 h-16 rounded-lg" />
  if (page.isError) return <ErrorView error={page.error} retry={() => void page.refetch()} />
  return <Html html={page.data.html} className="mb-2 ml-9 rounded-lg bg-card p-3 text-sm" />
}

/** A graded item that is not an assignment row (tests, manual items, category totals). */
function GradeRow({ g }: { g: MoodleGrade }) {
  return (
    <div className="flex items-start gap-3 px-2 py-2">
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm', g.total && 'font-semibold')}>{g.name}</span>
        {g.feedback && <span className="mt-0.5 block text-xs whitespace-pre-line text-muted-foreground">{g.feedback}</span>}
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold tabular-nums">{g.grade}</span>
        {g.range && <span className="block text-xs text-muted-foreground tabular-nums">{g.range}</span>}
      </span>
    </div>
  )
}

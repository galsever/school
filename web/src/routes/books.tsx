import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useNavigate, useParams, useRouterState, useSearch } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowLeft, BookOpen, ListTree, Minus, Plus, RotateCw, Search, X } from 'lucide-react'
import { ErrorView } from '@/components/ErrorView'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api'
import {
  booksApi,
  booksQ,
  coverUrl,
  fold,
  pageUrl,
  runMatches,
  searchWords,
  snippetParts,
  spanOf,
  type Book,
  type BookHit,
  type ShelfBook,
} from '@/lib/books'
import { cn } from '@/lib/utils'

const activeBook = (path: string) => {
  const m = path.match(/^\/books\/(\d+)/)
  return m ? Number(m[1]) : null
}

const notConnected = (e: unknown) => e instanceof ApiError && e.code === 'books_not_connected'
const LAST = 'books:last'
const lastPageKey = (id: number) => `books:page:${id}`

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function BooksLayout() {
  const active = useRouterState({ select: (s) => activeBook(s.location.pathname) })
  return (
    <div className="flex h-full">
      <ShelfList active={active} className={cn('w-full md:w-80 md:border-r', active != null && 'hidden md:flex')} />
      <section className={cn('min-w-0 flex-1', active == null && 'hidden md:block')}>
        <Outlet />
      </section>
    </div>
  )
}

/** No book picked: on a wide screen the book read last opens by itself. */
export function NoBook() {
  const shelf = useQuery(booksQ.shelf())
  const navigate = useNavigate()
  const last = Number(localStorage.getItem(LAST))
  const known = shelf.data?.books.some((b) => b.id === last)
  useEffect(() => {
    if (known && matchMedia('(min-width: 768px)').matches) void navigate({ to: '/books/$bookId', params: { bookId: String(last) }, replace: true })
  }, [known, last, navigate])
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <BookOpen className="size-10 opacity-30" />
    </div>
  )
}

function ShelfList({ active, className }: { active: number | null; className?: string }) {
  const qc = useQueryClient()
  const shelf = useQuery(booksQ.shelf())
  const [term, setTerm] = useState('')
  const q = useDebounced(term.trim(), 300)
  const hits = useQuery(booksQ.search(q))
  const books = shelf.data?.books ?? []
  const [reloading, setReloading] = useState(false)
  const reload = async () => {
    setReloading(true)
    try {
      qc.setQueryData(['books'], await booksApi.shelf(true))
    } finally {
      setReloading(false)
    }
  }
  const searching = q.length >= 2
  const titleHits = searching ? books.filter((b) => fold(b.title).includes(fold(q))) : books
  const grouped = useMemo(() => {
    const out = new Map<number, BookHit[]>()
    for (const h of hits.data ?? []) out.set(h.book, [...(out.get(h.book) ?? []), h])
    return [...out.entries()]
  }, [hits.data])

  return (
    <aside className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <h1 className="flex-1 text-xl font-semibold">Books</h1>
        <button
          className="rounded-md p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
          onClick={() => void reload()}
          aria-label="Reload"
          title="Reload"
        >
          <RotateCw className={cn('size-4', reloading && 'animate-spin')} />
        </button>
      </div>
      <div className="relative mx-3 mb-2">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search" aria-label="Search" value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      <div className="tm-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {shelf.isError &&
          (notConnected(shelf.error) ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center text-muted-foreground">
              <p>digi4school is not connected</p>
              <Button size="sm" asChild>
                <Link to="/settings">Connect</Link>
              </Button>
            </div>
          ) : (
            !shelf.data && <ErrorView error={shelf.error} retry={() => void shelf.refetch()} />
          ))}
        {shelf.data && !shelf.data.configured && !books.length && (
          <div className="flex flex-col items-center gap-3 p-10 text-center text-muted-foreground">
            <p>digi4school is not connected</p>
            <Button size="sm" asChild>
              <Link to="/settings">Connect</Link>
            </Button>
          </div>
        )}
        {shelf.isPending && Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="mx-2 mb-2 h-16 rounded-lg" />)}

        {titleHits.map((b) => (
          <ShelfRow key={b.id} book={b} active={active === b.id} />
        ))}

        {searching &&
          grouped.map(([id, list]) => (
            <div key={id}>
              <h2 className="truncate px-3 pt-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {list[0].title || books.find((b) => b.id === id)?.title}
              </h2>
              {list.slice(0, 8).map((h) => (
                <HitRow key={`${h.book}-${h.page}`} hit={h} q={q} />
              ))}
              {list.length > 8 && (
                <Link
                  to="/books/$bookId"
                  params={{ bookId: String(id) }}
                  search={{ q }}
                  className="block px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  {list.length - 8} more
                </Link>
              )}
            </div>
          ))}
        {searching && hits.isFetching && !hits.data && <Skeleton className="mx-2 mt-2 h-12 rounded-lg" />}
        {searching && hits.data && !hits.data.length && !titleHits.length && <p className="p-10 text-center text-muted-foreground">Nothing found</p>}
      </div>
    </aside>
  )
}

function Cover({ book, className }: { book: Pick<ShelfBook, 'id' | 'title' | 'cover'>; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (book.cover && !failed)
    return <img src={coverUrl(book.id)} alt="" className={cn('shrink-0 rounded object-cover', className)} onError={() => setFailed(true)} />
  const initials = book.title
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
  return <span className={cn('grid shrink-0 place-items-center rounded bg-primary/15 text-[11px] font-semibold text-primary', className)}>{initials}</span>
}

function stateText(b: Pick<ShelfBook, 'state' | 'done' | 'pages' | 'error'>) {
  if (b.state === 'loading' || b.state === 'text') return b.pages ? `${Math.floor((100 * b.done) / b.pages)} %` : '…'
  if (b.state === 'error') return 'Error'
  return null
}

function ShelfRow({ book, active }: { book: ShelfBook; active: boolean }) {
  const st = stateText(book)
  return (
    <Link
      to="/books/$bookId"
      params={{ bookId: String(book.id) }}
      className={cn('flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-white/5', active && 'bg-white/10')}
    >
      <Cover book={book} className="h-12 w-9" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-medium">{book.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{book.publisher}</span>
      </span>
      {st && <span className={cn('shrink-0 text-xs', book.state === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{st}</span>}
    </Link>
  )
}

function Snippet({ text }: { text: string }) {
  return (
    <>
      {snippetParts(text).map((p, i) =>
        p.mark ? (
          <mark key={i} className="rounded-sm bg-amber-400/30 text-foreground">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}

function HitRow({ hit, q, onPick }: { hit: BookHit; q: string; onPick?: () => void }) {
  return (
    <Link
      to="/books/$bookId"
      params={{ bookId: String(hit.book) }}
      search={{ p: hit.page, q }}
      onClick={onPick}
      className="flex gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-white/5"
    >
      <span className="w-9 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{hit.label}</span>
      <span className="line-clamp-2 min-w-0 flex-1 text-sm text-muted-foreground">
        <Snippet text={hit.snippet} />
      </span>
    </Link>
  )
}

// ---- reader ----------------------------------------------------------------------------------

/** Zoom is relative to the fitted width (the reader's width, at most BASE_WIDTH): 100 % always fits. */
const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4]
const MIN_ZOOM = ZOOMS[0]
const MAX_ZOOM = ZOOMS[ZOOMS.length - 1]
const BASE_WIDTH = 860
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
const stepUp = (z: number) => ZOOMS.find((s) => s > z + 0.01) ?? MAX_ZOOM
const stepDown = (z: number) => [...ZOOMS].reverse().find((s) => s < z - 0.01) ?? MIN_ZOOM

type Anchor = { el: HTMLElement; fx: number; fy: number; cx: number; cy: number }

/** Pinch (touch and trackpad), Ctrl+wheel, Ctrl +/-/0 and the buttons. While a gesture runs the column is only scaled
 * (cheap, smooth); at its end the zoom is set and the point under the fingers or the pointer stays where it was. */
function useZoom(
  scroller: HTMLDivElement | null,
  column: React.RefObject<HTMLDivElement | null>,
  pageEls: React.RefObject<Map<number, HTMLDivElement>>,
) {
  const [zoom, setZoomState] = useState(() => clampZoom(Number(localStorage.getItem('books:zoom')) || 1))
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const anchor = useRef<Anchor | null>(null)
  const live = useRef<{ anchor: Anchor | null; scale: number; timer: number } | null>(null)

  useEffect(() => localStorage.setItem('books:zoom', String(zoom)), [zoom])

  const anchorAt = (cx: number, cy: number): Anchor | null => {
    let best: HTMLElement | null = null
    let dist = Infinity
    for (const el of pageEls.current.values()) {
      const r = el.getBoundingClientRect()
      const d = cy < r.top ? r.top - cy : cy > r.bottom ? cy - r.bottom : 0
      if (d < dist) [best, dist] = [el, d]
      if (d === 0) break
    }
    if (!best) return null
    const r = best.getBoundingClientRect()
    return { el: best, fx: (cx - r.left) / r.width, fy: (cy - r.top) / r.height, cx, cy }
  }

  // after the new width is laid out: the anchor point back under the pointer
  useLayoutEffect(() => {
    const a = anchor.current
    anchor.current = null
    if (!a || !scroller) return
    const r = a.el.getBoundingClientRect()
    scroller.scrollLeft += r.left + a.fx * r.width - a.cx
    scroller.scrollTop += r.top + a.fy * r.height - a.cy
  }, [zoom, scroller])

  const commit = (next: number, a: Anchor | null) => {
    if (column.current) column.current.style.transform = ''
    next = clampZoom(Math.round(next * 100) / 100)
    if (next === zoomRef.current) return
    anchor.current = a
    setZoomState(next)
  }

  const setZoom = (next: number) => {
    if (!scroller) return setZoomState(clampZoom(next))
    const r = scroller.getBoundingClientRect()
    commit(next, anchorAt(r.left + r.width / 2, r.top + r.height / 3))
  }

  useEffect(() => {
    if (!scroller) return
    const begin = (cx: number, cy: number) => {
      const col = column.current
      if (!col) return
      const r = col.getBoundingClientRect()
      col.style.transformOrigin = `${cx - r.left}px ${cy - r.top}px`
      live.current = { anchor: anchorAt(cx, cy), scale: 1, timer: 0 }
    }
    const scaleTo = (scale: number) => {
      const g = live.current
      if (!g || !column.current) return
      const z = zoomRef.current
      g.scale = clampZoom(z * scale) / z
      column.current.style.transform = `scale(${g.scale})`
    }
    const end = () => {
      const g = live.current
      live.current = null
      if (g) commit(zoomRef.current * g.scale, g.anchor)
    }
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      if (!live.current) begin(e.clientX, e.clientY)
      const g = live.current
      if (!g) return
      const delta = Math.max(-60, Math.min(60, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY))
      scaleTo(g.scale * Math.exp(-delta * 0.004))
      clearTimeout(g.timer)
      g.timer = window.setTimeout(end, 160)
    }
    let startDist = 0
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return
      startDist = dist(e.touches)
      begin((e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2)
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!startDist || e.touches.length !== 2) return
      e.preventDefault()
      scaleTo(dist(e.touches) / startDist)
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (startDist && e.touches.length < 2) {
        startDist = 0
        end()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const z = zoomRef.current
      if (e.key === '+' || e.key === '=') setZoom(stepUp(z))
      else if (e.key === '-') setZoom(stepDown(z))
      else if (e.key === '0') setZoom(1)
      else return
      e.preventDefault()
    }
    scroller.addEventListener('wheel', onWheel, { passive: false })
    scroller.addEventListener('touchstart', onTouchStart, { passive: true })
    scroller.addEventListener('touchmove', onTouchMove, { passive: false })
    scroller.addEventListener('touchend', onTouchEnd)
    scroller.addEventListener('touchcancel', onTouchEnd)
    window.addEventListener('keydown', onKey)
    return () => {
      scroller.removeEventListener('wheel', onWheel)
      scroller.removeEventListener('touchstart', onTouchStart)
      scroller.removeEventListener('touchmove', onTouchMove)
      scroller.removeEventListener('touchend', onTouchEnd)
      scroller.removeEventListener('touchcancel', onTouchEnd)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroller])

  return { zoom, setZoom, smaller: () => setZoom(stepDown(zoom)), larger: () => setZoom(stepUp(zoom)) }
}

/** The reader's inner width, for the fitted page width. */
function useWidth(el: HTMLElement | null) {
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return w
}

/** Keyed by book: panel, search and scroll start fresh for every book. */
export function BookPage() {
  const { bookId } = useParams({ from: '/shell/books/$bookId' })
  return <Reader key={bookId} bookId={bookId} />
}

function Reader({ bookId }: { bookId: string }) {
  const { p, q } = useSearch({ from: '/shell/books/$bookId' })
  const id = Number(bookId)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const shelf = useQuery(booksQ.shelf())
  const book = useQuery(booksQ.book(id))
  const entry = shelf.data?.books.find((b) => b.id === id)
  const b = book.data
  const title = b?.title || entry?.title || ''
  const [current, setCurrent] = useState(1)
  const [panel, setPanel] = useState<'toc' | 'search' | null>(q ? 'search' : null)
  const [term, setTerm] = useState(q ?? '')
  const liveTerm = useDebounced(term.trim(), 300)
  const scroller = useRef<HTMLDivElement | null>(null)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const pageEls = useRef(new Map<number, HTMLDivElement>())
  const columnRef = useRef<HTMLDivElement | null>(null)
  const { zoom, setZoom, smaller, larger } = useZoom(root, columnRef, pageEls)
  const viewWidth = useWidth(root)

  useEffect(() => localStorage.setItem(LAST, String(id)), [id])
  useEffect(() => {
    setTerm(q ?? '')
    if (q) setPanel('search')
  }, [q])

  const goTo = (n: number, smooth = false) => {
    const el = pageEls.current.get(n)
    if (el) el.scrollIntoView({ block: 'start', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' })
  }

  // copying from the page: lines back into running text ("Zei-" + "chen" -> "Zeichen")
  useEffect(() => {
    if (!root) return
    const onCopy = (e: ClipboardEvent) => {
      const sel = getSelection()
      if (!sel || sel.isCollapsed || !sel.anchorNode?.parentElement?.closest('.book-text')) return
      const text = sel
        .toString()
        .replace(/(\p{Ll})-\n(?=\p{Ll})/gu, '$1')
        .replace(/[ \t]*\n[ \t]*/g, ' ')
        .trim()
      e.clipboardData?.setData('text/plain', text)
      e.preventDefault()
    }
    root.addEventListener('copy', onCopy)
    return () => root.removeEventListener('copy', onCopy)
  }, [root])

  // the shelf shows the download state too
  const state = book.data?.state
  useEffect(() => {
    if (state) void qc.invalidateQueries({ queryKey: ['books'] })
  }, [state, qc])

  // first paint: the page from the link (search hit), else where reading stopped
  const pages = b?.pages ?? []
  const started = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!pages.length) return
    const key = `${id}:${p ?? ''}`
    if (started.current === key) return
    started.current = key
    const target = p ?? Number(localStorage.getItem(lastPageKey(id)))
    if (p ? target >= 1 : target > 1) requestAnimationFrame(() => goTo(Math.min(target, pages.length)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, p, pages.length])

  // current page: the one crossing the upper third of the reader
  useEffect(() => {
    const root = scroller.current
    if (!root || !pages.length) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const mark = root.getBoundingClientRect().top + root.clientHeight / 3
        for (const [n, el] of pageEls.current) {
          const r = el.getBoundingClientRect()
          if (r.top <= mark && r.bottom > mark) {
            setCurrent(n)
            localStorage.setItem(lastPageKey(id), String(n))
            break
          }
        }
      })
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => root.removeEventListener('scroll', onScroll)
  }, [id, pages.length])

  const markTerm = panel === 'search' ? liveTerm : (q ?? '')
  const words = useMemo(() => searchWords(markTerm), [markTerm])
  const pad = viewWidth >= 768 ? 24 : 16
  const fit = Math.min(BASE_WIDTH, Math.max(200, viewWidth - pad))
  const width = Math.round(fit * zoom) + pad
  const loading = b?.state === 'loading' || b?.state === 'text'

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b px-2 md:px-4">
        <Link to="/books" className="rounded-md p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground md:hidden" aria-label="Back">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-semibold">{title}</h1>
        {pages.length > 0 && <PageBox pages={b!} current={current} onGo={(n) => goTo(n)} />}
        <IconButton label="Contents" active={panel === 'toc'} disabled={!b?.toc.length} onClick={() => setPanel(panel === 'toc' ? null : 'toc')}>
          <ListTree className="size-4" />
        </IconButton>
        <IconButton label="Search in book" active={panel === 'search'} disabled={!b?.text} onClick={() => setPanel(panel === 'search' ? null : 'search')}>
          <Search className="size-4" />
        </IconButton>
        <span className="hidden items-center sm:flex">
          <IconButton label="Smaller" disabled={zoom <= MIN_ZOOM} onClick={smaller}>
            <Minus className="size-4" />
          </IconButton>
          <button
            className="h-8 w-12 rounded-md text-xs text-muted-foreground tabular-nums hover:bg-white/10 hover:text-foreground"
            onClick={() => setZoom(1)}
            title="Fit width"
          >
            {Math.round(zoom * 100)} %
          </button>
          <IconButton label="Larger" disabled={zoom >= MAX_ZOOM} onClick={larger}>
            <Plus className="size-4" />
          </IconButton>
        </span>
      </header>
      {loading && b && b.pages.length > 0 && (
        <div className="h-0.5 shrink-0 bg-white/5">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${(100 * b.done) / b.pages.length}%` }} />
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        <div
          ref={(el) => {
            scroller.current = el
            setRoot(el)
          }}
          className="tm-scroll min-h-0 flex-1 touch-pan-x touch-pan-y overflow-auto bg-black/20">
          {book.isError && <ErrorView error={book.error} retry={() => void book.refetch()} />}
          {b?.state === 'error' && (
            <div className="flex flex-col items-center gap-3 p-6 text-center text-sm text-muted-foreground">
              <p className="text-destructive">{b.error || 'Download failed'}</p>
              <Button size="sm" variant="secondary" onClick={() => void book.refetch()}>
                Try again
              </Button>
            </div>
          )}
          {(book.isPending || (b && !pages.length && b.state !== 'error')) && (
            <div className="mx-auto flex w-full flex-col gap-3 p-2 md:p-3" style={{ maxWidth: width }}>
              <Skeleton className="aspect-[909/1286] w-full rounded" />
            </div>
          )}
          <div ref={columnRef} className="mx-auto flex flex-col gap-3 p-2 will-change-transform md:p-3" style={{ width: viewWidth ? width : undefined }}>
            {pages.map((pg, i) => (
              <Page
                key={i + 1}
                bookId={id}
                n={i + 1}
                w={pg.w}
                h={pg.h}
                label={pg.label}
                text={!!b?.text}
                ready={!loading || i < (b?.done ?? 0) || b?.state === 'ready'}
                version={loading ? (b?.done ?? 0) : -1}
                words={words}
                root={root}
                refCb={(el) => {
                  if (el) pageEls.current.set(i + 1, el)
                  else pageEls.current.delete(i + 1)
                }}
              />
            ))}
          </div>
        </div>
        {panel && b && (
          <aside className="tm-scroll absolute inset-0 z-10 flex flex-col overflow-hidden bg-background md:static md:w-80 md:border-l">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
              {panel === 'search' ? (
                <form
                  className="relative flex-1"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void navigate({ to: '/books/$bookId', params: { bookId }, search: { q: term.trim() || undefined }, replace: true })
                  }}
                >
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input autoFocus className="h-8 pl-8" placeholder="Search in book" value={term} onChange={(e) => setTerm(e.target.value)} />
                </form>
              ) : (
                <span className="flex-1 text-sm font-medium">Contents</span>
              )}
              <IconButton label="Close" onClick={() => setPanel(null)}>
                <X className="size-4" />
              </IconButton>
            </div>
            <div className="tm-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
              {panel === 'toc' ? (
                <Toc book={b} current={current} onGo={(n) => (goTo(n), matchMedia('(min-width: 768px)').matches || setPanel(null))} />
              ) : (
                <BookHits bookId={id} q={liveTerm} onPick={(n) => (goTo(n), matchMedia('(min-width: 768px)').matches || setPanel(null))} />
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

function IconButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn(
        'rounded-md p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-white/10 text-foreground',
      )}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

/** Printed page of the page in view; typing a printed page (or U1) and Enter jumps there. */
function PageBox({ pages, current, onGo }: { pages: Book; current: number; onGo: (n: number) => void }) {
  const label = pages.pages[current - 1]?.label ?? ''
  const [value, setValue] = useState<string | null>(null)
  return (
    <form
      className="flex items-center gap-1 text-sm text-muted-foreground"
      onSubmit={(e) => {
        e.preventDefault()
        const v = (value ?? '').trim().toLowerCase()
        const i = pages.pages.findIndex((p) => p.label.toLowerCase() === v)
        if (i >= 0) onGo(i + 1)
        else if (v) toast.error(`No page ${v}`)
        setValue(null)
        ;(document.activeElement as HTMLElement | null)?.blur()
      }}
    >
      <Input
        aria-label="Page"
        className="h-8 w-14 px-1 text-center tabular-nums"
        value={value ?? label}
        onFocus={(e) => (setValue(''), e.target.select())}
        onBlur={() => setValue(null)}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setValue(null)
            e.currentTarget.blur()
          }
        }}
      />
    </form>
  )
}

function Toc({ book, current, onGo }: { book: Book; current: number; onGo: (n: number) => void }) {
  const active = book.toc.reduce((acc, t, i) => (t.page <= current ? i : acc), -1)
  return (
    <>
      {book.toc.map((t, i) => {
        const depth = (t.title.match(/^\s*(\d+(?:\.\d+)*)/)?.[1].split('.').length ?? 1) - 1
        return (
          <button
            key={i}
            onClick={() => onGo(t.page)}
            className={cn('flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/5', i === active && 'bg-white/10')}
            style={{ paddingLeft: 8 + Math.min(depth, 3) * 12 }}
          >
            <span className={cn('min-w-0 flex-1', depth === 0 && 'font-medium')}>{t.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{book.pages[t.page - 1]?.label}</span>
          </button>
        )
      })}
    </>
  )
}

function BookHits({ bookId, q, onPick }: { bookId: number; q: string; onPick: (page: number) => void }) {
  const hits = useQuery(booksQ.search(q, bookId))
  if (q.length < 2) return null
  if (hits.isPending) return <Skeleton className="m-2 h-12 rounded-lg" />
  if (!hits.data?.length) return <p className="p-8 text-center text-sm text-muted-foreground">Nothing found</p>
  return (
    <>
      <p className="px-3 py-1 text-xs text-muted-foreground">{hits.data.length >= 200 ? '200+' : hits.data.length} pages</p>
      {hits.data.map((h) => (
        <HitRow key={h.page} hit={h} q={q} onPick={() => onPick(h.page)} />
      ))}
    </>
  )
}

type PageProps = {
  bookId: number
  n: number
  w: number
  h: number
  label: string
  text: boolean
  ready: boolean
  version: number
  words: string[]
  root: HTMLElement | null
  refCb: (el: HTMLDivElement | null) => void
}

/** One page: a box of the page's shape; the SVG and its text load when the page comes near the view. */
const Page = memo(function Page({ bookId, n, w, h, label, text, ready, version, words, root, refCb }: PageProps) {
  const box = useRef<HTMLDivElement | null>(null)
  const [near, setNear] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el || !root) return
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root, rootMargin: '150% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [root])
  // a page that was not there yet is tried again while the download goes on
  useEffect(() => {
    if (failed) setFailed(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])
  const show = near && ready && !failed
  return (
    <div
      ref={(el) => {
        box.current = el
        refCb(el)
      }}
      className="relative w-full overflow-hidden rounded-sm bg-white shadow"
      style={{ aspectRatio: `${w || 909} / ${h || 1286}` }}
      data-page={label}
    >
      {show ? (
        <>
          <img src={pageUrl(bookId, n)} alt={`Page ${label}`} className="absolute inset-0 size-full select-none" draggable={false} onError={() => setFailed(true)} />
          {text && <TextLayer bookId={bookId} n={n} w={w} h={h} words={words} />}
        </>
      ) : (
        <div className="absolute inset-0 animate-pulse bg-neutral-200" />
      )}
    </div>
  )
})

/** The page's text, invisible over the drawing: selectable, copyable, found by Ctrl+F; search words marked. */
function TextLayer({ bookId, n, w, h, words }: { bookId: number; n: number; w: number; h: number; words: string[] }) {
  const runs = useQuery(booksQ.text(bookId, n))
  if (!runs.data?.length) return null
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="book-text absolute inset-0 size-full" preserveAspectRatio="none">
      {words.length > 0 &&
        runs.data.flatMap(([x, y, rw, rh, t], i) =>
          runMatches(t, words).map(([at, len]) => {
            const [dx, ww] = spanOf(t, at, len, rw)
            return <rect key={`m${i}-${at}`} x={x + dx - 1} y={y} width={ww + 2} height={rh} rx={2} className="fill-amber-400/40" />
          }),
        )}
      {runs.data.map(([x, y, rw, rh, t], i) => (
        <text key={i} x={x} y={y + rh * 0.8} fontSize={rh * 0.9} textLength={rw > 0 ? rw : undefined} lengthAdjust="spacingAndGlyphs">
          {t}
        </text>
      ))}
    </svg>
  )
}

// Books tab (digi4school): API shapes (docs/API.md), calls and queries.
import { queryOptions } from '@tanstack/react-query'
import { post, request } from './api'

export type BookState = 'none' | 'loading' | 'text' | 'partial' | 'ready' | 'error'
export type ShelfBook = {
  id: number
  code: string
  title: string
  publisher: string
  state: BookState
  pages: number
  done: number
  error: string | null
  cover: boolean
  text: boolean
}
export type Shelf = { configured: boolean; user: string; blocked: boolean; books: ShelfBook[] }
export type BookPage = { label: string; w: number; h: number }
export type Book = {
  id: number
  title: string
  publisher: string
  pages: BookPage[]
  toc: { title: string; page: number }[]
  state: BookState
  done: number
  error: string | null
  text: boolean
}
/** page: viewer page (1-based), label: printed page */
export type BookHit = { book: number; page: number; label: string; snippet: string; title: string }
/** [x, top, width, height, text] in the page's SVG coordinates */
export type TextRun = [number, number, number, number, string]

const enc = encodeURIComponent

export const booksApi = {
  shelf: (refresh = false) => request<Shelf>(`/api/books${refresh ? '?refresh=true' : ''}`),
  open: (id: number) => post<Book>(`/api/books/${id}/open`),
  book: (id: number) => request<Book>(`/api/books/${id}`),
  search: (q: string, book?: number) => request<BookHit[]>(`/api/books/search?q=${enc(q)}${book ? `&book=${book}` : ''}`),
  text: (id: number, n: number) => request<TextRun[]>(`/api/books/${id}/text/${n}`),
  remove: (id: number) => request<{ ok: boolean }>(`/api/books/${id}`, { method: 'DELETE' }),
  login: () => request<{ configured: boolean; user: string; blocked: boolean }>('/api/books/login'),
  saveLogin: (f: { user: string; password: string }) => post('/api/books/login', f),
}

export const pageUrl = (id: number, n: number) => `/api/books/${id}/pages/${n}.svg`
export const coverUrl = (id: number) => `/api/books/${id}/cover.jpg`

const loading = (s?: BookState) => s === 'loading' || s === 'text'

export const booksQ = {
  shelf: () =>
    queryOptions({
      queryKey: ['books'],
      queryFn: () => booksApi.shelf(),
      staleTime: 60_000,
      refetchInterval: (q) => (q.state.data?.books.some((b) => loading(b.state)) ? 3000 : false),
    }),
  /** Opening starts the download; while it runs the book is read again every 2 s. */
  book: (id: number) =>
    queryOptions({
      queryKey: ['book', id],
      queryFn: () => booksApi.open(id),
      staleTime: 30_000,
      refetchInterval: (q) => (loading(q.state.data?.state) ? 2000 : false),
    }),
  search: (q: string, book?: number) =>
    queryOptions({ queryKey: ['book-search', q, book ?? 0], queryFn: () => booksApi.search(q, book), staleTime: 60_000, enabled: q.trim().length >= 2 }),
  text: (id: number, n: number) => queryOptions({ queryKey: ['book-text', id, n], queryFn: () => booksApi.text(id, n), staleTime: Infinity }),
  login: () => queryOptions({ queryKey: ['books-login'], queryFn: booksApi.login }),
}

/** Words of a search, lowercased, for marking runs on a page. */
export const searchWords = (q: string) =>
  q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2)

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')

/** Where search words start in a run: [start, length] in characters (accents ignored, like the server). Each hit runs
 * to the end of the word it starts, so "kost" marks all of "Kostenrechnung". */
export function runMatches(text: string, words: string[]): [number, number][] {
  if (!words.length) return []
  const folded = fold(text)
  const out: [number, number][] = []
  for (const m of folded.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (words.some((w) => m[0].startsWith(fold(w)))) out.push([m.index, m[0].length])
  }
  return out
}

/** Rough width of a letter in a book font (em), so a word's place inside a run can be estimated. */
function charWidth(c: string) {
  if (c === ' ') return 0.27
  if ("ilj.,;:|!'´`".includes(c)) return 0.26
  if ('ftrI()-/[]'.includes(c)) return 0.34
  if (c === 'm' || c === 'w') return 0.8
  if (c === 'M' || c === 'W') return 0.92
  if (/\p{Lu}/u.test(c)) return 0.66
  if (/\d/.test(c)) return 0.55
  return 0.52
}

/** Start and width of characters [at, at + len) of a run that is `width` wide, by letter widths. */
export function spanOf(text: string, at: number, len: number, width: number): [number, number] {
  let before = 0
  let inside = 0
  let total = 0
  for (let i = 0; i < text.length; i++) {
    const w = charWidth(text[i])
    total += w
    if (i < at) before += w
    else if (i < at + len) inside += w
  }
  return total ? [(width * before) / total, (width * inside) / total] : [0, 0]
}

/** The snippet's [marked] words as React-friendly parts. */
export function snippetParts(s: string): { text: string; mark: boolean }[] {
  return s.split(/(\[[^\]]*\])/).filter(Boolean).map((p) => (p.startsWith('[') && p.endsWith(']') ? { text: p.slice(1, -1), mark: true } : { text: p, mark: false }))
}

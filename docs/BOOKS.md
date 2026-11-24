# Books

The Books tab is the digi4school.at shelf inside the hub: every school book of the account, read in the browser as one long scroll with the text selectable, plus full text search over all books and the `books_*` MCP tools. Planned and built 2026-11-24.

| Part | File |
|---|---|
| client: login, shelf, LTI hops, download, text placement, text index | `server/school/books.py` |
| routes, MCP tools | `server/school/books_api.py` |
| shelf, reader, contents, search | `web/src/routes/books.tsx` |
| types, calls, queries, word matching | `web/src/lib/books.ts` |
| digi4school card in Settings | `web/src/routes/settings.tsx` |
| tests (fake digi4school, no network) | `server/tests/test_books.py` |

## What the user sees

- **Shelf** (left column): *Books* with the reload button, a search box, then every book of the account (newest school year first, one row per book) with cover, title, publisher and the download progress.
- **Search** on the shelf: book titles, and from 2 letters the full text of every book opened once: hits per book with the printed page and a snippet; a hit opens the book on that page with the words marked.
- **Reader**: the whole book as one scroll (pages load when they come near), white pages on the dark background.
  - Header: title, the printed page in view (type a page, `U1` or `IV`, Enter jumps), *Contents*, *Search in book*, smaller / zoom percent (click: fit width) / larger.
  - Zoom: 100 % is the reader's width (at most 860 px). Pinch (touch and trackpad), Ctrl+wheel, Ctrl + / - / 0 and the buttons, 50 to 400 %. During a gesture the column is only scaled (smooth); at its end the zoom is set and the point under the pointer stays put.
  - The text lies invisible over each page: select, copy and the browser's Ctrl+F work; search words are marked yellow. Copy turns the selected lines back into running text (line ends joined, `Zei-` + `chen` joined).
  - *Contents* (from the book's own bookmarks) marks the chapter in view; *Search in book* lists every page with a hit.
  - The page where reading stopped is kept per book in the browser; on a wide screen the book read last opens by itself.
- **First open**: the book downloads into the hub. Text, contents and the first pages come first (seconds), then the rest (a thin bar under the header). A page not yet there shows grey and appears by itself.
- **Settings, digi4school card**: email and password. *Login rejected* in red when digi4school refused the stored login.

## How it talks to digi4school

No API, the same calls the website makes (confirmed in the browser on 2026-11-24 for the shelf and the files; login and LTI hops as in the open source downloaders digiDownload and digi4offline):

1. Login: `POST digi4school.at/br/xhr/login` with `email, password, indefinite=1`; the body is `OK` on success. Cookie `digi4s`. The `ad_session_id` cookie is dropped (open source clients do the same).
2. Shelf: `GET digi4school.at/br/xhr/v2/synch` -> JSON `{user, books[{id, code, title, publisher, ...}], ...}`. Status 260 = session ran out: one new login. The same book id appears once per school year (different codes): the first (newest) one counts.
3. Opening a book: `GET digi4school.at/ebook/<code>` answers an auto-submit LTI form; it is posted to `kat.digi4school.at/lti`, whose answer is posted to the viewer host (`a.digi4school.at`, E-Book+ titles also `a.hpthek.at`), which sets its cookie and redirects to the viewer `/ebook/<content id>/`. One cookie jar for all hosts.
4. Files under the viewer address (per volume: books in volumes show a link list `1/`, `2/` first, each volume is its own folder):
   - `<n>.svg` or `<n>/<n>.svg` per page (probed with page 1), images relative to it;
   - `assets/content.xml`: pdftohtml `-xml` output, the full text of every page with boxes. **The text source: no OCR.** Checked on 2026-11-24 on three books of his (one in volumes, one E-Book+ on hpthek);
   - `bookmarks/bookmarks.js` (`var bookmarks = [{title, page}]`), `thumbnails/1.jpg`, the index page with `meta pageLabels` (printed page names) or `meta firstPage`.
5. When a viewer file answers with a redirect off the viewer host (session gone, for example after the website opened the book elsewhere), the book is opened again once and the file fetched again.

Opening a book from the hub may end a viewer session of the same book in a browser (the website polls `check`, 451 = session taken over); reloading the website opens it again.

**Never retry a rejected login.** A body other than `OK` marks the login as blocked (hash in `digi4school-state.json`); every call fails with `books_not_connected` until the login is changed in Settings.

## Download

- `POST /api/books/{id}/open` starts it (once per book; a running one is not started twice). State in `/data/books/<id>/meta.json`.
- Order: viewer, volumes, `content.xml`, bookmarks, cover; then the first 12 pages of every volume; then the text index; then every other page, 4 at a time.
- Each page is stored with its images inlined as `data:` addresses, so it shows in a plain `<img>` (an SVG in an `<img>` loads nothing from outside, and runs no script). Old exports without `viewBox` get one from the page's `<n>.html`.
- A download stopped by a restart is picked up on the next open (pages already on disk are kept).
- Size: roughly the book's images plus a third. `DELETE /api/books/{id}` removes a book.

## Text on the page

`content.xml` (pdftohtml) and the page SVG differ in origin (media box vs crop box, often 25 to 40 px), sometimes in scale, and pdftohtml pages are often two book pages wide (the old "centre the media box" guess was 466 px off there). Placement (`fit_offset`, `place_page` in `books.py`):

1. Book offset per volume from the first 12 pages: glyph rows (`<use>` with a translate, the translate is the baseline) whose glyph count equals a run's letter count and whose extent fits the run's width vote for (run left - row x, run bottom - row baseline). Lines of a paragraph often have the same letter count, so the line above and below win votes too: the 6 strongest candidates of every scale (1, SVG width / content width, SVG height / content height) are placed for real and the one that puts most runs onto rows with their letter count wins; x is then settled so runs start at a glyph with nothing just before it.
2. Per page: pages of one book are cropped differently (in book 6671 by 13 px in x between chapters), so each page searches its own shift near the book's (y +-14, x +-14).
3. Per run (`snap_runs`): of the glyph rows within 0.75 run heights, the one with as many glyphs under the run as it has letters, then the nearest; a run without leading spaces starts at its first glyph. pdftohtml's top is the font's ascent above the baseline, which differs per font, so y is only right after this step.

Measured on three of his books (2026-11-24): 84 to 94 % of runs exactly on their glyph row and first letter (the rest: formulas, single letters, labels in figures), was 0 to 45 %. Without agreement the media box is centred. Stored runs are already in SVG coordinates. `PLACE` in `books.py` is the placement version: a book placed by an older one is downloaded again on its next open (pages already on disk are kept); the browser keeps old text runs until a reload.

The reader draws the runs as transparent SVG `<text>` with `textLength` over the page image (CSS `.book-text` in `index.css`).

## Search

SQLite FTS5 in `/data/books/books.db` (`page` table: runs and plain text per page; `page_fts`: the index, tokenizer `unicode61 remove_diacritics 2`, so `große` finds `Größe`; `ß` stays). Every word of a search is a prefix, all words must occur, `ß` and `ss` find each other, `and` / `or` / `not` are plain words. Snippets mark hits with `\x02` ... `\x03` (brackets occur in book text); the MCP shows them as `[...]`. A page's plain text is its runs in file order (pdftohtml writes reading order): runs on one line joined with a space unless they touch, soft hyphens dropped, a word split by a hyphen at the line end joined again.

## MCP tools

| Tool | What |
|---|---|
| `books_list` | without `book_id` the shelf (id, title, downloaded); with `book_id` its contents with printed pages (downloads the text first, waits up to 2 min) |
| `books_search` | `query`, optional `book_id`, `limit` (1 to 100, `more` when there are more hits): hits with book, printed page, snippet; lists books never opened (not searchable yet) |
| `books_read` | `book_id` and `pages` (printed: `12`, `12-15`, up to 60 pages, `capped` names the page to go on from) or `chapter` (`1.2` or part of a title, to the next chapter of the same level); paged with `offset` / `next_offset` |

Text only: figures, tables drawn as graphics and layout are not in it.

## Data

| File | What |
|---|---|
| `/data/digi4school.json` | `{email, password}` (0600) |
| `/data/digi4school-state.json` | `{blocked: hash}` after a rejected login |
| `/data/books/<id>/meta.json` | `{id, code, title, publisher, state, text, error, pages[] {label, w, h}, toc[]}` |
| `/data/books/<id>/p/<n>.svg`, `cover.jpg` | pages, cover |
| `/data/books/books.db` | text runs and full text index |

The books are his own licences, for his own use: book pages and text never go into commits, docs, memories or artifacts.

## Testing

`cd server && ../.venv/bin/python -m pytest tests/test_books.py`: a fake digi4school (`httpx.MockTransport` through `books._TRANSPORT`) with login, shelf, LTI hops, a three page book with an image, bookmarks and `content.xml`. Covers: one login, a rejected login never tried again, dedupe, labels, inlined images, text placement, search with umlauts and prefixes, a lost viewer session, the MCP tools.

For a dev copy against the real account: `D4S_EMAIL` / `D4S_PASSWORD` in the environment (only when no login file exists), uvicorn as in the README.

## Fallbacks (not built)

For a book without `content.xml`: the offline zip the app downloads (`dl.digi4school.at/download/<id>` after the LTI hops), or a glyph map learned once per book by OCR voting (prototype measured 99.8 % right glyphs on the demo books). Neither was needed for his books.

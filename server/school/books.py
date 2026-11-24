"""digi4school.at books (docs/BOOKS.md): login, shelf, opening a book, the download into DATA_DIR/books and the text index.

A book is opened like the website does it: GET digi4school.at/ebook/<code> answers an LTI form, the form goes to
kat.digi4school.at, the next one to the viewer host (a.digi4school.at, a.hpthek.at), which sets its cookie and redirects
to the viewer. Everything after that is plain files under the viewer address: <n>.svg (or <n>/<n>.svg) per page,
assets/content.xml (pdftohtml text of every page, our text source, no OCR), bookmarks/bookmarks.js (TOC),
thumbnails/<n>.jpg. Books in volumes have one such folder per volume (1/, 2/, ...).

A rejected password is stored as blocked and never tried again until the login is changed (like Moodle).
"""

import asyncio
import base64
import collections
import hashlib
import html
import json
import logging
import os
import re
import shutil
import sqlite3
import time
from html.parser import HTMLParser
from http import cookiejar
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx

from . import config

BASE = "https://digi4school.at"
SHELF_SECONDS = 300
PARALLEL = 4
FIRST_PAGES = 12  # pages per volume loaded before the text index (they place the text on the page)
MAX_IMAGE = 20 * 1024 * 1024  # the container has 512 MB; 4 pages at a time
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"

ROOT = config.DATA_DIR / "books"
_LOGIN = config.DATA_DIR / "digi4school.json"
_STATE = config.DATA_DIR / "digi4school-state.json"

log = logging.getLogger("school.books")


class BooksError(Exception):
    """code: not_connected, invalidlogin, network, not_found, open_failed, no_text."""

    def __init__(self, message: str, code: str = ""):
        super().__init__(message)
        self.code = code

    @property
    def not_connected(self) -> bool:
        return self.code in ("not_connected", "invalidlogin")


# ---- login ---------------------------------------------------------------------------

def load_login() -> dict | None:
    """{email, password}. Without a stored login the environment counts (D4S_EMAIL, D4S_PASSWORD: development)."""
    try:
        c = json.loads(_LOGIN.read_text())
    except (OSError, ValueError):
        c = {"email": os.environ.get("D4S_EMAIL", ""), "password": os.environ.get("D4S_PASSWORD", "")}
    return c if c.get("email") and c.get("password") else None


def _hash(c: dict) -> str:
    return hashlib.sha256(f"{c['email']}|{c['password']}".encode()).hexdigest()


def _blocked_key() -> str:
    try:
        return json.loads(_STATE.read_text()).get("blocked", "")
    except (OSError, ValueError):
        return ""


def _set_blocked(key: str) -> None:
    _STATE.touch(mode=0o600)
    _STATE.chmod(0o600)
    _STATE.write_text(json.dumps({"blocked": key} if key else {}))


def status() -> dict:
    login = load_login()
    return {
        "configured": bool(login),
        "user": login["email"] if login else "",
        "blocked": bool(login) and _blocked_key() == _hash(login),
    }


class _NoAdCookie(cookiejar.DefaultCookiePolicy):
    """digi4school sets an ad cookie that open source clients drop; we do the same."""

    def set_ok(self, cookie, request) -> bool:
        return cookie.name != "ad_session_id" and super().set_ok(cookie, request)


_TRANSPORT: httpx.AsyncBaseTransport | None = None  # tests: a fake digi4school


def _new_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=_TRANSPORT,
        cookies=cookiejar.CookieJar(policy=_NoAdCookie()),
        follow_redirects=True,
        timeout=httpx.Timeout(60, connect=15),
        headers={"User-Agent": UA, "Accept-Language": "de-AT,de;q=0.9"},
    )


_client: httpx.AsyncClient | None = None
_logged_in = False
_login_lock = asyncio.Lock()


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = _new_client()
    return _client


async def _post_login(c: httpx.AsyncClient, login: dict) -> None:
    try:
        r = await c.post(f"{BASE}/br/xhr/login", data={"email": login["email"], "password": login["password"], "indefinite": "1"})
    except httpx.HTTPError as e:
        raise BooksError(f"digi4school login failed: {e or type(e).__name__}", "network") from None
    if r.status_code != 200:
        raise BooksError(f"digi4school login failed: HTTP {r.status_code}", "network")
    if r.text.strip() != "OK":
        raise BooksError("digi4school rejects the login", "invalidlogin")


async def login(force: bool = False) -> None:
    """Logs the shared client in once. force: the session ran out (shelf answered 260), log in again."""
    global _logged_in
    creds = load_login()
    if not creds:
        raise BooksError("digi4school is not connected", "not_connected")
    async with _login_lock:
        if _blocked_key() == _hash(creds):
            raise BooksError("digi4school rejects the stored login", "invalidlogin")
        if _logged_in and not force:
            return
        try:
            await _post_login(client(), creds)
        except BooksError as e:
            if e.code == "invalidlogin":
                _set_blocked(_hash(creds))
            raise
        _logged_in = True


async def set_login(email: str, password: str) -> None:
    """Stores the login after one check at digi4school. An empty password keeps the stored one. Raises ValueError."""
    global _client, _logged_in
    old = load_login() or {}
    new = {"email": email.strip(), "password": password or old.get("password", "")}
    if not new["email"] or not new["password"]:
        raise ValueError("Email and password are needed")
    if _blocked_key() == _hash(new):
        raise ValueError("digi4school already rejected this login")
    c = _new_client()
    try:
        await _post_login(c, new)
    except BooksError as e:
        await c.aclose()
        raise ValueError("Wrong email or password" if e.code == "invalidlogin" else str(e)) from None
    _LOGIN.touch(mode=0o600)
    _LOGIN.chmod(0o600)
    _LOGIN.write_text(json.dumps(new))
    _set_blocked("")
    old_client, _client, _logged_in = _client, c, True
    _shelf_cache.clear()
    if old_client:
        await old_client.aclose()


# ---- shelf ---------------------------------------------------------------------------

_shelf_cache: dict[str, tuple[float, list]] = {}


async def _synch() -> dict:
    await login()
    for attempt in (0, 1):
        try:
            r = await client().get(f"{BASE}/br/xhr/v2/synch")
        except httpx.HTTPError as e:
            raise BooksError(f"digi4school: {e or type(e).__name__}", "network") from None
        if r.status_code == 200:
            try:
                return r.json()
            except ValueError:
                pass
        if attempt == 0:  # 260 or a login page: the session ran out
            await login(force=True)
    raise BooksError("digi4school does not answer the shelf", "network")


async def remote_shelf(refresh: bool = False) -> list[dict]:
    """The books of the account, newest school year first, one entry per book id."""
    hit = _shelf_cache.get("shelf")
    if hit and not refresh and time.time() - hit[0] < SHELF_SECONDS:
        return hit[1]
    data = await _synch()
    books, seen = [], set()
    for b in data.get("books") or []:
        bid = b.get("id")
        if not isinstance(bid, int) or bid in seen or not b.get("code"):
            continue
        seen.add(bid)
        books.append(
            {
                "id": bid,
                "code": str(b["code"]),
                "title": str(b.get("title") or "").strip(),
                "publisher": str(b.get("publisher") or "").strip(),
            }
        )
    _shelf_cache["shelf"] = (time.time(), books)
    return books


async def shelf(refresh: bool = False) -> list[dict]:
    """Remote shelf joined with the local state; without a login only the books already downloaded."""
    try:
        books = await remote_shelf(refresh)
    except BooksError as e:
        if not e.not_connected:
            raise
        books = []
    known = {b["id"] for b in books}
    for d in sorted(ROOT.glob("*/meta.json")) if ROOT.is_dir() else []:
        m = _read_json(d)
        if m and m.get("id") not in known:
            books.append({k: m.get(k) for k in ("id", "code", "title", "publisher")})
    return [{**b, **local_state(b["id"])} for b in books]


# ---- local files -----------------------------------------------------------------------

def book_dir(book_id: int) -> Path:
    return ROOT / str(int(book_id))


def _read_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def _write_json(path: Path, value) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False))
    tmp.replace(path)


def meta(book_id: int) -> dict | None:
    return _read_json(book_dir(book_id) / "meta.json")


def page_file(book_id: int, n: int) -> Path:
    return book_dir(book_id) / "p" / f"{int(n)}.svg"


def cover_file(book_id: int) -> Path:
    return book_dir(book_id) / "cover.jpg"


def local_state(book_id: int) -> dict:
    """state: none (never opened), loading (download running, no text yet), text (text and first pages there, rest
    loading), ready, error. done/pages: download progress."""
    m = meta(book_id) or {}
    state = m.get("state", "none")
    pages = len(m.get("pages") or [])
    out = {"state": state, "pages": pages, "done": pages if state == "ready" else 0, "error": m.get("error"),
           "cover": cover_file(book_id).is_file(), "text": bool(m.get("text"))}
    job = _progress.get(book_id)
    if job:
        out.update(done=job[0], pages=job[1] or pages)
    elif state in ("loading", "text"):  # a download stopped by a restart
        out["state"] = "error" if state == "loading" else "partial"
    return out


# ---- viewer pages: LTI forms, volumes, labels ---------------------------------------------

class _Forms(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.forms: list[dict] = []
        self.links: list[str] = []
        self.metas: dict[str, str] = {}

    def handle_starttag(self, tag, attrs):
        a = {k: (v or "") for k, v in attrs}
        if tag == "form":
            self.forms.append({"action": a.get("action", ""), "method": (a.get("method") or "post").upper(), "data": {}})
        elif tag == "input" and self.forms and a.get("name"):
            self.forms[-1]["data"][a["name"]] = a.get("value", "")
        elif tag == "a" and a.get("href"):
            self.links.append(a["href"])
        elif tag == "meta" and a.get("name"):
            self.metas[a["name"]] = a.get("content", "")


def parse_html(text: str) -> _Forms:
    p = _Forms()
    try:
        p.feed(text)
    except Exception:  # broken markup: keep what was read
        pass
    return p


async def open_book(code: str) -> tuple[str, str]:
    """Runs the LTI hops; returns (viewer address ending in /, its html). Logs in again once if digi4school wants it."""
    for attempt in (0, 1):
        await login(force=attempt == 1)
        try:
            r = await client().get(f"{BASE}/ebook/{code}")
            for _ in range(4):
                forms = parse_html(r.text).forms
                if not forms or not forms[0]["action"]:
                    break
                f = forms[0]
                r = await client().request(f["method"], urljoin(str(r.url), f["action"]), data=f["data"])
        except httpx.HTTPError as e:
            raise BooksError(f"digi4school: {e or type(e).__name__}", "network") from None
        url = r.url
        if r.status_code == 200 and url.host != "digi4school.at" and "/ebook/" in url.path:
            path = url.path if url.path.endswith("/") else url.path.rsplit("/", 1)[0] + "/"
            return f"{url.scheme}://{url.host}{path}", r.text
    raise BooksError("digi4school did not open the book", "open_failed")


_VOLUME = re.compile(r"^(?:\./)?([0-9]+)/(?:index\.html)?$")


def volumes(index_html: str) -> list[str]:
    """A book in volumes shows a list of links (1/, 2/, ...) instead of the viewer."""
    if "IDRViewer" in index_html or 'name="pageLabels"' in index_html:
        return []
    out = []
    for href in parse_html(index_html).links:
        m = _VOLUME.match(href.strip())
        if m and m.group(1) + "/" not in out:
            out.append(m.group(1) + "/")
    return out


def page_count(index_html: str, metas: dict, content_pages: int) -> int:
    labels = [x for x in (metas.get("pageLabels") or "").split(",") if x != ""]
    m = re.search(r"IDRViewer\.makeNavBar\((\d+)", index_html)
    meta_count = int(metas["pageCount"]) if metas.get("pageCount", "").isdigit() else 0
    return max(len(labels), int(m.group(1)) if m else 0, meta_count, content_pages)


def labels(metas: dict, count: int) -> list[str]:
    """Printed page names: pageLabels when there, else from firstPage (before it: U1, U2, ...), else the viewer number."""
    given = [x.strip() for x in (metas.get("pageLabels") or "").split(",")]
    if len([x for x in given if x]) >= count:
        return given[:count]
    first = int(metas["firstPage"]) if metas.get("firstPage", "").lstrip("-").isdigit() else 1
    return [str(n - first + 1) if n >= first else f"U{n}" for n in range(1, count + 1)]


def parse_bookmarks(js: str) -> list[dict]:
    m = re.search(r"=\s*(\[.*\])\s*;?\s*$", js.strip(), re.S)
    if not m:
        return []
    try:
        items = json.loads(m.group(1))
    except ValueError:
        return []
    return [{"title": str(i.get("title", "")).strip(), "page": int(i["page"])} for i in items if isinstance(i, dict) and str(i.get("page", "")).isdigit()]


# ---- content.xml (text) and placing it on the SVG --------------------------------------------

_PAGE = re.compile(r'<page number="(\d+)"[^>]*?height="([\d.]+)" width="([\d.]+)">(.*?)</page>', re.S)
_TEXT = re.compile(r'<text top="(-?[\d.]+)" left="(-?[\d.]+)" width="(-?[\d.]+)" height="(-?[\d.]+)"[^>]*>(.*?)</text>', re.S)


def parse_content(raw: str) -> dict[int, dict]:
    """{page: {w, h, runs: [[left, top, width, height, text]]}}. Regex, not an XML parser: the file is often not well-formed."""
    pages = {}
    for m in _PAGE.finditer(raw):
        runs = []
        for t, l, w, h, body in _TEXT.findall(m.group(4)):
            text = html.unescape(re.sub(r"<[^>]+>", "", body))
            if text.strip():
                runs.append([float(l), float(t), float(w), float(h), text])
        pages[int(m.group(1))] = {"w": float(m.group(3)), "h": float(m.group(2)), "runs": runs}
    return pages


_USE = re.compile(r'<use\s+xlink:href\s*=\s*"#[^"]+"\s+transform="matrix\(([^)]+)\)"')
_VIEWBOX = re.compile(r'viewBox="\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)\s*"')


def glyph_points(svg: str) -> list[tuple[float, float]]:
    out = []
    for m in _USE.findall(svg):
        try:
            a, b, c, d, e, f = (float(x) for x in m.split(","))
        except ValueError:
            continue
        if abs(b) < 1e-6 and abs(c) < 1e-6 and a > 0:
            out.append((e, f))
    return out


def fit_offset(pages: list[tuple[list[tuple[float, float]], list]]) -> tuple[float, float] | None:
    """content.xml (PDF media box) and the page SVG (crop box) share the scale, not the origin. Over several pages, rows
    of glyphs whose count equals a text run's letter count vote for (run left - row x, run bottom - row baseline).
    x is clear; y is a few px off at worst (run bottoms include descenders). None when the votes do not agree."""
    votes = collections.Counter()
    for points, runs in pages:
        rows = collections.defaultdict(list)
        for x, y in points:
            rows[round(y)].append(x)
        by_count = collections.defaultdict(list)
        for y, xs in rows.items():
            by_count[len(xs)].append((min(xs), y))
        for l, t, w, h, text in runs:
            n = len(re.sub(r"\s", "", text))
            if n >= 6:
                for x, y in by_count.get(n, []):
                    votes[(round(l - x), round(t + h - y))] += 1
    xs = collections.Counter()
    for (x, _), k in votes.items():
        xs[x] += k
    if not xs:
        return None
    ox, k = xs.most_common(1)[0]
    if k < 8 or k < 0.25 * sum(xs.values()):
        return None
    ys = collections.Counter()
    for (x, y), k in votes.items():
        if abs(x - ox) <= 1:
            for d in (-1, 0, 1):  # smooth: neighbours count half
                ys[y + d] += k if d else 2 * k
    return float(ox), float(ys.most_common(1)[0][0])


def page_text(runs: list) -> str:
    """Runs in file order (pdftohtml writes reading order); runs on the same line joined with a space."""
    lines, last = [], None
    for x, y, w, h, t in runs:
        if last is not None and abs(y - last[0]) < max(2.0, h * 0.5) and x >= last[1] - 2:
            lines[-1] += ("" if lines[-1].endswith((" ", "-")) or t.startswith(" ") else " ") + t
        else:
            lines.append(t)
        last = (y, x + w)
    return "\n".join(s.rstrip() for s in lines)


# ---- text index (sqlite FTS5) ---------------------------------------------------------------

_db: sqlite3.Connection | None = None


def db() -> sqlite3.Connection:
    global _db
    if _db is None:
        ROOT.mkdir(parents=True, exist_ok=True)
        _db = sqlite3.connect(ROOT / "books.db", check_same_thread=False)
        _db.executescript(
            """
            CREATE TABLE IF NOT EXISTS page (book INTEGER, n INTEGER, label TEXT, runs TEXT, text TEXT, PRIMARY KEY (book, n));
            CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(text, book UNINDEXED, n UNINDEXED, tokenize='unicode61 remove_diacritics 2');
            """
        )
    return _db


def store_text(book_id: int, pages: list[tuple[int, str, list]]) -> None:
    """pages: (n, label, runs in SVG coordinates)."""
    c = db()
    with c:
        c.execute("DELETE FROM page WHERE book=?", (book_id,))
        c.execute("DELETE FROM page_fts WHERE book=?", (book_id,))
        for n, label, runs in pages:
            text = page_text(runs)
            c.execute("INSERT INTO page VALUES (?,?,?,?,?)", (book_id, n, label, json.dumps(runs, ensure_ascii=False), text))
            if text.strip():
                c.execute("INSERT INTO page_fts (text, book, n) VALUES (?,?,?)", (text, book_id, n))


def runs(book_id: int, n: int) -> list:
    row = db().execute("SELECT runs FROM page WHERE book=? AND n=?", (book_id, n)).fetchone()
    return json.loads(row[0]) if row else []


def texts(book_id: int, first: int, last: int) -> list[tuple[int, str, str]]:
    return db().execute("SELECT n, label, text FROM page WHERE book=? AND n BETWEEN ? AND ? ORDER BY n", (book_id, first, last)).fetchall()


def fts_query(q: str) -> str:
    words = re.findall(r"\w+", q)
    return " ".join(f'"{w}"*' for w in words[:12])


def search(q: str, book_id: int | None = None, limit: int = 50) -> list[dict]:
    query = fts_query(q)
    if not query:
        return []
    sql = (
        "SELECT f.book, f.n, p.label, snippet(page_fts, 0, '[', ']', '…', 14) FROM page_fts f "
        "JOIN page p ON p.book = f.book AND p.n = f.n WHERE page_fts MATCH ?"
    )
    args: list = [query]
    if book_id:
        sql += " AND f.book = ?"
        args.append(int(book_id))
    sql += " ORDER BY bm25(page_fts) LIMIT ?" if not book_id else " ORDER BY f.n LIMIT ?"
    args.append(limit)
    try:
        rows = db().execute(sql, args).fetchall()
    except sqlite3.OperationalError:
        return []
    return [{"book": b, "page": n, "label": label, "snippet": re.sub(r"\s+", " ", s)} for b, n, label, s in rows]


# ---- download ----------------------------------------------------------------------------

_jobs: dict[int, asyncio.Task] = {}
_progress: dict[int, list[int]] = {}  # book -> [pages done, pages]


def ensure(book: dict) -> None:
    """Starts the download of a book unless it is there or running. book: a shelf entry."""
    bid = book["id"]
    m = meta(bid)
    if m and m.get("state") == "ready":
        return
    if bid in _jobs and not _jobs[bid].done():
        return
    _jobs[bid] = asyncio.create_task(_download(book))


async def wait_text(book: dict, timeout: float = 120) -> dict:
    """For the MCP: starts the download if needed and waits until the text is indexed."""
    ensure(book)
    end = time.time() + timeout
    while time.time() < end:
        m = meta(book["id"])
        if m and m.get("text"):
            return m
        job = _jobs.get(book["id"])
        if job and job.done():
            m = meta(book["id"]) or {}
            raise BooksError(m.get("error") or "The download failed", "open_failed")
        await asyncio.sleep(1)
    raise BooksError("The book is still loading, try again in a minute", "loading")


class _Viewer:
    """The open book: re-runs the LTI hops when the viewer host no longer accepts our cookie."""

    def __init__(self, code: str):
        self.code = code
        self.base = ""
        self.index = ""
        self.lock = asyncio.Lock()
        self.opened = 0.0

    async def open(self, if_older: float = 0) -> None:
        async with self.lock:
            if self.opened and self.opened > if_older:
                return
            self.base, self.index = await open_book(self.code)
            self.opened = time.time()

    async def get(self, path: str) -> httpx.Response | None:
        """GET <viewer>/<path>; None when it is not there (404). Retries once after opening the book again."""
        for attempt in (0, 1):
            started = self.opened
            try:
                r = await client().get(self.base + path)
            except httpx.HTTPError as e:
                if attempt:
                    raise BooksError(f"digi4school: {e or type(e).__name__}", "network") from None
                await asyncio.sleep(2)
                continue
            moved = urlsplit(str(r.url)).netloc != urlsplit(self.base).netloc
            if r.status_code == 404 and not moved:
                return None
            if r.status_code == 200 and not moved:
                return r
            if attempt == 0:
                await self.open(if_older=started)
        raise BooksError(f"digi4school refused {path} (HTTP {r.status_code})", "network")


def _size_from_html(page_html: str) -> tuple[float, float] | None:
    m = re.search(r"width:\s*([\d.]+)px;\s*height:\s*([\d.]+)px", page_html)
    return (float(m.group(1)), float(m.group(2))) if m else None


_IMAGE = re.compile(r'(<image\b[^>]*?\b(?:xlink:)?href\s*=\s*")([^"]+)(")', re.S)
_SVG_TAG = re.compile(r"<svg\b[^>]*>", re.S)


async def _inline_images(v: _Viewer, svg: str, svg_path: str) -> str:
    """Images become data: addresses so the page shows in an <img> (an SVG there loads nothing from outside)."""
    out, last = [], 0
    for m in _IMAGE.finditer(svg):
        href = html.unescape(m.group(2))
        if href.startswith("data:"):
            continue
        rel = urljoin(svg_path, href)
        r = await v.get(rel)
        out.append(svg[last : m.start()])
        if r is not None and len(r.content) <= MAX_IMAGE:
            mime = (r.headers.get("content-type") or "image/png").split(";")[0]
            out.append(m.group(1) + f"data:{mime};base64," + base64.b64encode(r.content).decode() + m.group(3))
        else:
            out.append(m.group(1) + m.group(3))
        last = m.end()
    out.append(svg[last:])
    return "".join(out)


def _with_size(svg: str, size: tuple[float, float]) -> str:
    """Old exports have no viewBox: give the page its size so the browser scales it."""
    tag = _SVG_TAG.search(svg)
    if not tag or "viewBox" in tag.group(0):
        return svg
    w, h = size
    new = tag.group(0)[:-1].rstrip("/") + f' viewBox="0 0 {w:g} {h:g}" width="{w:g}" height="{h:g}">'
    return svg[: tag.start()] + new + svg[tag.end() :]


async def _page(v: _Viewer, layout: str, n: int, fallback: tuple[float, float]) -> tuple[str, tuple[float, float]] | None:
    """Raw SVG of viewer page n and its size."""
    path = f"{n}.svg" if layout == "flat" else f"{n}/{n}.svg"
    r = await v.get(path)
    if r is None:
        return None
    svg = r.text
    m = _VIEWBOX.search(_SVG_TAG.search(svg).group(0) if _SVG_TAG.search(svg) else "")
    if m:
        size = (float(m.group(1)), float(m.group(2)))
    else:
        h = await v.get(f"{n}.html" if layout == "flat" else f"{n}/{n}.html")
        size = (_size_from_html(h.text) if h is not None else None) or fallback
    return svg, size


async def _download(book: dict) -> None:
    bid = book["id"]
    folder = book_dir(bid)
    (folder / "p").mkdir(parents=True, exist_ok=True)
    old = meta(bid) or {}
    m = {
        "id": bid,
        "code": book["code"],
        "title": book.get("title", ""),
        "publisher": book.get("publisher", ""),
        "state": "loading",
        "text": bool(old.get("text")),
        "error": None,
        "pages": old.get("pages") or [],
        "toc": old.get("toc") or [],
    }
    _write_json(folder / "meta.json", m)
    _progress[bid] = [0, len(m["pages"])]
    try:
        v = _Viewer(book["code"])
        await v.open()
        root_base, root_index = v.base, v.index
        parts = volumes(root_index) or [""]
        plan = []  # (volume, viewer, layout, count, labels, content pages)
        toc = []
        for part in parts:
            pv = v
            if part:
                pv = _Viewer(book["code"])
                pv.base, pv.opened, pv.lock = root_base + part, v.opened, v.lock
                r = await pv.get("")
                pv.index = r.text if r is not None else ""
            metas = parse_html(pv.index).metas
            cx = await pv.get("assets/content.xml")
            content = parse_content(cx.text) if cx is not None else {}
            count = page_count(pv.index, metas, max(content) if content else 0)
            layout = "flat" if await pv.get("1.svg") is not None else "nested"
            first = sum(p[3] for p in plan)
            bm = await pv.get("bookmarks/bookmarks.js")
            for item in parse_bookmarks(bm.text) if bm is not None else []:
                if 1 <= item["page"] <= count:
                    toc.append({"title": item["title"], "page": first + item["page"]})
            plan.append((part, pv, layout, count, labels(metas, count), content))
            if not cover_file(bid).is_file():
                th = await pv.get("thumbnails/1.jpg")
                if th is not None:
                    cover_file(bid).write_bytes(th.content)
        total = sum(p[3] for p in plan)
        if not total:
            raise BooksError("The book has no pages", "open_failed")
        _progress[bid] = [0, total]

        pages: list[dict] = []
        for part, pv, layout, count, labs, content in plan:
            for i in range(1, count + 1):
                pages.append({"label": labs[i - 1] if i - 1 < len(labs) else str(i), "part": part, "i": i, "w": 0, "h": 0})

        sem = asyncio.Semaphore(PARALLEL)
        raws: dict[int, str] = {}
        default = (0.0, 0.0)

        async def fetch(n: int, keep_raw: bool) -> None:
            p = pages[n - 1]
            part_plan = next(x for x in plan if x[0] == p["part"])
            pv, layout, content = part_plan[1], part_plan[2], part_plan[5]
            target = page_file(bid, n)
            async with sem:
                if target.is_file() and p["w"] and not keep_raw:
                    _progress[bid][0] += 1
                    return
                cpage = content.get(p["i"])
                fallback = default if default[0] else ((cpage["w"], cpage["h"]) if cpage else (900.0, 1270.0))
                got = await _page(pv, layout, p["i"], fallback)
                if got is None:
                    _progress[bid][0] += 1
                    return
                svg, size = got
                p["w"], p["h"] = size
                if keep_raw:
                    raws[n] = svg
                svg = _with_size(await _inline_images(pv, svg, f"{p['i']}.svg" if layout == "flat" else f"{p['i']}/{p['i']}.svg"), size)
                tmp = target.with_suffix(".tmp")
                tmp.write_text(svg)
                tmp.replace(target)
                _progress[bid][0] += 1

        # 1. the first pages of every volume (they place the text), then the text index
        first_pages, start = [], 1
        for part, pv, layout, count, labs, content in plan:
            first_pages += range(start, start + min(FIRST_PAGES, count))
            start += count
        # sizes of pages already on disk from an earlier run
        for n, p in enumerate(old.get("pages") or [], 1):
            if n <= len(pages) and p.get("w"):
                pages[n - 1]["w"], pages[n - 1]["h"] = p["w"], p["h"]
        await asyncio.gather(*(fetch(n, True) for n in first_pages))
        sized = next((p for p in pages if p["w"]), None)
        if sized:
            default = (sized["w"], sized["h"])
        text_pages = []
        start = 1
        for part, pv, layout, count, labs, content in plan:
            sample = [
                (glyph_points(raws[n]), content[n - start + 1]["runs"])
                for n in range(start, start + min(FIRST_PAGES, count))
                if n in raws and (n - start + 1) in content
            ]
            off = fit_offset(sample)
            if off:
                ox, oy = off
            else:  # no agreement: centre the media box on the page
                cp = next(iter(content.values()), None)
                ox = (cp["w"] - default[0]) / 2 if cp and default[0] else 0.0
                oy = (cp["h"] - default[1]) / 2 if cp and default[1] else 0.0
            for i in range(1, count + 1):
                cp = content.get(i)
                placed = [[round(x - ox, 1), round(y - oy, 1), w, h, t] for x, y, w, h, t in (cp["runs"] if cp else [])]
                text_pages.append((start + i - 1, pages[start + i - 2]["label"], placed))
            start += count
        raws.clear()
        has_text = any(r for _, _, r in text_pages)
        await asyncio.to_thread(store_text, bid, text_pages)
        m.update(pages=[{"label": p["label"], "w": p["w"] or default[0], "h": p["h"] or default[1]} for p in pages], toc=toc, text=has_text, state="text")
        _write_json(folder / "meta.json", m)

        # 2. every other page
        rest = [n for n in range(1, len(pages) + 1) if n not in set(first_pages)]
        await asyncio.gather(*(fetch(n, False) for n in rest))
        missing = [n for n in range(1, len(pages) + 1) if not page_file(bid, n).is_file()]
        m.update(pages=[{"label": p["label"], "w": p["w"] or default[0], "h": p["h"] or default[1]} for p in pages], state="ready" if not missing else "error")
        if missing:
            m["error"] = f"{len(missing)} pages missing"
        _write_json(folder / "meta.json", m)
    except BooksError as e:
        log.warning("book %s: %s", bid, e)
        m.update(state="error", error=str(e))
        _write_json(folder / "meta.json", m)
    except Exception as e:  # keep the state readable whatever broke
        log.exception("book %s download failed", bid)
        m.update(state="error", error=f"{type(e).__name__}: {e}"[:300])
        _write_json(folder / "meta.json", m)
    finally:
        _progress.pop(bid, None)


def remove(book_id: int) -> None:
    """Drops a downloaded book (files and text)."""
    if book_id in _jobs and not _jobs[book_id].done():
        _jobs[book_id].cancel()
    shutil.rmtree(book_dir(book_id), ignore_errors=True)
    c = db()
    with c:
        c.execute("DELETE FROM page WHERE book=?", (book_id,))
        c.execute("DELETE FROM page_fts WHERE book=?", (book_id,))

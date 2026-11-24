"""Books (digi4school): website routes under /api/books and the MCP tools books_list, books_search, books_read."""

import json
import re

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import FileResponse

from . import auth
from . import books as bk

router = APIRouter(prefix="/api/books", dependencies=[Depends(auth.require)])

# Page SVGs come from digi4school: never let one run script on our origin when opened directly.
_SVG_HEADERS = {
    "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
}


def _bad(message: str, code: str = "bad_request") -> HTTPException:
    return HTTPException(400, {"error": code, "detail": message})


async def _book(book_id: int) -> dict:
    for b in await bk.shelf():
        if b["id"] == book_id:
            return b
    raise HTTPException(404, {"error": "not_found", "detail": "No such book on the shelf"})


def _shape(m: dict, state: dict) -> dict:
    return {
        "id": m["id"],
        "title": m.get("title", ""),
        "publisher": m.get("publisher", ""),
        "pages": [{"label": p["label"], "w": p["w"], "h": p["h"]} for p in m.get("pages") or []],
        "toc": m.get("toc") or [],
        **{k: state[k] for k in ("state", "done", "error", "text")},
    }


@router.get("")
async def shelf(refresh: bool = False):
    return {**bk.status(), "books": await bk.shelf(refresh)}


@router.get("/login")
async def login():
    return bk.status()


@router.post("/login")
async def set_login(payload: dict = Body(...)):
    try:
        await bk.set_login(str(payload.get("user") or ""), str(payload.get("password") or ""))
    except ValueError as e:
        raise _bad(str(e), "books_login") from None
    return {"ok": True}


@router.get("/search")
async def search(q: str, book: int = 0):
    hits = bk.search(q, book or None, limit=200 if book else 60)
    titles = {b["id"]: b["title"] for b in await bk.shelf()} if not book else {}
    return [{**h, "title": titles.get(h["book"], "")} for h in hits]


@router.post("/{book_id}/open")
async def open_book(book_id: int):
    """Starts the download unless the book is there; answers the book as far as it is known."""
    b = await _book(book_id)
    bk.ensure(b)
    m = bk.meta(book_id) or {"id": book_id, "title": b["title"], "publisher": b["publisher"]}
    return _shape(m, bk.local_state(book_id))


@router.get("/{book_id}")
async def book(book_id: int):
    m = bk.meta(book_id)
    if not m:
        raise HTTPException(404, {"error": "not_found", "detail": "Book not downloaded"})
    return _shape(m, bk.local_state(book_id))


@router.delete("/{book_id}")
async def remove(book_id: int):
    bk.remove(book_id)
    return {"ok": True}


@router.get("/{book_id}/pages/{n}.svg")
async def page(book_id: int, n: int):
    f = bk.page_file(book_id, n)
    if not f.is_file():
        raise HTTPException(404, {"error": "not_found", "detail": "Page not downloaded yet"})
    return FileResponse(f, media_type="image/svg+xml", headers=_SVG_HEADERS)


@router.get("/{book_id}/text/{n}")
async def text(book_id: int, n: int):
    """Text runs of a page in SVG coordinates: [x, top, width, height, text]."""
    return bk.runs(book_id, n)


@router.get("/{book_id}/cover.jpg")
async def cover(book_id: int):
    f = bk.cover_file(book_id)
    if not f.is_file():
        raise HTTPException(404, {"error": "not_found", "detail": "No cover"})
    return FileResponse(f, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


# ---- MCP tools -------------------------------------------------------------------------------

def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False, indent=1)


async def _find(book_id: int) -> dict:
    for b in await bk.shelf():
        if b["id"] == book_id:
            return b
    raise bk.BooksError(f"No book {book_id} on the shelf (books_list shows the ids)", "not_found")


async def list_tool(book_id: int = 0) -> str:
    if book_id:
        b = await _find(book_id)
        m = await bk.wait_text(b)
        labels = [p["label"] for p in m["pages"]]
        return _json(
            {
                "id": b["id"],
                "title": b["title"],
                "pages": len(labels),
                "printed_pages": f"{labels[0]} … {labels[-1]}" if labels else "",
                "has_text": m.get("text", False),
                "toc": [{"title": t["title"], "page": labels[t["page"] - 1]} for t in m.get("toc") or [] if t["page"] <= len(labels)],
            }
        )
    return _json(
        [
            {"id": b["id"], "title": b["title"], "publisher": b["publisher"], "downloaded": b["state"] in ("ready", "text", "partial"), "pages": b["pages"] or None}
            for b in await bk.shelf()
        ]
    )


async def search_tool(query: str, book_id: int = 0, limit: int = 20) -> str:
    if book_id:
        await bk.wait_text(await _find(book_id))
    limit = max(1, min(int(limit or 20), 100))
    hits = bk.search(query, book_id or None, limit=limit)
    shelf = await bk.shelf()
    titles = {b["id"]: b["title"] for b in shelf}
    out = {"hits": [{"book_id": h["book"], "book": titles.get(h["book"], ""), "page": h["label"], "text": h["snippet"]} for h in hits]}
    if not book_id:
        missing = [b["title"] for b in shelf if not b["text"]]
        if missing:
            out["not_searched"] = f"{len(missing)} books never opened (no text yet); give book_id to load one: " + "; ".join(missing[:12])
    return _json(out)


def _index(labels: list[str], label: str) -> int:
    label = label.strip()
    if label in labels:
        return labels.index(label) + 1
    low = [x.lower() for x in labels]
    if label.lower() in low:
        return low.index(label.lower()) + 1
    raise bk.BooksError(f"No printed page {label!r} (pages run {labels[0]} … {labels[-1]})", "not_found")


def _level(title: str) -> int:
    m = re.match(r"^\s*(\d+(?:\.\d+)*)", title)
    return m.group(1).count(".") if m else 0


async def read_tool(book_id: int, pages: str = "", chapter: str = "", offset: int = 0, max_chars: int = 30000) -> str:
    m = await bk.wait_text(await _find(book_id))
    labels = [p["label"] for p in m["pages"]]
    if not m.get("text"):
        raise bk.BooksError("This book has no text layer", "no_text")
    if chapter:
        toc = m.get("toc") or []
        hit = next((i for i, t in enumerate(toc) if t["title"].lower().startswith(chapter.lower())), None)
        if hit is None:
            hit = next((i for i, t in enumerate(toc) if chapter.lower() in t["title"].lower()), None)
        if hit is None:
            raise bk.BooksError(f"No chapter {chapter!r} in the table of contents (books_list with book_id shows it)", "not_found")
        first, lvl = toc[hit]["page"], _level(toc[hit]["title"])
        nxt = next((t["page"] for t in toc[hit + 1 :] if _level(t["title"]) <= lvl and t["page"] > first), len(labels) + 1)
        last = max(first, nxt - 1)
    elif pages:
        a, _, b = pages.partition("-")
        first = _index(labels, a)
        last = _index(labels, b) if b.strip() else first
        if last < first:
            first, last = last, first
    else:
        raise bk.BooksError("Give pages (printed, like 12 or 12-15) or chapter", "bad_request")
    last = min(last, first + 60)
    body = "\n\n".join(f"--- page {label} ---\n{text}" for n, label, text in bk.texts(book_id, first, last))
    max_chars = max(1000, min(int(max_chars or 30000), 100000))
    chunk = body[offset : offset + max_chars]
    out = {"book": m.get("title", ""), "pages": f"{labels[first - 1]}-{labels[last - 1]}", "text": chunk}
    if offset + max_chars < len(body):
        out["next_offset"] = offset + max_chars
    return _json(out)


_INT = {"type": "integer"}
_STR = {"type": "string"}
TOOLS = {
    "books_list": (
        list_tool,
        "School books (digi4school): without book_id every book on the shelf with id and whether it is downloaded; with book_id "
        "that book's table of contents with printed page numbers (loads the book first if needed, up to two minutes).",
        {"book_id": _INT},
        [],
    ),
    "books_search": (
        search_tool,
        "School books: full text search (word prefixes, umlauts optional). Hits with book, printed page and a snippet, [marked]. "
        "Without book_id it searches every downloaded book; with book_id that book (loaded first if needed).",
        {"query": _STR, "book_id": _INT, "limit": _INT},
        ["query"],
    ),
    "books_read": (
        read_tool,
        "School books: text of printed pages (pages '12' or '12-15', as printed in the book, up to 60 pages) or of a chapter "
        "from the table of contents (chapter '1.2' or a title). Long text is paged with offset (next_offset of the call before). "
        "Text only: figures and layout are not in it.",
        {"book_id": _INT, "pages": _STR, "chapter": _STR, "offset": _INT, "max_chars": _INT},
        ["book_id"],
    ),
}
WRITES: set[str] = set()

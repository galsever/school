"""Moodle: website routes under /api/moodle and the MCP tools (moodle_deadlines, moodle_courses, ...)."""

import base64
import hashlib
import hmac
import io
import json
import re
import secrets
import time
import zipfile
from contextvars import ContextVar
from datetime import datetime
from pathlib import Path
from urllib.parse import quote
from xml.etree import ElementTree

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from . import auth, config
from . import moodle as md

router = APIRouter(prefix="/api/moodle", dependencies=[Depends(auth.require)])
# Routes without the app login: only the signed upload and download links the MCP tools hand out.
public = APIRouter()

MAX_UPLOAD = 100 * 1024 * 1024
UPLOAD_SECONDS = 60 * 60
LINK_SECONDS = 15 * 60
_UPLOADS = config.DATA_DIR / "moodle-uploads"
_ID = re.compile(r"^[A-Za-z0-9_-]{16,40}$")


def _bad(message: str, code: str = "bad_request") -> HTTPException:
    return HTTPException(400, {"error": code, "detail": message})


# ---- uploads waiting for a submission (website drop zone and MCP upload link) ----------------

def _clean_name(name: str) -> str:
    return name.strip().replace("/", "_").replace("\\", "_")[:200]


def _purge() -> None:
    if _UPLOADS.is_dir():
        for p in _UPLOADS.iterdir():
            if time.time() - p.stat().st_mtime > UPLOAD_SECONDS:
                p.unlink(missing_ok=True)


def new_upload(name: str) -> str:
    """Reserves an upload: the name is kept, the bytes follow with store_upload."""
    name = _clean_name(name)
    if not name:
        raise ValueError("a file name is needed")
    _UPLOADS.mkdir(mode=0o700, exist_ok=True)
    _purge()
    uid = secrets.token_urlsafe(18)
    (_UPLOADS / f"{uid}.name").write_text(name)
    return uid


async def store_upload(uid: str, request: Request) -> int:
    if not _ID.match(uid) or not (_UPLOADS / f"{uid}.name").is_file():
        raise HTTPException(404, {"error": "not_found", "detail": "Unknown or expired upload"})
    if int(request.headers.get("content-length") or 0) > MAX_UPLOAD:
        raise _bad(f"Larger than {MAX_UPLOAD >> 20} MB", "bad_file")
    size, path = 0, _UPLOADS / f"{uid}.data"
    with path.open("wb") as f:
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_UPLOAD:
                f.close()
                path.unlink(missing_ok=True)
                raise _bad(f"Larger than {MAX_UPLOAD >> 20} MB", "bad_file")
            f.write(chunk)
    if not size:
        path.unlink(missing_ok=True)
        raise _bad("Empty file", "bad_file")
    return size


def _take(ids: list) -> list[tuple[str, Path]]:
    """(name, path) of finished uploads. Raises ValueError for an unknown one."""
    out = []
    for uid in ids:
        uid = str(uid)
        name, data = _UPLOADS / f"{uid}.name", _UPLOADS / f"{uid}.data"
        if not _ID.match(uid) or not name.is_file() or not data.is_file():
            raise ValueError(f"upload {uid} is unknown, expired or has no file yet")
        out.append((name.read_text(), data))
    return out


async def _save(a: dict, upload_ids: list, remove: set[str] | None, replace_files: bool, text: str | None) -> None:
    taken = _take(upload_ids)
    limit = int(md._config(a, "file", "maxsubmissionsizebytes") or 0)
    for name, path in taken:
        if limit and path.stat().st_size > limit:
            raise ValueError(f"{name} is larger than the {limit >> 20} MB this assignment allows per file")
    files = [(name, path.open("rb")) for name, path in taken]
    try:
        await md.save_submission(a, files, remove, replace_files, text)
    finally:
        for _, f in files:
            f.close()
    for _, path in taken:
        path.unlink(missing_ok=True)
        path.with_suffix(".name").unlink(missing_ok=True)


# ---- website -------------------------------------------------------------------------

@router.get("")
async def home():
    return await md.home()


@router.post("/refresh")
async def refresh():
    """The reload button: the next reads ask Moodle again."""
    md.drop_cache()
    return Response(status_code=204)


@router.get("/courses/{course_id}")
async def course(course_id: int):
    return await md.course(course_id)


@router.get("/courses/{course_id}/grades")
async def grades(course_id: int):
    return await md.grade_items(course_id)


@router.get("/assignments/{cmid}")
async def assignment(cmid: int, course: int = 0):
    return await md.describe_assignment(await md.find_assignment(cmid, course, by="cmid"))


@router.post("/uploads")
async def upload(request: Request, name: str):
    """Raw file body, name in the query. The file waits (an hour at most) until a submission takes it."""
    try:
        uid = new_upload(name)
    except ValueError as e:
        raise _bad(str(e), "bad_file") from None
    return {"id": uid, "size": await store_upload(uid, request)}


@router.post("/assignments/{cmid}/submission")
async def change_submission(cmid: int, payload: dict = Body(...), course: int = 0):
    """{add: [upload ids], remove: [file names], text: online text}; answers the assignment as it is afterwards."""
    a = await md.find_assignment(cmid, course, by="cmid")
    text = payload.get("text")
    try:
        await _save(a, list(payload.get("add") or []), {str(n) for n in payload.get("remove") or []}, False, None if text is None else str(text))
    except ValueError as e:
        raise _bad(str(e)) from None
    return await md.describe_assignment(a)


@router.post("/assignments/{cmid}/submit")
async def submit(cmid: int, course: int = 0):
    a = await md.find_assignment(cmid, course, by="cmid")
    await md.submit_for_grading(a)
    return await md.describe_assignment(a)


INLINE = ("application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain", "audio/", "video/")


def _stream(name: str, mime: str, size: int | None, body, download: bool) -> StreamingResponse:
    headers = {
        "Content-Disposition": f"{'inline' if mime.startswith(INLINE) and not download else 'attachment'}; filename*=UTF-8''{quote(name)}",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
    }
    if size is not None:
        headers["Content-Length"] = str(size)
    return StreamingResponse(body, media_type=mime, headers=headers)


@router.get("/file")
async def file(url: str, download: bool = False):
    """Streams a Moodle file: PDFs, images, text and media inline, everything else as download."""
    return _stream(*await md.open_file(url), download)


@router.get("/page")
async def page(url: str):
    """A page activity: its HTML (untrusted, the website sanitizes it)."""
    return {"html": await md.page_html(url)}


@router.get("/login")
async def login():
    return md.status()


@router.post("/login")
async def set_login(payload: dict = Body(...)):
    try:
        await md.set_login(*(str(payload.get(k) or "") for k in ("url", "user", "password")))
    except ValueError as e:
        raise _bad(str(e), "moodle_login") from None
    return {"ok": True}


# ---- signed links for the MCP tools (curl) -------------------------------------------

ORIGIN: ContextVar[str] = ContextVar("moodle_origin", default="")


def _sign(what: str, exp: int) -> str:
    from . import mcp

    return hmac.new(mcp.TOKEN.encode(), f"moodle|{what}|{exp}".encode(), hashlib.sha256).hexdigest()


def _link(path: str, what: str, **query: str) -> str:
    exp = int(time.time()) + LINK_SECONDS
    extra = "".join(f"{k}={quote(v, safe='')}&" for k, v in query.items())
    return f"{ORIGIN.get()}{path}?{extra}exp={exp}&sig={_sign(what, exp)}"


def _check(what: str, exp: int, sig: str) -> None:
    if exp < time.time() or not hmac.compare_digest(sig.encode(), _sign(what, exp).encode()):
        raise HTTPException(403, {"error": "forbidden", "detail": "Link invalid or expired"})


@public.put("/api/mcp/moodle-upload/{uid}", include_in_schema=False)
async def upload_link(uid: str, request: Request, exp: int = 0, sig: str = ""):
    _check(f"upload|{uid}", exp, sig)
    return {"upload_id": uid, "size": await store_upload(uid, request)}


@public.get("/api/mcp/moodle-file", include_in_schema=False)
async def file_link(url: str = "", exp: int = 0, sig: str = ""):
    _check(f"file|{url}", exp, sig)
    return _stream(*await md.open_file(url), True)


# ---- text of a file ------------------------------------------------------------------

TEXT_EXT = (
    ".txt .md .csv .json .xml .yml .yaml .sql .java .kt .cs .py .js .ts .c .h .cpp .go .sh .css .tex .log .ini .toml "
    ".gradle .properties"
).split()
IMAGES = ("image/png", "image/jpeg", "image/gif", "image/webp")
_SLIDE = re.compile(r"^ppt/slides/slide(\d+)\.xml$")


class NoText(Exception):
    pass


def _office_text(data: bytes, want, odf: bool) -> str:
    """Text runs of OOXML and ODF documents, one paragraph per line (ODF keeps text directly in <text:p>)."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise NoText("not a valid office file") from None
    parts = sorted((n for n in z.namelist() if want(n)), key=lambda n: int(m.group(1)) if (m := _SLIDE.match(n)) else 0)
    out: list[str] = []
    for part in parts:
        if m := _SLIDE.match(part):
            out.append(f"--- slide {m.group(1)} ---\n")
        try:
            # end events come in document order for the leaves (w:t, a:t, w:tab, w:br), paragraphs close after their runs
            for _, el in ElementTree.iterparse(io.BytesIO(z.read(part))):
                tag = el.tag.rsplit("}", 1)[-1]
                if odf:
                    if tag in ("p", "h"):
                        out.append("".join(el.itertext()) + "\n")
                elif tag == "t":
                    out.append(el.text or "")
                elif tag == "tab":
                    out.append("\t")
                elif tag == "br":
                    out.append("\n")
                elif tag == "p":
                    out.append("\n")
        except ElementTree.ParseError:
            raise NoText("bad document xml") from None
    return "".join(out)


def extract_text(name: str, mime: str, data: bytes) -> str:
    """Plain text of a downloaded file for the model. Raises NoText."""
    ext = Path(name).suffix.lower()
    if mime == "application/pdf" or ext == ".pdf":
        from pypdf import PdfReader
        from pypdf.errors import PyPdfError

        try:
            pages = [(p.extract_text() or "").strip() for p in PdfReader(io.BytesIO(data)).pages]
        except (PyPdfError, ValueError, KeyError) as e:
            raise NoText(f"could not read the pdf: {e}") from None
        if not any(pages):
            raise NoText("pdf has no text layer (scanned?)")
        return "".join(f"--- page {n} ---\n{t}\n" for n, t in enumerate(pages, 1))
    if ext == ".docx":
        return _office_text(data, lambda n: n == "word/document.xml", False)
    if ext == ".pptx":
        return _office_text(data, lambda n: bool(_SLIDE.match(n)), False)
    if ext in (".odt", ".odp"):
        return _office_text(data, lambda n: n == "content.xml", True)
    if mime == "text/html" or ext in (".html", ".htm"):
        return md.html_text(data.decode("utf-8", "replace"))
    if mime.startswith("text/") or ext in TEXT_EXT or mime in ("application/json", "application/xml"):
        return data.decode("utf-8", "replace")
    raise NoText("no text extractor for this file type")


# ---- MCP tools (JSON text, the shapes of the former moodle-mcp) ------------------------------

def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False)


def _relative(seconds: float) -> str:
    past, s = seconds < 0, abs(seconds)
    if s < 60:
        return "now"
    if s < 3600:
        text = f"{int(s // 60)}m"
    elif s < 48 * 3600:
        text = f"{int(s // 3600)}h {int(s // 60 % 60)}m"
    else:
        text = f"{int(s // 86400)}d {int(s // 3600 % 24)}h"
    return f"{text} ago" if past else f"in {text}"


def _local(iso: str | None) -> datetime | None:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(md.TZ) if iso else None


def _date(iso: str | None) -> str:
    d = _local(iso)
    return d.strftime("%Y-%m-%d %H:%M") if d else ""


def _when(iso: str | None) -> str:
    d = _local(iso)
    return f"{d.strftime('%a %Y-%m-%d %H:%M')} ({_relative(d.timestamp() - time.time())})" if d else ""


def _clip(s: str, n: int) -> str:
    return s if len(s) <= n else s[:n] + "..."


def _lean(d: dict) -> dict:
    """Drops empty values, like omitempty in the old Go shapes."""
    return {k: v for k, v in d.items() if v not in (None, "", [], False)}


def _file_out(f: dict) -> dict:
    return _lean({"name": f["name"], "url": f["url"], "mimetype": f["mime"], "size": f["size"], "modified": _date(f["modified"])})


async def courses_tool(include_past: bool = False) -> str:
    return _json(
        [
            _lean(
                {
                    "id": c["id"],
                    "name": c["name"],
                    "short": c["short"],
                    "progress_percent": c["progress"],
                    "last_access": _date(c["lastAccess"]),
                    "ended": c["ended"],
                    "favourite": c["favourite"],
                }
            )
            for c in await md.courses(bool(include_past))
        ]
    )


async def deadlines_tool(days: int = 14, skip_overdue: bool = False) -> str:
    rows = await md.deadlines(int(days) if days and int(days) > 0 else 14, 0 if skip_overdue else 60)
    return _json(
        [
            _lean(
                {
                    "due": _when(r["due"]),
                    "name": r["name"],
                    "course": r["course"],
                    "course_id": r["courseId"],
                    "type": r["type"],
                    "cmid": r["cmid"],
                    "overdue": r["overdue"],
                    "action": r["action"],
                    "url": r["url"],
                }
            )
            for r in rows
        ]
    )


async def course_contents_tool(course_id: int, section: str = "") -> str:
    c = await md.course(int(course_id))
    want = str(section or "").strip().lower()
    out = []
    for s in c["sections"]:
        if want and str(s["number"]) != want and want not in s["name"].lower():
            continue
        modules = []
        for m in s["modules"]:
            label = m["type"] == "label"
            modules.append(
                _lean(
                    {
                        "cmid": m["cmid"],
                        "name": m["name"],
                        "type": m["type"],
                        "instance": m["instance"],
                        "url": "" if label else m["url"],
                        "description": _clip(md.html_text(m["description"]), 1500 if label else 400),
                        "dates": [f"{d['label']} {_date(d['time'])}" for d in m["dates"]],
                        "restricted": _clip(m["restricted"] or "", 300),
                        "done": m["done"],
                        "link": m["link"],
                        "files": [_file_out(f) for f in m["files"]],
                    }
                )
            )
        out.append(_lean({"number": s["number"], "name": s["name"], "summary": _clip(md.html_text(s["summary"]), 600)}) | {"modules": modules})
    if want and not out:
        raise ValueError(f"no section matches {section!r}")
    return _json({"course_id": c["id"], "course": c["name"], "sections": out})


def _assignment_out(d: dict) -> dict:
    types = []
    if d["files"]:
        extra = [f"max {d['maxFiles']} files" if d["maxFiles"] else "", f"max {d['maxBytes'] >> 20} MB each" if d["maxBytes"] else ""]
        extra = [e for e in extra + [f"types {d['fileTypes']}" if d["fileTypes"] else ""] if e]
        types.append("file" + (f" ({', '.join(extra)})" if extra else ""))
    if d["onlineText"]:
        types.append("online_text")
    out = _lean(
        {
            "assignment_id": d["id"],
            "cmid": d["cmid"],
            "course_id": d["courseId"],
            "course": d["course"],
            "name": d["name"],
            "url": d["url"],
            "opens": _when(d["opens"]),
            "due": _when(d["due"]),
            "cutoff": _when(d["cutoff"]),
            "extension_due": _when(d["extensionDue"]),
            "attachments": [_file_out(f) for f in d["attachments"]],
            "has_submit_button": d["submitButton"],
            "team_submission": d["team"],
        }
    )
    out["description"] = md.html_text(d["description"])
    out["submission_types"] = types
    if s := d["submission"]:
        out["submission"] = _lean(
            {
                "status": "nothing submitted" if s["status"] == "none" else s["status"],
                "grading_status": s["grading"],
                "last_modified": _date(s["modified"]),
                "needs_finalize": s["needsSubmit"],
                "locked": s["locked"],
                "files": [_file_out(f) for f in s["files"]],
                "online_text": md.html_text(s["text"]),
            }
        ) | {"can_edit": s["canEdit"]}
    if fb := d["feedback"]:
        out["feedback"] = _lean(
            {
                "grade": fb["grade"],
                "graded_at": _date(fb["gradedAt"]),
                "comments": md.html_text(fb["comments"]),
                "files": [_file_out(f) for f in fb["files"]],
            }
        )
    return out


async def _find(assignment_id: int = 0, cmid: int = 0) -> dict:
    if not assignment_id and not cmid:
        raise ValueError("give assignment_id or cmid")
    # The model often passes the cmid it got from deadlines or course_contents as assignment_id: both are tried.
    return await md.find_assignment(int(assignment_id or cmid), by="id" if assignment_id else "cmid")


async def assignment_tool(assignment_id: int = 0, cmid: int = 0) -> str:
    return _json(_assignment_out(await md.describe_assignment(await _find(assignment_id, cmid))))


async def grades_tool(course_id: int = 0) -> str:
    if not course_id:
        home = await md.home()
        return _json([{"course_id": c["id"], "course": c["name"], "grade": c["grade"] or "-"} for c in home["courses"]])
    items = [
        _lean(
            {
                "name": it["name"],
                "type": it["type"],
                "cmid": it["cmid"],
                "range": it["range"],
                "percentage": it["percentage"],
                "weight": it["weight"],
                "feedback": it["feedback"],
                "graded_at": _date(it["gradedAt"]),
            }
        )
        | {"grade": it["grade"]}
        for it in await md.grade_items(int(course_id))
    ]
    return _json({"course_id": int(course_id), "items": items})


async def read_file_tool(url: str, offset: int = 0, max_chars: int = 30000):
    name, mime, data = await md.download(url)
    out = {"name": name, "mimetype": mime, "size": len(data), "download_url": _link("/api/mcp/moodle-file", f"file|{url}", url=url)}
    if mime in IMAGES and len(data) <= 5 * 1024 * 1024:
        return [{"type": "text", "text": _json(out)}, {"type": "image", "data": base64.b64encode(data).decode(), "mimeType": mime}]
    try:
        text = extract_text(name, mime, data)
    except NoText as e:
        out["note"] = f"{e}; fetch it with curl -o <file> '<download_url>' (valid {LINK_SECONDS // 60} min)"
        return _json(out)
    out["total_chars"] = len(text)
    start = min(max(int(offset or 0), 0), len(text))
    end = min(start + (int(max_chars) if max_chars and int(max_chars) > 0 else 30000), len(text))
    if end < len(text):
        out["next_offset"] = end
    out["text"] = text[start:end]
    return _json(out)


async def upload_link_tool(name: str) -> str:
    uid = new_upload(str(name))
    url = _link(f"/api/mcp/moodle-upload/{uid}", f"upload|{uid}")
    return _json({"upload_id": uid, "url": url, "how": f"curl -sS -T <local file> '{url}'", "valid_minutes": LINK_SECONDS // 60})


async def submit_assignment_tool(
    assignment_id: int,
    uploads: list | None = None,
    online_text: str | None = None,
    replace_files: bool = False,
    finalize: bool = False,
) -> str:
    a = await _find(assignment_id)
    uploads = list(uploads or [])
    change = bool(uploads) or online_text is not None or bool(replace_files)
    if not change and not finalize:
        raise ValueError("nothing to do: give uploads, online_text, replace_files or finalize")
    out: dict = {"saved": False, "finalized": False}
    if change:
        await _save(a, uploads, None, bool(replace_files), online_text)
        out["saved"] = True
    if finalize:
        if a.get("submissiondrafts") != 1:
            out["note"] = "this assignment has no submit button: the saved submission already counts as submitted"
        else:
            await md.submit_for_grading(a)
            out["finalized"] = True
    elif a.get("submissiondrafts") == 1:
        out["note"] = "saved as draft: not submitted for grading until finalize=true"
    out["assignment"] = _assignment_out(await md.describe_assignment(a))
    return _json(out)


_INT = {"type": "integer"}
_BOOL = {"type": "boolean"}
_STR = {"type": "string"}
# name -> (function, description, properties, required)
TOOLS = {
    "moodle_deadlines": (
        deadlines_tool,
        "Moodle: open to-dos across all courses (dashboard timeline): assignments, quizzes and other activities that are due, with "
        "course, due time and whether they are overdue. Submitted work no longer shows up here. days: how far ahead (default 14, "
        "max 180); overdue items of the last 60 days are included unless skip_overdue.",
        {"days": _INT, "skip_overdue": _BOOL},
        [],
    ),
    "moodle_courses": (
        courses_tool,
        "Moodle: enrolled courses with id, name, progress and last access. Ended courses only with include_past.",
        {"include_past": _BOOL},
        [],
    ),
    "moodle_course_contents": (
        course_contents_tool,
        "Moodle: sections and activities of one course with their files (name, url, type, size) and dates. section: only sections "
        "whose number equals it or whose name contains it. Read a file with moodle_read_file and its url.",
        {"course_id": _INT, "section": _STR},
        ["course_id"],
    ),
    "moodle_assignment": (
        assignment_tool,
        "Moodle: one assignment in full: task description, attachments, due and cutoff dates, allowed submission types, the own "
        "submission (status, files, text) and the teacher's feedback and grade. Give assignment_id (instance from "
        "moodle_course_contents) or cmid (from moodle_deadlines or moodle_course_contents).",
        {"assignment_id": _INT, "cmid": _INT},
        [],
    ),
    "moodle_grades": (
        grades_tool,
        "Moodle: without course_id the overall grade per course; with course_id every grade item of that course with grade, range, "
        "percentage, weight and feedback.",
        {"course_id": _INT},
        [],
    ),
    "moodle_read_file": (
        read_file_tool,
        "Moodle: read a file (url from moodle_course_contents or moodle_assignment): PDF, Word, PowerPoint, OpenDocument, HTML and "
        "plain text or code come back as text, images as images. Long text is paged with offset (next_offset of the call before). "
        "download_url fetches the file itself with curl.",
        {"url": _STR, "offset": _INT, "max_chars": _INT},
        ["url"],
    ),
    "moodle_upload_link": (
        upload_link_tool,
        "Moodle: step one of handing in a local file. Returns an upload_id and a link; send the file there with "
        "curl -T <file> '<url>', then pass the upload_id to moodle_submit_assignment. The upload waits an hour at most.",
        {"name": _STR},
        ["name"],
    ),
    "moodle_submit_assignment": (
        submit_assignment_tool,
        "Moodle: change the own submission of an assignment: add uploaded files (upload ids from moodle_upload_link) and/or set "
        "the online text. Files already submitted are kept unless replace_files is set (a new file with the same name replaces "
        "the old one). In assignments with a submit button the result stays a draft until finalize=true, which submits for "
        "grading (accepting the submission statement) and usually cannot be undone. Only call this when the user clearly asked "
        "to submit or upload.",
        {
            "assignment_id": {"type": "integer", "description": "assignment id or cmid"},
            "uploads": {"type": "array", "items": _STR},
            "online_text": _STR,
            "replace_files": _BOOL,
            "finalize": _BOOL,
        },
        ["assignment_id"],
    ),
}
WRITES = {"moodle_upload_link", "moodle_submit_assignment"}

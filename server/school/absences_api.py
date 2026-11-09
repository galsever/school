"""Absences: website routes under /api/absences and the MCP tools (absence_days, attendance, excuse_pdf, ...)."""

import hashlib
import hmac
import json
import time
from contextvars import ContextVar

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import Response

from . import absences as ab
from . import auth, letter
from .untis import add_days, today_iso

router = APIRouter(prefix="/api/absences", dependencies=[Depends(auth.require)])
# Routes without the app login: only the signed PDF link the MCP tool hands out.
public = APIRouter()


def _bad(message: str, code: str = "bad_request") -> HTTPException:
    return HTTPException(400, {"error": code, "detail": message})


def _pdf(dates: list[str]) -> Response:
    try:
        pdf, name = letter.build(dates)
    except ValueError as e:
        raise _bad(str(e), "letter") from None
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"},
    )


# ---- website ------------------------------------------------------------------------

@router.get("")
async def days():
    snap = ab.load_snapshot()
    return {
        "sync": ab.sync_status(),
        "name": snap["name"] if snap else "",
        "klasse": snap["klasse"] if snap else "",
        "days": ab.day_views(snap) if snap else [],
    }


@router.post("/sync")
async def sync(force: bool = False):
    return await ab.sync(force)


@router.put("/{day}/reason")
async def set_reason(day: str, payload: dict = Body(...)):
    if not ab.ISO.match(day):
        raise _bad("Bad date")
    ab.save_reason(day, str(payload.get("reason") or "")[:2000])
    return {"ok": True}


@router.post("/letter")
async def make_letter(payload: dict = Body(...)):
    return _pdf([str(d) for d in payload.get("dates") or []])


@router.get("/attendance")
async def attendance(range: str = "", start: str = Query("", alias="from"), end: str = Query("", alias="to")):
    snap = ab.load_snapshot()
    if not snap:
        return {"range": None, "semesters": [], "total": None, "subjects": [], "groups": [], "allSubjects": []}
    rng = ab.pick_range(snap, range, start, end)
    total, subjects = ab.attendance(snap, rng)
    return {
        "range": rng,
        "semesters": snap["semesters"],
        "total": total,
        "subjects": subjects,
        "groups": ab.load_groups(),
        "allSubjects": sorted({l["subject"] for l in snap["lessons"]}),
    }


@router.post("/groups")
async def save_group(payload: dict = Body(...)):
    name = str(payload.get("name") or "").strip()[:40]
    subjects = list(dict.fromkeys(str(s) for s in payload.get("subjects") or []))
    if not name or len(subjects) < 2:
        raise _bad("A group needs a name and two subjects")
    ab.save_group(name, subjects)
    return {"ok": True}


@router.delete("/groups/{name}")
async def delete_group(name: str):
    ab.delete_group(name)
    return {"ok": True}


@router.get("/login")
async def login():
    c = ab.load_login() or {}
    return {"configured": bool(c), **{k: c.get(k, "") for k in ("server", "school", "user", "place")}}


@router.post("/login")
async def set_login(payload: dict = Body(...)):
    try:
        await ab.set_login(*(str(payload.get(k) or "") for k in ("server", "school", "user", "password", "place")))
    except ValueError as e:
        raise _bad(str(e), "untis_login") from None
    return {"ok": True}


# ---- signed PDF link (so a model can fetch the letter with curl) ---------------------------

PDF_LINK_SECONDS = 15 * 60
ORIGIN: ContextVar[str] = ContextVar("origin", default="")


def _sign(dates: str, exp: int) -> str:
    from . import mcp

    return hmac.new(mcp.TOKEN.encode(), f"pdf|{dates}|{exp}".encode(), hashlib.sha256).hexdigest()


@public.get("/api/mcp/pdf", include_in_schema=False)
async def pdf_link(dates: str = "", exp: int = 0, sig: str = ""):
    if exp < time.time() or not hmac.compare_digest(sig.encode(), _sign(dates, exp).encode()):
        raise HTTPException(403, {"error": "forbidden", "detail": "Link invalid or expired"})
    return _pdf(dates.split(","))


# ---- MCP tools (JSON text, the shapes of the former excuses MCP) ---------------------------

NEW_DAYS_BACK = 14
"""new_open_days only looks this far back, so old unexplained days are not asked about again and again."""


class Fail(Exception):
    """A tool answer the model should read as an error."""


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False)


async def _fresh() -> dict:
    """Syncs when the data is older than 30 min (never forces, never retries a rejected login)."""
    await ab.sync(False)
    snap = ab.load_snapshot()
    if not snap:
        raise Fail("No data yet (never synced). The WebUntis login is set in the hub settings.")
    return snap


def _sync_info() -> dict:
    s = ab.sync_status()
    return {"last_sync": s["lastSync"], "error": s["lastError"], "login_blocked": s["blocked"]}


def _day_out(d: dict, snap: dict) -> dict:
    def one(a: dict) -> dict:
        subjects = list(
            dict.fromkeys(
                l["subject"]
                for l in snap["lessons"]
                if l["date"] == a["date"] and not l["cancelled"] and min(l["end"], a["end"]) > max(l["start"], a["start"])
            )
        )
        out = {
            "time": f"{ab.format_time(a['start'])}-{ab.format_time(a['end'])}",
            "lessons": ab.format_units(a["units"]),
            "subjects": subjects,
            "late": a["late"],
            "webuntis": "entschuldigt" if a["excused"] else (a["status"] or "offen"),
        }
        if a["lateMinutes"]:
            out["late_minutes"] = a["lateMinutes"]
        if a["untisReason"]:
            out["webuntis_reason"] = a["untisReason"]
        return out

    return {
        "date": d["date"],
        "weekday": ab.WEEKDAYS[ab.weekday(d["date"])],
        "absences": [one(a) for a in d["absences"]],
        "excused": d["status"] == "excused",
        "only_late": d["onlyLate"],
        "reason": d["reason"].strip() or None,
        "exported_at": d["exportedAt"],
        "asked_at": d["askedAt"],
    }


def _is_open(d: dict) -> bool:
    return not d["excused"] and not d["reason"] and not d["exported_at"]


def _iso(*values: str) -> None:
    if any(v and not ab.ISO.match(v) for v in values):
        raise ValueError("dates are YYYY-MM-DD")


async def absence_days(from_: str = "", to: str = "", open_only: bool = False) -> str:
    _iso(from_, to)
    snap = await _fresh()
    days = [_day_out(d, snap) for d in ab.day_views(snap)]
    days = [d for d in days if (not from_ or d["date"] >= from_) and (not to or d["date"] <= to) and (not open_only or _is_open(d))]
    return _json({"sync": _sync_info(), "days": days})


async def new_open_days() -> str:
    snap = await _fresh()
    since = add_days(today_iso(), -NEW_DAYS_BACK)
    days = [d for d in (_day_out(d, snap) for d in ab.day_views(snap)) if d["date"] >= since and _is_open(d) and not d["asked_at"]]
    if days:
        ab.mark_asked([d["date"] for d in days])
    return _json({"sync": _sync_info(), "days": days})


async def set_reason_tool(date: str, reason: str) -> str:
    _iso(date)
    snap = ab.load_snapshot()
    if not snap or not any(a["date"] == date for a in snap["absences"]):
        raise Fail(f"There is no absence on {date}.")
    reason = reason.strip()[:2000]
    ab.save_reason(date, reason)
    return _json({"date": date, "reason": reason or None})


async def attendance_tool(range: str = "", from_: str = "", to: str = "") -> str:
    _iso(from_, to)
    snap = await _fresh()
    rng = ab.pick_range(snap, range, from_, to)
    total, subjects = ab.attendance(snap, rng)

    def row(s: dict) -> dict:
        return {
            "subject": s["subject"],
            "name": s["subjectLong"],
            "held": s["held"],
            "present": s["present"],
            "excused": s["excused"],
            "unexcused": s["unexcused"],
            "present_percent": None if s["percent"] is None else round(s["percent"], 1),
        }

    return _json(
        {
            "sync": _sync_info(),
            "range": {"from": rng["start"], "to": rng["end"], "label": rng["label"]},
            "total": row(total),
            "subjects": [row(s) for s in subjects],
        }
    )


async def excuse_pdf(dates: list[str]) -> str:
    if not isinstance(dates, list) or not 1 <= len(dates) <= 60:
        raise ValueError("dates: 1 to 60 days")
    _iso(*(str(d) for d in dates))
    try:
        c = ab.check_letter([str(d) for d in dates])
    except ValueError as e:
        raise Fail(str(e)) from None
    days = ",".join(d["date"] for d in c["days"])
    exp = int(time.time()) + PDF_LINK_SECONDS
    return _json(
        {
            "url": f"{ORIGIN.get()}/api/mcp/pdf?dates={days}&exp={exp}&sig={_sign(days, exp)}",
            "days": [{"date": d["date"], "reason": d["reason"].strip()} for d in c["days"]],
        }
    )


async def refresh() -> str:
    await ab.sync(True)
    return _json(_sync_info())


_DATE = {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"}
# name -> (function, description, properties, required); "from" is passed on as from_.
TOOLS = {
    "absence_days": (
        absence_days,
        "School absence days from WebUntis (newest first) with times, lesson numbers, missed subjects, lateness, WebUntis status, "
        "the owner's own reason, exported_at (already in a PDF). Default range: the current school year. open_only: only days "
        "without a reason that are neither excused nor exported.",
        {"from": _DATE, "to": _DATE, "open_only": {"type": "boolean"}},
        [],
    ),
    "new_open_days": (
        new_open_days,
        f"Absence days of the last {NEW_DAYS_BACK} days that still need a reason and were not returned by this tool before; it marks "
        "them as asked. For the morning check: ask the owner for a reason for each (suggest one from their calendar if an event "
        "explains it), then save the answer with set_reason.",
        {},
        [],
    ),
    "set_reason": (
        set_reason_tool,
        "Save the owner's own reason for one absence day (what goes into the Entschuldigung PDF), e.g. \"Arzttermin\" or "
        "\"Krank (Fieber)\". An empty reason clears it. Only on the owner's word.",
        {"date": _DATE, "reason": {"type": "string", "maxLength": 2000}},
        ["date", "reason"],
    ),
    "attendance": (
        attendance_tool,
        "Attendance per subject in lessons (held, present, excused, unexcused, present percent; below 50 % is critical, 50 to 70 % "
        "a warning) plus the total. range: semester (current, default), s1, s2, year; or from+to. Lateness never counts as absent.",
        {"range": {"type": "string", "enum": ["semester", "s1", "s2", "year"]}, "from": _DATE, "to": _DATE},
        [],
    ),
    "excuse_pdf": (
        excuse_pdf,
        f"Make the Entschuldigung PDF for some absence days (each needs a reason). Returns a download link valid "
        f"{PDF_LINK_SECONDS // 60} min; download it with curl -o <file>. Downloading marks the days as exported.",
        {"dates": {"type": "array", "items": _DATE, "minItems": 1, "maxItems": 60}},
        ["dates"],
    ),
    "refresh": (
        refresh,
        "Pull WebUntis absences now (at most once a minute). Normally not needed: the other absence tools refresh data older than "
        "30 min themselves.",
        {},
        [],
    ),
}
WRITES = {"new_open_days", "set_reason"}

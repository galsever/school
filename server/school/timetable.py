"""WebUntis timetable, exams and homework as MCP tools (ported from the Go untis-mcp, same names and JSON shapes).

Uses the hub's WebUntis login (absences.load_login). A rejected login is never retried: it sets the absences'
auth_blocked, which also stops the absence sync until the login is changed in Settings. Answers are cached a few
minutes so a burst of tool calls does not log in again and again; one login + logout per fetch.
"""

import asyncio
import json
import time
from datetime import date, timedelta

from . import absences as ab
from . import untis
from .untis import UntisError, from_untis_date, to_untis_date

CACHE_SECONDS = 5 * 60
EXAM_TYPES = {"TE": "Test", "SA": "Schularbeit", "PR": "Prüfung", "MP": "Mündliche Prüfung", "SÜ": "Stundenwiederholung"}
_cache: dict[str, tuple[float, object]] = {}
_lock = asyncio.Lock()


class Fail(Exception):
    pass


async def _fetch(key: str, job):
    """job(session) with one login + logout, cached per key."""
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    async with _lock:  # one WebUntis session at a time
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            return hit[1]
        login = ab.load_login()
        if not login:
            raise Fail("WebUntis login not set up: the owner enters it in the school hub Settings")
        if ab.get_meta("auth_blocked") == ab.login_hash(login):
            raise Fail("login_blocked: WebUntis rejected the stored login; the owner must change it in the school hub Settings")
        try:
            s = await untis.UntisSession.login(login["server"], login["school"], login["user"], login["password"])
        except UntisError as e:
            if e.bad_credentials:
                ab.set_meta("auth_blocked", ab.login_hash(login))
                ab.set_meta("last_error", "WebUntis rejects the stored login")
                raise Fail("login_blocked: WebUntis rejected the stored login; the owner must change it in the school hub Settings") from None
            raise Fail(f"WebUntis: {e}") from None
        try:
            out = await job(s)
        except UntisError as e:
            raise Fail(f"WebUntis: {e}") from None
        finally:
            await s.logout()
        _cache[key] = (time.time(), out)
        return out


def _range(from_: str | None, to: str | None, length: int) -> tuple[date, date]:
    try:
        f = date.fromisoformat(from_) if from_ else date.fromisoformat(untis.today_iso())
        t = date.fromisoformat(to) if to else f + timedelta(days=length)
    except ValueError:
        raise ValueError("dates are YYYY-MM-DD") from None
    if t < f:
        raise ValueError("to is before from")
    return f, t


def _day(n: int) -> str:
    d = date.fromisoformat(from_untis_date(n))
    return f"{d.isoformat()} {d.strftime('%a')}"


def _clock(n: int) -> str:
    return f"{n // 100:02d}:{n % 100:02d}"


def _json(v) -> str:
    return json.dumps(v, ensure_ascii=False)


def _drop_empty(d: dict) -> dict:
    return {k: v for k, v in d.items() if v not in (None, "", [], False)}


def lesson_out(p: dict) -> dict:
    def names(es, long=False):
        return [n for n in ((e.get("longname") if long and e.get("longname") else e.get("name")) for e in es or []) if n and n != "---"]

    te, ro = p.get("te") or [], p.get("ro") or []
    o = {
        "day": _day(p["date"]),
        "time": f"{_clock(p['startTime'])}-{_clock(p['endTime'])}",
        "subject": "",
        "subject_name": "",
        "teachers": names(te),
        "rooms": names(ro),
        "status": "",
        "was_teachers": [e["orgname"] for e in te if e.get("orgname")],
        "was_rooms": [e["orgname"] for e in ro if e.get("orgname")],
        "substitution": p.get("substText") or "",
        "topic": p.get("lstext") or "",
        "info": p.get("info") or "",
        "activity": "" if p.get("activityType") in (None, "", "Unterricht") else p["activityType"],
    }
    if p.get("su"):
        o["subject"], o["subject_name"] = p["su"][0].get("name", ""), p["su"][0].get("longname", "")
    if p.get("code") == "cancelled":
        o["status"] = "cancelled"
    elif p.get("code") == "irregular" or o["was_teachers"] or o["was_rooms"]:
        o["status"] = "changed"
    # a teacher replaced by "---": the teacher is away and nobody substitutes
    if not o["teachers"] and o["was_teachers"] and o["status"] == "changed":
        o["status"] = "changed (no teacher)"
    return _drop_empty(o)


async def timetable(from_: str = "", to: str = "") -> str:
    f, t = _range(from_, to, 0)
    if (t - f).days > 31:
        raise ValueError("at most 31 days at once")

    async def job(s):
        return await s.rpc(
            "getTimetable",
            {
                "options": {
                    "element": {"id": s.person_id, "type": s.person_type or 5},
                    "startDate": to_untis_date(f.isoformat()),
                    "endDate": to_untis_date(t.isoformat()),
                    "showInfo": True,
                    "showSubstText": True,
                    "showLsText": True,
                    "klasseFields": ["name"],
                    "roomFields": ["name", "longname"],
                    "subjectFields": ["name", "longname"],
                    "teacherFields": ["name"],
                }
            },
        )

    periods = await _fetch(f"tt|{f}|{t}", job) or []
    return _json([lesson_out(p) for p in sorted(periods, key=lambda p: (p["date"], p["startTime"]))])


def exam_out(e: dict, today: date) -> dict:
    days = (date.fromisoformat(from_untis_date(e["examDate"])) - today).days
    when = "today" if days == 0 else "tomorrow" if days == 1 else f"{-days} days ago" if days < 0 else f"in {days} days"
    return _drop_empty(
        {
            "day": _day(e["examDate"]),
            "time": f"{_clock(e.get('startTime') or 0)}-{_clock(e.get('endTime') or 0)}",
            "type": EXAM_TYPES.get(e.get("examType") or "", e.get("examType") or ""),
            "subject": e.get("subject") or "",
            "name": e.get("name") if e.get("name") != e.get("subject") else "",
            "text": e.get("text") or "",
            "teachers": e.get("teachers") or [],
            "rooms": e.get("rooms") or [],
            "grade": e.get("grade") or "",
            "in": when,
        }
    )


async def exams(from_: str = "", to: str = "") -> str:
    f, t = _range(from_, to, 120)

    async def job(s):
        path = (
            f"/api/exams?studentId={s.person_id}&klasseId={s.klasse_id}"
            f"&startDate={to_untis_date(f.isoformat())}&endDate={to_untis_date(t.isoformat())}&withGrades=true"
        )
        return ((await s.rest(path)).get("data") or {}).get("exams") or []

    items = await _fetch(f"ex|{f}|{t}", job)
    today = date.fromisoformat(untis.today_iso())
    return _json([exam_out(e, today) for e in sorted(items, key=lambda e: (e["examDate"], e.get("startTime") or 0))])


def homework_out(data: dict, all_: bool) -> list[dict]:
    subjects = {l.get("id"): l.get("subject", "") for l in data.get("lessons") or []}
    teacher_names = {t.get("id"): t.get("name", "") for t in data.get("teachers") or []}
    teachers = {r.get("homeworkId"): teacher_names.get(r.get("teacherId"), "") for r in data.get("records") or []}
    out = []
    for h in sorted(data.get("homeworks") or [], key=lambda h: h.get("dueDate") or 0):
        if h.get("completed") and not all_:
            continue
        out.append(
            _drop_empty(
                {
                    "due": _day(h["dueDate"]),
                    "subject": subjects.get(h.get("lessonId"), ""),
                    "text": h.get("text") or "",
                    "remark": h.get("remark") or "",
                    "assigned": _day(h["date"]),
                    "teacher": teachers.get(h.get("id"), ""),
                    "completed": bool(h.get("completed")),
                }
            )
        )
    return out


async def homework(from_: str = "", to: str = "", all: bool = False) -> str:
    f, t = _range(from_, to, 120)

    async def job(s):
        path = f"/api/homeworks/lessons?startDate={to_untis_date(f.isoformat())}&endDate={to_untis_date(t.isoformat())}"
        return (await s.rest(path)).get("data") or {}

    return _json(homework_out(await _fetch(f"hw|{f}|{t}", job), bool(all)))


_DATE = {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}$"}
TOOLS = {
    "timetable": (
        timetable,
        "WebUntis: your lessons between two dates (max 31 days): time, subject, teacher, room, topic, and changes: status cancelled "
        "or changed (substitution, room or teacher change) with the original teacher/room and the substitution text. Default: today.",
        {"from": _DATE, "to": _DATE},
        [],
    ),
    "exams": (
        exams,
        "WebUntis: your exams (Test, Schularbeit, Prüfung, ...) with date, time, subject, teacher, room, topic text and grade if "
        "entered. Default: from today 120 days ahead.",
        {"from": _DATE, "to": _DATE},
        [],
    ),
    "homework": (
        homework,
        "WebUntis: homework from the class register: subject, text, assigned and due date, teacher, completed. Default: not "
        "completed, due from today up to 120 days ahead. all: also completed.",
        {"from": _DATE, "to": _DATE, "all": {"type": "boolean"}},
        [],
    ),
}

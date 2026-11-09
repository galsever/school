"""Absences from WebUntis: the model built from a raw pull, attendance per subject, own reasons per day, sync.

Times are minutes since midnight, dates ISO strings (YYYY-MM-DD). The raw pull is stored (not the model),
so model fixes apply without a new sync. Lateness never counts as absent.
"""

import asyncio
import hashlib
import json
import re
import sqlite3
import time
from datetime import date, datetime
from urllib.parse import parse_qs, urlsplit

from . import config, untis
from .untis import add_days, from_untis_date, today_iso, utc_iso

ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]


def to_minutes(hhmm: int) -> int:
    return hhmm // 100 * 60 + hhmm % 100


def overlap(a0: int, a1: int, b0: int, b1: int) -> int:
    return max(0, min(a1, b1) - max(a0, b0))


def weekday(iso: str) -> int:
    """0 = Sunday, like the German weekday list above."""
    return date.fromisoformat(iso).isoweekday() % 7


# ---- model ------------------------------------------------------------------------

def semesters(raw: dict) -> list[dict]:
    """Semester 1 ends before the Semesterferien, semester 2 starts after them."""
    start = from_untis_date(raw["schoolyear"]["startDate"])
    end = from_untis_date(raw["schoolyear"]["endDate"])
    brk = None
    for h in raw["holidays"]:
        h_start, h_end = from_untis_date(h["startDate"]), from_untis_date(h["endDate"])
        if re.search("semester", f"{h.get('name', '')} {h.get('longName', '')}", re.I) and h_start > start and h_end < end:
            brk = (h_start, h_end)
            break
    if not brk:
        # Vienna: the first full week (Monday to Sunday) of February.
        monday = f"{end[:4]}-02-01"
        while weekday(monday) != 1:
            monday = add_days(monday, 1)
        brk = (monday, add_days(monday, 6))
    return [
        {"name": "1. Semester", "start": start, "end": add_days(brk[0], -1)},
        {"name": "2. Semester", "start": add_days(brk[1], 1), "end": end},
    ]


def _time_units(raw: dict) -> list[dict]:
    # The grid is the same every weekday at Spengergasse; take the day with the most units.
    days = sorted(raw["timegrid"], key=lambda d: -len(d["timeUnits"]))
    grid = days[0]["timeUnits"] if days else []
    return [{"name": u["name"], "start": to_minutes(u["startTime"]), "end": to_minutes(u["endTime"])} for u in grid]


def _lessons(raw: dict) -> list[dict]:
    seen, out = set(), []
    for l in raw["lessons"]:
        su = (l.get("su") or [None])[0]
        if not su:
            continue  # excursions, events: no subject, not part of the stats
        lesson = {
            "date": from_untis_date(l["date"]),
            "start": to_minutes(l["startTime"]),
            "end": to_minutes(l["endTime"]),
            "subject": su["name"],
            "subjectLong": su.get("longname") or su["name"],
            "cancelled": l.get("code") == "cancelled",
        }
        key = (lesson["date"], lesson["start"], lesson["end"], lesson["subject"], lesson["cancelled"])
        if key in seen:
            continue
        seen.add(key)
        out.append(lesson)
    out.sort(key=lambda l: (l["date"], l["start"]))
    return out


def _part(t: dict, late: bool) -> dict:
    start, end = to_minutes(t["startTime"]), to_minutes(t["endTime"])
    missed = t.get("missedMins")
    return {
        "absenceId": t["absenceId"],
        "date": from_untis_date(t["date"]),
        "start": start,
        "end": end,
        "late": late,
        "excused": bool(t.get("excused")),
        "minutes": missed if missed is not None else end - start,
    }


def _absence_days(raw: dict, units: list[dict]) -> list[dict]:
    """Absences split per day (WebUntis can return one absence spanning several days)."""
    first = units[0]["start"] if units else 0
    last = units[-1]["end"] if units else 24 * 60
    out = []
    for a in raw["absences"]:
        start, end = from_untis_date(a["startDate"]), from_untis_date(a["endDate"])
        d = start
        while d <= end:
            if not (start != end and weekday(d) in (0, 6)):
                out.append(
                    {
                        "id": a["id"],
                        "date": d,
                        "start": to_minutes(a["startTime"]) if d == start else first,
                        "end": to_minutes(a["endTime"]) if d == end else last,
                        "src": a,
                    }
                )
            d = add_days(d, 1)
    return out


def _guess_parts(days: list[dict], units: list[dict]) -> list[dict]:
    """Without the per-lesson endpoint: an absence inside one unit that starts at its start and ends early is lateness."""
    parts = []
    for a in days:
        for u in units:
            o = overlap(a["start"], a["end"], u["start"], u["end"])
            if not o:
                continue
            late = a["src"].get("reason") == "Verspätung" or (
                a["start"] <= u["start"]
                and u["start"] < a["end"] < u["end"]
                and all(x is u or not overlap(a["start"], a["end"], x["start"], x["end"]) for x in units)
            )
            parts.append(
                {
                    "absenceId": a["id"],
                    "date": a["date"],
                    "start": max(a["start"], u["start"]),
                    "end": min(a["end"], u["end"]),
                    "late": late,
                    "excused": bool(a["src"].get("isExcused")),
                    "minutes": o,
                }
            )
    return parts


def build_snapshot(raw: dict) -> dict:
    units = _time_units(raw)
    days = _absence_days(raw, units)
    if raw.get("absenceTimes") is not None and raw.get("latenessTimes") is not None:
        parts = [_part(t, False) for t in raw["absenceTimes"]] + [_part(t, True) for t in raw["latenessTimes"]]
    else:
        parts = _guess_parts(days, units)

    # Every timetable entry that took place, including subject-less ones like a Lehrausgang:
    # they decide which lesson numbers an absence is listed with.
    slots = [
        {"date": from_untis_date(l["date"]), "start": to_minutes(l["startTime"]), "end": to_minutes(l["endTime"])}
        for l in raw["lessons"]
        if l.get("code") != "cancelled"
    ]
    absences = []
    for a in days:
        src = a["src"]
        own = [p for p in parts if p["absenceId"] == a["id"] and p["date"] == a["date"]]
        day_slots = [l for l in slots if l["date"] == a["date"]]
        touched = [
            u
            for u in units
            if overlap(a["start"], a["end"], u["start"], u["end"]) > 0
            and (not day_slots or any(overlap(l["start"], l["end"], u["start"], u["end"]) > 0 for l in day_slots))
        ]
        absences.append(
            {
                "id": a["id"],
                "date": a["date"],
                # Only the time that overlaps actual lessons (school may start later than the absence entry).
                "start": max(a["start"], touched[0]["start"]) if touched else a["start"],
                "end": min(a["end"], touched[-1]["end"]) if touched else a["end"],
                "excused": bool(src.get("isExcused")),
                "status": src.get("excuseStatus") or (src.get("excuse") or {}).get("excuseStatus") or None,
                "untisReason": src.get("reason") or "",
                "late": all(p["late"] for p in own) if own else src.get("reason") == "Verspätung",
                "lateMinutes": sum(p["minutes"] for p in own if p["late"]),
                "units": [u["name"] for u in touched],
            }
        )
    absences.sort(key=lambda a: a["start"])
    absences.sort(key=lambda a: a["date"], reverse=True)

    klasse = next((k["name"] for l in raw["lessons"] for k in l.get("kl") or [] if k["id"] == raw.get("klasseId")), None)
    if klasse is None:
        klasse = ((raw.get("absenceTimes") or [{}])[0]).get("klasseName") or ""
    name = raw.get("displayName") or ((raw["absences"] or [{}])[0]).get("studentName") or ""

    return {
        "fetchedAt": raw["fetchedAt"],
        "name": name,
        "klasse": klasse,
        "schoolyear": {
            "name": raw["schoolyear"]["name"],
            "start": from_untis_date(raw["schoolyear"]["startDate"]),
            "end": from_untis_date(raw["schoolyear"]["endDate"]),
        },
        "semesters": semesters(raw),
        "units": units,
        "lessons": _lessons(raw),
        "parts": parts,
        "absences": absences,
    }


def group_days(absences: list[dict]) -> list[dict]:
    """Absences grouped per day, newest day first."""
    by_date: dict[str, list[dict]] = {}
    for a in absences:
        by_date.setdefault(a["date"], []).append(a)
    return [
        {"date": d, "absences": sorted(by_date[d], key=lambda a: a["start"])} for d in sorted(by_date, reverse=True)
    ]


# ---- attendance per subject, counted in time-grid units (Stunden) -----------------------

def _lesson_units(l: dict, units: list[dict]) -> list[tuple[int, int]]:
    """Units a lesson covers (a double lesson covers two). Falls back to one unit for odd times."""
    covered = [u for u in units if overlap(l["start"], l["end"], u["start"], u["end"]) >= (u["end"] - u["start"]) / 2]
    return [(max(l["start"], u["start"]), min(l["end"], u["end"])) for u in covered] or [(l["start"], l["end"])]


def _finish(rows: list[dict]) -> list[dict]:
    for s in rows:
        s["present"] = s["held"] - s["excused"] - s["unexcused"]
        s["percent"] = s["present"] / s["held"] * 100 if s["held"] else None
    return sorted(rows, key=lambda s: (s["percent"] if s["percent"] is not None else 101, s["subject"].casefold()))


def subject_stats(lessons: list[dict], parts: list[dict], units: list[dict], start: str, end: str, now: dict) -> list[dict]:
    absent = [p for p in parts if not p["late"]]
    by_subject: dict[str, dict] = {}
    for l in lessons:
        if l["cancelled"] or l["date"] < start or l["date"] > end:
            continue
        if l["date"] > now["date"] or (l["date"] == now["date"] and l["end"] > now["minutes"]):
            continue  # not held yet
        s = by_subject.setdefault(
            l["subject"],
            {"subject": l["subject"], "subjectLong": l["subjectLong"], "held": 0, "excused": 0, "unexcused": 0, "present": 0, "percent": None},
        )
        for u_start, u_end in _lesson_units(l, units):
            s["held"] += 1
            # Absent when at least half of the unit is covered by a (non-late) absence slice.
            hit = [p for p in absent if p["date"] == l["date"] and overlap(p["start"], p["end"], u_start, u_end) > 0]
            missed = sum(overlap(p["start"], p["end"], u_start, u_end) for p in hit)
            if missed * 2 >= u_end - u_start:
                s["excused" if all(p["excused"] for p in hit) else "unexcused"] += 1
    return _finish(list(by_subject.values()))


def total_stats(stats: list[dict]) -> dict:
    t = {k: sum(s[k] for s in stats) for k in ("held", "excused", "unexcused")}
    present = t["held"] - t["excused"] - t["unexcused"]
    return {"subject": "Gesamt", "subjectLong": "Alle Fächer", **t, "present": present, "percent": present / t["held"] * 100 if t["held"] else None}


def group_stats(stats: list[dict], groups: list[dict]) -> list[dict]:
    """Merges the stats of grouped subjects (e.g. BWM = BWM1 + BWM2) into one row per group."""
    group_of = {s: g for g in groups for s in g["subjects"]}
    known = {s["subject"] for s in stats}
    merged: dict[str, dict] = {}
    out = []
    for s in stats:
        g = group_of.get(s["subject"])
        if not g:
            out.append(s)
        elif g["name"] not in merged:
            row = {**s, "subject": g["name"], "subjectLong": " + ".join(x for x in g["subjects"] if x in known)}
            merged[g["name"]] = row
            out.append(row)
        else:
            for k in ("held", "excused", "unexcused"):
                merged[g["name"]][k] += s[k]
    return _finish(out)


# ---- German formatting for the letter and the MCP output ------------------------------

def format_date(iso: str) -> str:
    y, m, d = iso.split("-")
    return f"{d}.{m}.{y}"


def format_day(iso: str) -> str:
    return f"{WEEKDAYS[weekday(iso)]}, {format_date(iso)}"


def format_time(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def format_range(start: int, end: int) -> str:
    return f"{format_time(start)} bis {format_time(end)}"


def format_units(units: list[str]) -> str:
    """["3","4","5","7"] -> "3. bis 5., 7. Stunde"; ["2"] -> "2. Stunde"."""
    if not units:
        return ""
    try:
        nums = [int(u) for u in units]
    except ValueError:
        return f"{', '.join(units)} Stunde"
    runs: list[list[int]] = []
    for n in nums:
        if runs and n == runs[-1][1] + 1:
            runs[-1][1] = n
        else:
            runs.append([n, n])
    return ", ".join(f"{a}." if a == b else f"{a}. bis {b}." for a, b in runs) + " Stunde"


# ---- storage: the last raw pull, own reasons per day, a small key/value table ---------------

_db: sqlite3.Connection | None = None


def db() -> sqlite3.Connection:
    global _db
    if _db is None:
        _db = sqlite3.connect(config.DATA_DIR / "absences.db", check_same_thread=False, isolation_level=None)
        _db.execute("PRAGMA journal_mode = WAL")
        _db.executescript(
            """
            CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), raw TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS day_notes (
              date TEXT PRIMARY KEY,
              reason TEXT NOT NULL DEFAULT '',
              updated_at TEXT NOT NULL,
              exported_at TEXT,
              asked_at TEXT
            );
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """
        )
    return _db


_cached: tuple[str, dict] | None = None


def load_snapshot() -> dict | None:
    global _cached
    row = db().execute("SELECT raw, updated_at FROM snapshot WHERE id = 1").fetchone()
    if not row:
        return None
    if not _cached or _cached[0] != row[1]:
        _cached = (row[1], build_snapshot(json.loads(row[0])))
    return _cached[1]


def save_snapshot(raw: dict) -> None:
    db().execute(
        "INSERT INTO snapshot (id, raw, updated_at) VALUES (1, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET raw = excluded.raw, updated_at = excluded.updated_at",
        (json.dumps(raw), utc_iso()),
    )


def load_notes() -> dict[str, dict]:
    rows = db().execute("SELECT date, reason, exported_at, asked_at FROM day_notes").fetchall()
    return {r[0]: {"reason": r[1], "exportedAt": r[2], "askedAt": r[3]} for r in rows}


def save_reason(day: str, reason: str) -> None:
    db().execute(
        "INSERT INTO day_notes (date, reason, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT(date) DO UPDATE SET reason = excluded.reason, updated_at = excluded.updated_at",
        (day, reason, utc_iso()),
    )


def _mark(column: str, days: list[str]) -> None:
    now = utc_iso()
    db().executemany(
        f"INSERT INTO day_notes (date, reason, updated_at, {column}) VALUES (?, '', ?, ?) "
        f"ON CONFLICT(date) DO UPDATE SET {column} = excluded.{column}",
        [(d, now, now) for d in days],
    )


def mark_exported(days: list[str]) -> None:
    _mark("exported_at", days)


def mark_asked(days: list[str]) -> None:
    """asked_at: when the assistant (MCP new_open_days) last asked for this day's reason."""
    _mark("asked_at", days)


def get_meta(key: str) -> str | None:
    row = db().execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None


def set_meta(key: str, value: str | None) -> None:
    if value is None:
        db().execute("DELETE FROM meta WHERE key = ?", (key,))
    else:
        db().execute("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))


def load_groups() -> list[dict]:
    try:
        return json.loads(get_meta("subject_groups") or "[]")
    except ValueError:
        return []


def save_group(name: str, subjects: list[str]) -> None:
    """Creates or replaces a subject group; its subjects leave any other group."""
    rest = [{**g, "subjects": [s for s in g["subjects"] if s not in subjects]} for g in load_groups() if g["name"] != name]
    groups = [g for g in rest if len(g["subjects"]) >= 2] + [{"name": name, "subjects": subjects}]
    set_meta("subject_groups", json.dumps(groups))


def delete_group(name: str) -> None:
    groups = [g for g in load_groups() if g["name"] != name]
    set_meta("subject_groups", json.dumps(groups) if groups else None)


# ---- WebUntis login (DATA_DIR/untis.json, 0600, next to the Microsoft token) -------------------

_LOGIN = config.DATA_DIR / "untis.json"


def load_login() -> dict | None:
    """{server, school, user, password, place}; place is the town printed on the letter."""
    try:
        c = json.loads(_LOGIN.read_text())
    except (OSError, ValueError):
        return None
    return c if all(c.get(k) for k in ("server", "school", "user", "password")) else None


def save_login(c: dict) -> None:
    _LOGIN.touch(mode=0o600)
    _LOGIN.chmod(0o600)
    _LOGIN.write_text(json.dumps({k: c.get(k, "") for k in ("server", "school", "user", "password", "place")}))


def login_hash(c: dict) -> str:
    """Changes whenever the stored login changes, which lifts a login block."""
    return hashlib.sha256("\0".join(c[k] for k in ("server", "school", "user", "password")).encode()).hexdigest()[:16]


def parse_server(text: str) -> tuple[str, str | None]:
    """Accepts a host or a pasted WebUntis URL; returns the host and the ?school= value if the URL had one."""
    raw = text.strip()
    try:
        url = urlsplit(raw if re.match(r"https?://", raw, re.I) else f"https://{raw}")
        host = (url.netloc or "").lower()
    except ValueError:
        return "", None
    query = parse_qs(url.query)
    if "school" not in query and "?" in url.fragment:
        query = parse_qs(url.fragment.split("?", 1)[1])
    return host, (query.get("school") or [None])[0]


_cooldown_until = 0.0


async def set_login(server: str, school: str, user: str, password: str, place: str) -> None:
    """Stores the login after one check at WebUntis (only when it changed). Raises ValueError with a message."""
    global _cooldown_until
    old = load_login()
    host, url_school = parse_server(server)
    new = {
        "server": host,
        "school": school.strip() or url_school or "",
        "user": user.strip(),
        "password": password or (old or {}).get("password", ""),
        "place": place.strip(),
    }
    if new["server"] and not new["school"]:
        new["school"] = await untis.find_school(new["server"]) or ""
    if not all(new[k] for k in ("server", "school", "user", "password")):
        raise ValueError("Fill in all fields")
    changed = not old or any(old[k] != new[k] for k in ("server", "school", "user", "password"))
    if changed:
        # After WebUntis rejected a login, wait before the next try: schools lock accounts after a few.
        if time.time() < _cooldown_until:
            raise ValueError("WebUntis just rejected a login, try again in a minute")
        try:
            try:
                await untis.check_login(new["server"], new["school"], new["user"], new["password"])
            except untis.UntisError as e:
                # WebUntis wants the school's login name ("spengergasse"), people type its real name: look it up.
                # The first try ended before any password check, so this is not a second login attempt.
                found = await untis.find_school(new["server"]) if e.unknown_school else None
                if not found or found == new["school"]:
                    raise
                new["school"] = found
                await untis.check_login(new["server"], new["school"], new["user"], new["password"])
        except untis.UntisError as e:
            if e.bad_credentials:
                _cooldown_until = time.time() + 60
                raise ValueError("WebUntis rejects the user name or password") from None
            if e.unknown_school:
                raise ValueError("School not found on this server: use its WebUntis login name (school= in the login URL)") from None
            raise ValueError(f"WebUntis not reachable: {e}") from None
    save_login(new)
    if changed:
        for key in ("auth_blocked", "last_error", "last_sync", "last_attempt"):
            set_meta(key, None)


# ---- sync: one at a time, never retries a rejected login ------------------------------------

STALE_AFTER = 30 * 60
MIN_GAP = 60


def _age(iso: str | None) -> float:
    return time.time() - datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() if iso else float("inf")


def sync_status() -> dict:
    last = get_meta("last_sync")
    login = load_login()
    return {
        "configured": bool(login),
        "lastSync": last,
        "lastError": get_meta("last_error"),
        # Not set up counts as blocked: there is nothing to log in with.
        "blocked": not login or get_meta("auth_blocked") == login_hash(login),
        "stale": _age(last) > STALE_AFTER,
    }


_running: asyncio.Task | None = None


async def _pull() -> dict:
    global _running
    try:
        set_meta("last_attempt", utc_iso())
        login = load_login()
        try:
            raw = await untis.fetch_snapshot(login["server"], login["school"], login["user"], login["password"])
            save_snapshot(raw)
            set_meta("last_sync", raw["fetchedAt"])
            set_meta("last_error", None)
        except untis.UntisError as e:
            if e.bad_credentials:
                set_meta("auth_blocked", login_hash(login))
                set_meta("last_error", "WebUntis rejects the stored login")
            else:
                set_meta("last_error", str(e))
        return sync_status()
    finally:
        _running = None


async def sync(force: bool = False) -> dict:
    """Pulls WebUntis when the data is older than 30 min (force: now, at most once a minute)."""
    global _running
    if _running is None:
        status = sync_status()
        if status["blocked"] or (not force and not status["stale"]) or _age(get_meta("last_attempt")) < MIN_GAP:
            return status
        _running = asyncio.create_task(_pull())
    return await asyncio.shield(_running)


# ---- views shared by the website and the MCP tools ---------------------------------------

def day_views(snap: dict) -> list[dict]:
    notes = load_notes()
    out = []
    for d in group_days(snap["absences"]):
        note = notes.get(d["date"]) or {}
        excused = sum(1 for a in d["absences"] if a["excused"])
        out.append(
            {
                "date": d["date"],
                "status": "excused" if excused == len(d["absences"]) else "partial" if excused else "open",
                "onlyLate": all(a["late"] for a in d["absences"]),
                "reason": note.get("reason") or "",
                "exportedAt": note.get("exportedAt"),
                "askedAt": note.get("askedAt"),
                "absences": d["absences"],
            }
        )
    return out


def pick_range(snap: dict, which: str | None, start: str | None = None, end: str | None = None) -> dict:
    """semester (the current one, default), s1, s2, year, or custom with start and end."""
    s1, s2 = snap["semesters"]
    current = "s2" if today_iso() >= s2["start"] else "s1"
    if start and end and ISO.match(start) and ISO.match(end):
        return {"key": "custom", "start": start, "end": end, "label": f"{start} bis {end}", "current": current}
    key = which if which in ("s1", "s2", "year") else current
    sem = {"s1": s1, "s2": s2}.get(key)
    if sem:
        return {"key": key, "start": sem["start"], "end": sem["end"], "label": sem["name"], "current": current}
    return {"key": "year", "start": snap["schoolyear"]["start"], "end": snap["schoolyear"]["end"], "label": "Schuljahr", "current": current}


def attendance(snap: dict, rng: dict) -> tuple[dict, list[dict]]:
    stats = subject_stats(snap["lessons"], snap["parts"], snap["units"], rng["start"], rng["end"], untis.vienna_now())
    stats = group_stats(stats, load_groups())
    return total_stats(stats), stats


def check_letter(dates: list[str]) -> dict:
    """Checks that every date has absences and a reason. Raises ValueError (German: it reaches the owner)."""
    snap = load_snapshot()
    wanted = {d for d in dates if ISO.match(d)}
    if not snap or not wanted:
        raise ValueError("Keine Tage ausgewählt")
    days = sorted((d for d in day_views(snap) if d["date"] in wanted), key=lambda d: d["date"])
    if not days:
        raise ValueError("Keine Abwesenheiten an diesen Tagen")
    missing = [d["date"] for d in days if not d["reason"].strip()]
    if missing:
        raise ValueError(f"Für jeden Tag braucht es einen Grund (fehlt: {', '.join(missing)})")
    return {"name": snap["name"], "klasse": snap["klasse"], "days": days}

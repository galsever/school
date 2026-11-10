"""The school Moodle through the mobile app web service (`moodle_mobile_app`): login, calls, files and the API shapes.

Every read goes through a short cache (CACHE_SECONDS); `drop_cache()` is the reload button. A rejected password is
stored as blocked and never tried again until the login is changed, so a typo cannot lock the account.
"""

import asyncio
import hashlib
import html
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qsl, quote, unquote, urlencode, urljoin, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import httpx

from . import config

SERVICE = "moodle_mobile_app"
DEFAULT_URL = "https://moodle.spengergasse.at"
MAX_DOWNLOAD = 60 * 1024 * 1024  # files read into memory (text for the model, files kept in a submission); the container has 512 MB
CACHE_SECONDS = 60
TZ = ZoneInfo("Europe/Vienna")

_LOGIN = config.DATA_DIR / "moodle.json"
_STATE = config.DATA_DIR / "moodle-token.json"


class _NoToken(logging.Filter):
    """File addresses carry the web service token: httpx logs every request line, so the token is blanked there."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(re.sub(r"token=[^&\s\"]+", "token=***", str(a)) if "token=" in str(a) else a for a in record.args)
        return True


logging.getLogger("httpx").addFilter(_NoToken())


class MoodleError(Exception):
    """An error Moodle answered, or our own (code not_connected, invalidlogin, bad_url, ...)."""

    def __init__(self, message: str, code: str = ""):
        super().__init__(message)
        self.code = code

    @property
    def not_connected(self) -> bool:
        return self.code in ("not_connected", "invalidlogin")


# ---- login and token -----------------------------------------------------------------

def load_login() -> dict | None:
    """{url, user, password}. Without a stored login the environment counts (MOODLE_USERNAME, MOODLE_PASSWORD: development)."""
    try:
        c = json.loads(_LOGIN.read_text())
    except (OSError, ValueError):
        c = {"user": os.environ.get("MOODLE_USERNAME", ""), "password": os.environ.get("MOODLE_PASSWORD", "")}
    c["url"] = (c.get("url") or os.environ.get("MOODLE_URL") or DEFAULT_URL).rstrip("/")
    return c if c.get("user") and c.get("password") else None


def login_hash(c: dict) -> str:
    return hashlib.sha256(f"{c['url']}|{c['user']}|{c['password']}".encode()).hexdigest()


_state: dict | None = None
_lock = asyncio.Lock()
_site: dict | None = None
_http: httpx.AsyncClient | None = None


def http() -> httpx.AsyncClient:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(timeout=60)
    return _http


def _read_state() -> dict:
    global _state
    if _state is None:
        try:
            _state = json.loads(_STATE.read_text())
        except (OSError, ValueError):
            _state = {}
    return _state


def _write_state(state: dict) -> None:
    global _state, _site
    _state, _site = state, None
    _STATE.touch(mode=0o600)
    _STATE.chmod(0o600)
    _STATE.write_text(json.dumps(state))


async def _fetch_token(login: dict) -> str:
    """One login at Moodle. Raises MoodleError; code invalidlogin = wrong user or password."""
    try:
        r = await http().post(
            f"{login['url']}/login/token.php",
            data={"username": login["user"], "password": login["password"], "service": SERVICE},
        )
        out = r.json()
    except (httpx.HTTPError, ValueError) as e:
        raise MoodleError(f"Moodle login failed: {e or type(e).__name__}", "network") from None
    if not out.get("token"):
        raise MoodleError(out.get("error") or out.get("message") or "Moodle login failed", out.get("errorcode") or "")
    return out["token"]


async def _token(rejected: str | None = None) -> str:
    login = load_login()
    if not login:
        raise MoodleError("Moodle is not connected", "not_connected")
    key = login_hash(login)
    async with _lock:
        state = _read_state()
        if state.get("blocked") == key:
            raise MoodleError("Moodle rejects the stored login", "invalidlogin")
        if state.get("key") == key and state.get("token") and state["token"] != rejected:
            return state["token"]
        try:
            token = await _fetch_token(login)
        except MoodleError as e:
            if e.code == "invalidlogin":
                _write_state({"blocked": key})
            raise
        _write_state({"key": key, "token": token})
        return token


def status() -> dict:
    login = load_login()
    return {
        "configured": bool(login),
        "url": login["url"] if login else DEFAULT_URL,
        "user": login["user"] if login else "",
        "blocked": bool(login) and _read_state().get("blocked") == login_hash(login),
    }


async def set_login(url: str, user: str, password: str) -> None:
    """Stores the login after one check at Moodle. An empty password keeps the stored one. Raises ValueError."""
    old = load_login() or {}
    new = {
        "url": (url.strip() or old.get("url") or DEFAULT_URL).rstrip("/"),
        "user": user.strip(),
        "password": password or old.get("password", ""),
    }
    if not re.match(r"^https://[^/\s]+(/[^\s]*)?$", new["url"]):
        raise ValueError("The Moodle address must start with https://")
    if not new["user"] or not new["password"]:
        raise ValueError("User and password are needed")
    if _read_state().get("blocked") == login_hash(new):
        raise ValueError("Moodle already rejected this login")
    try:
        token = await _fetch_token(new)
    except MoodleError as e:
        raise ValueError("Wrong user or password" if e.code == "invalidlogin" else str(e)) from None
    _LOGIN.touch(mode=0o600)
    _LOGIN.chmod(0o600)
    _LOGIN.write_text(json.dumps(new))
    _write_state({"key": login_hash(new), "token": token})
    drop_cache()


# ---- web service calls ---------------------------------------------------------------

def _flatten(prefix: str, value, out: dict) -> None:
    """Nested params the way Moodle expects them: a[0][b]=c."""
    if isinstance(value, dict):
        for k in sorted(value):
            _flatten(f"{prefix}[{k}]" if prefix else str(k), value[k], out)
    elif isinstance(value, (list, tuple)):
        for i, v in enumerate(value):
            _flatten(f"{prefix}[{i}]", v, out)
    elif isinstance(value, bool):
        out[prefix] = "1" if value else "0"
    elif value is not None:
        out[prefix] = str(value)


def _raise_if_error(body) -> None:
    if isinstance(body, dict) and (body.get("exception") or body.get("errorcode")):
        raise MoodleError(body.get("message") or body.get("error") or "Moodle error", body.get("errorcode") or "")


async def _with_token(run):
    """Runs run(token); a token Moodle no longer accepts is replaced once."""
    token = await _token()
    try:
        return await run(token)
    except MoodleError as e:
        if e.code != "invalidtoken":
            raise
    return await run(await _token(rejected=token))


async def call(fn: str, params: dict | None = None):
    async def run(token: str):
        form: dict = {}
        _flatten("", params or {}, form)
        form.update(wstoken=token, wsfunction=fn, moodlewsrestformat="json")
        base = load_login()["url"]
        try:
            r = await http().post(f"{base}/webservice/rest/server.php", data=form)
        except httpx.HTTPError as e:
            raise MoodleError(f"Moodle does not answer: {e or type(e).__name__}", "network") from None
        if r.status_code != 200:
            raise MoodleError(f"{fn}: HTTP {r.status_code}", "http")
        try:
            body = r.json()
        except ValueError:
            raise MoodleError(f"{fn}: no JSON answer", "http") from None
        _raise_if_error(body)
        return body

    return await _with_token(run)


_cache: dict[str, tuple[float, object]] = {}
_flying: dict[str, asyncio.Future] = {}


async def cached(fn: str, params: dict | None = None):
    """call() with a cache of CACHE_SECONDS; the same call running twice at once is sent once."""
    key = fn + json.dumps(params or {}, sort_keys=True)
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    task = _flying.get(key)
    if task is None:
        async def run():
            try:
                value = await call(fn, params)
                _cache[key] = (time.monotonic(), value)
                return value
            finally:
                _flying.pop(key, None)

        task = _flying[key] = asyncio.ensure_future(run())
    return await asyncio.shield(task)


def drop_cache() -> None:
    _cache.clear()


async def site() -> dict:
    global _site
    if _site is None:
        _site = await call("core_webservice_get_site_info")
    return _site


# ---- files ---------------------------------------------------------------------------

def _file_url(raw: str, token: str) -> str:
    """Checks that raw is a file of this Moodle (the token must never leave the site) and adds the token."""
    base = urlsplit(load_login()["url"])
    u = urlsplit(urljoin(base.geturl() + "/", raw))
    if (u.scheme, u.netloc) != (base.scheme, base.netloc):
        raise MoodleError(f"Not a file on {base.netloc}", "bad_url")
    root = base.path.rstrip("/")
    path = u.path
    if path.startswith(root + "/pluginfile.php/"):
        path = root + "/webservice" + path[len(root):]
    elif not path.startswith((root + "/webservice/pluginfile.php/", root + "/tokenpluginfile.php/")):
        raise MoodleError("Not a Moodle file (pluginfile.php)", "bad_url")
    query = [(k, v) for k, v in parse_qsl(u.query) if k not in ("token", "forcedownload")] + [("token", token)]
    return urlunsplit((u.scheme, u.netloc, path, urlencode(query), ""))


def _disposition_name(cd: str) -> str:
    for part in cd.split(";"):
        part = part.strip()
        if part.startswith("filename*=UTF-8''"):
            return unquote(part[len("filename*=UTF-8''"):])
        if part.startswith("filename="):
            return part[len("filename="):].strip('"')
    return ""


def _plain_size(resp: httpx.Response) -> str | None:
    """Content-Length of the body as we pass it on: httpx unpacks gzip, so a compressed length would be wrong."""
    if resp.headers.get("content-encoding", "identity").strip().lower() != "identity":
        return None
    return resp.headers.get("content-length")


async def open_file(raw: str):
    """(name, media type, size or None, async byte iterator) of a Moodle file."""

    async def run(token: str):
        url = _file_url(raw, token)
        try:
            resp = await http().send(http().build_request("GET", url, timeout=120), stream=True)
        except httpx.HTTPError as e:
            raise MoodleError(f"Moodle does not answer: {e or type(e).__name__}", "network") from None
        mime = resp.headers.get("content-type", "application/octet-stream").split(";")[0].strip()
        # Moodle answers file errors with a JSON exception and HTTP 200 or 404.
        if mime == "application/json" or resp.status_code != 200:
            data = await resp.aread()
            await resp.aclose()
            try:
                _raise_if_error(json.loads(data))
            except ValueError:
                pass
            if resp.status_code != 200:
                raise MoodleError(f"File: HTTP {resp.status_code}", "not_found" if resp.status_code == 404 else "http")
            raise MoodleError("File: unexpected answer", "http")
        name = _disposition_name(resp.headers.get("content-disposition", "")) or unquote(Path(urlsplit(url).path).name)
        size = _plain_size(resp)

        async def body():
            try:
                async for chunk in resp.aiter_bytes():
                    yield chunk
            finally:
                await resp.aclose()

        return name, mime, int(size) if size and size.isdigit() else None, body()

    return await _with_token(run)


async def download(raw: str) -> tuple[str, str, bytes]:
    """(name, media type, bytes), at most MAX_DOWNLOAD."""
    name, mime, _, body = await open_file(raw)
    data = bytearray()
    async for chunk in body:
        data += chunk
        if len(data) > MAX_DOWNLOAD:
            await body.aclose()
            raise MoodleError(f"File is larger than {MAX_DOWNLOAD >> 20} MB", "too_big")
    return name, mime, bytes(data)


async def upload(item_id: int, name: str, content) -> int:
    """Puts a file (bytes or an open binary file) into a draft area and returns its item id; item id 0 makes a new area."""

    async def run(token: str):
        if hasattr(content, "seek"):
            content.seek(0)
        try:
            r = await http().post(
                f"{load_login()['url']}/webservice/upload.php",
                data={"token": token, "filearea": "draft", "itemid": str(item_id)},
                files={"file_1": (name, content, "application/octet-stream")},
                timeout=300,
            )
            body = r.json()
        except (httpx.HTTPError, ValueError) as e:
            raise MoodleError(f"Upload failed: {e or type(e).__name__}", "network") from None
        _raise_if_error(body)
        if not isinstance(body, list) or not body or "itemid" not in body[0]:
            raise MoodleError("Upload: unexpected answer", "http")
        return int(body[0]["itemid"])

    return await _with_token(run)


# ---- text helpers --------------------------------------------------------------------

def plain(s: str | None) -> str:
    """Moodle names carry HTML entities (&amp;)."""
    return html.unescape(s or "").strip()


def iso(unix: int | None) -> str | None:
    return datetime.fromtimestamp(unix, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if unix and unix > 0 else None


_BLOCKS = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "table", "ul", "ol"}
_SKIP = {"script", "style", "head"}


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.skip = 0
        self.links: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in _SKIP:
            self.skip += 1
        elif tag == "br":
            self.out.append("\n")
        elif tag == "li":
            self.out.append("\n- ")
        elif tag in _BLOCKS or tag == "tr":
            self.out.append("\n")
        elif tag in ("td", "th"):
            self.out.append(" | ")
        elif tag == "a":
            self.links.append(a.get("href") or "")
        elif tag == "img" and a.get("alt"):
            self.out.append(f"[image: {a['alt']}]")

    def handle_endtag(self, tag):
        if tag in _SKIP:
            self.skip = max(0, self.skip - 1)
        elif tag in _BLOCKS:
            self.out.append("\n")
        elif tag == "a" and self.links:
            href = self.links.pop()
            if href and not href.startswith("#") and href not in "".join(self.out[-3:]):
                self.out.append(f" ({href})")

    def handle_data(self, data):
        if self.skip or not data.strip():
            if not self.skip and data and self.out and not self.out[-1].endswith((" ", "\n")):
                self.out.append(" ")
            return
        lead = " " if data[0].isspace() and self.out and not self.out[-1].endswith((" ", "\n")) else ""
        self.out.append(lead + " ".join(data.split()) + (" " if data[-1].isspace() else ""))


def html_text(s: str | None) -> str:
    """Moodle HTML (intros, summaries, feedback) as readable plain text."""
    s = s or ""
    if "<" not in s and "&" not in s:
        return s.strip()
    p = _Text()
    p.feed(s)
    p.close()
    lines = [line.strip() for line in "".join(p.out).split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def view_url(file_url: str) -> str:
    """The hub address that streams a Moodle file to the browser."""
    return "/api/moodle/file?url=" + quote(file_url, safe="")


_EMBED = re.compile(r'\b(src|href)=(["\'])(https?://[^"\']+?/(?:webservice/)?pluginfile\.php/[^"\']*)\2', re.I)


def local_html(s: str | None) -> str:
    """Moodle HTML for the website: embedded files and images point at the hub (they need the token)."""
    return _EMBED.sub(lambda m: f'{m.group(1)}="{view_url(html.unescape(m.group(3)))}"', s or "")


async def page_html(file_url: str) -> str:
    """The HTML of a page activity (its index.html), for the website."""
    _, _, data = await download(file_url)
    return local_html(data.decode("utf-8", "replace"))


# ---- shapes for the website and the MCP tools ----------------------------------------

def _file(c: dict) -> dict:
    path = (c.get("filepath") or "").strip("/")
    return {
        "name": f"{path}/{c.get('filename', '')}" if path else c.get("filename", ""),
        "url": c.get("fileurl", ""),
        "view": view_url(c.get("fileurl", "")),
        "mime": c.get("mimetype") or "",
        "size": c.get("filesize") or 0,
        "modified": iso(c.get("timemodified")),
    }


async def _courses_raw() -> list[dict]:
    return await cached("core_enrol_get_users_courses", {"userid": (await site())["userid"]})


async def courses(include_past: bool = False) -> list[dict]:
    """Enrolled courses, last used first; ended ones only with include_past."""
    now = time.time()
    out = []
    for c in await _courses_raw():
        ended = bool(c.get("enddate")) and c["enddate"] < now
        if ended and not include_past:
            continue
        out.append(
            {
                "id": c["id"],
                "name": plain(c.get("fullname")),
                "short": plain(c.get("shortname")),
                "progress": None if c.get("progress") is None else round(c["progress"]),
                "lastAccess": iso(c.get("lastaccess")),
                "ended": ended,
                "favourite": bool(c.get("isfavourite")),
            }
        )
    out.sort(key=lambda c: c["lastAccess"] or "", reverse=True)
    return out


async def deadlines(days: int = 14, overdue_days: int = 60) -> list[dict]:
    """Open to-dos of the dashboard timeline. Submitted work no longer shows up here."""
    hour = int(time.time()) // 3600 * 3600  # whole hours, so the cache key stays the same for a while
    out = await cached(
        "core_calendar_get_action_events_by_timesort",
        {
            "timesortfrom": hour - overdue_days * 86400,
            "timesortto": hour + 3600 + min(max(days, 1), 180) * 86400,
            "limitnum": 50,
            "limittononsuspendedevents": True,
        },
    )
    rows = []
    for e in out.get("events") or []:
        course = e.get("course") or {}
        action = e.get("action") or {}
        # Moodle 5 puts the cmid, not the activity id, into instance; the view url is the reliable source.
        cmid = dict(parse_qsl(urlsplit(e.get("url") or "").query)).get("id", "")
        rows.append(
            {
                "cmid": int(cmid) if cmid.isdigit() else None,
                "name": plain(e.get("activityname") or e.get("name")),
                "course": plain(course.get("fullname")),
                "courseId": course.get("id"),
                "type": e.get("modulename") or "",
                "due": iso(e.get("timesort")),
                "overdue": bool(e.get("overdue")),
                "action": action.get("name") if action.get("actionable") else None,
                "url": e.get("url") or "",
            }
        )
    return rows


async def course_grades() -> dict[int, str]:
    out = await cached("gradereport_overview_get_course_grades")
    return {g["courseid"]: g.get("grade") or "" for g in out.get("grades") or []}


async def home() -> dict:
    """The Moodle tab: what is open (due within half a year, or overdue for a month) and the courses with their grade."""
    cs, grades, due = await asyncio.gather(courses(), course_grades(), deadlines(180, 30))
    for c in cs:
        grade = grades.get(c["id"], "").strip()
        c["grade"] = grade if grade not in ("", "-") else None
    return {"due": due, "courses": cs}


def _module(m: dict) -> dict | None:
    visible = m.get("uservisible", True)
    if not visible and not m.get("availabilityinfo"):
        return None
    out = {
        "cmid": m["id"],
        "name": plain(m.get("name")),
        "type": m.get("modname") or "",
        "instance": m.get("instance"),
        "url": m.get("url") or "",
        "description": local_html(m.get("description")),
        "files": [],
        "link": None,
        "done": (m.get("completiondata") or {}).get("state", 0) > 0,
        "restricted": None if visible else (html_text(m.get("availabilityinfo")) or "Not available"),
        # assignments only, filled in by course(): own submission status (none, draft, submitted, reopened) and grade
        "status": None,
        "grade": None,
        # id says which date it is (duedate, allowsubmissionsfromdate, timeopen, timeclose, ...); the label is localized
        "dates": [{"id": d.get("dataid") or "", "label": plain(d.get("label")).rstrip(":"), "time": iso(d.get("timestamp"))} for d in m.get("dates") or []],
    }
    for c in m.get("contents") or []:
        if c.get("type") == "url":
            out["link"] = c.get("fileurl")
        elif c.get("type") == "file" and not c.get("isexternalfile"):
            out["files"].append(_file(c))
    return out


async def _or(coro, default):
    """The result, or default when Moodle refuses this one read (a missing login still raises)."""
    try:
        return await coro
    except MoodleError as e:
        if e.not_connected:
            raise
        return default


async def course(course_id: int) -> dict:
    """Sections and activities of one course with their files; assignments carry the own status and grade.

    `grades` lists the graded items that are not an assignment row (those show their grade on the row), `total` is
    the course total when there is one.
    """
    sections, cs, items = await asyncio.gather(
        cached("core_course_get_contents", {"courseid": course_id}), _courses_raw(), _or(grade_items(course_id), [])
    )
    name = next((plain(c.get("fullname")) for c in cs if c["id"] == course_id), "")
    out = []
    for s in sections:
        modules = [m for m in map(_module, s.get("modules") or []) if m]
        summary = local_html(s.get("summary"))
        if not modules and not html_text(summary):
            continue
        out.append({"id": s["id"], "number": s.get("section", 0), "name": plain(s.get("name")), "summary": summary, "modules": modules})

    graded = [g for g in items if g["grade"] != "-"]
    by_cmid = {g["cmid"]: g["grade"] for g in graded if g["cmid"]}
    assigns = [m for s in out for m in s["modules"] if m["type"] == "assign" and not m["restricted"] and m["instance"]]
    states = await asyncio.gather(
        *(_or(cached("mod_assign_get_submission_status", {"assignid": m["instance"]}), {}) for m in assigns)
    )
    for m, state in zip(assigns, states):
        status = _plugins(state)[0]
        m["status"] = status if status not in ("", "new") else "none"
        m["grade"] = by_cmid.get(m["cmid"])
    shown = {m["cmid"] for m in assigns}
    return {
        "id": course_id,
        "name": name,
        "total": next((g["grade"] for g in graded if g["type"] == "course"), None),
        "grades": [g for g in graded if g["type"] != "course" and g["cmid"] not in shown],
        "sections": out,
    }


def _whole(number: str) -> str:
    """100.00 -> 100 (Moodle pads whole numbers)."""
    return re.sub(r"(\d)[.,]00\b", r"\1", number)


async def grade_items(course_id: int) -> list[dict]:
    out = await cached("gradereport_user_get_grade_items", {"courseid": course_id, "userid": (await site())["userid"]})
    rows = []
    for it in ((out.get("usergrades") or [{}])[0]).get("gradeitems") or []:
        if it.get("gradeishidden"):
            continue
        kind = it.get("itemtype") or ""
        name = plain(it.get("itemname")) or {"course": "Course total", "category": "Category total"}.get(kind, "(unnamed)")
        weight = it.get("weightformatted") or ""
        rows.append(
            {
                "name": name,
                "type": it.get("itemmodule") or kind,
                "total": kind in ("course", "category"),
                "cmid": it.get("cmid") or None,
                "grade": _whole(plain(it.get("gradeformatted"))) or "-",
                "range": plain(it.get("rangeformatted")),
                "percentage": _whole(plain(it.get("percentageformatted"))),
                "weight": "" if weight == "-" else weight,
                "feedback": html_text(it.get("feedback")),
                "gradedAt": iso(it.get("gradedategraded")),
            }
        )
    return rows


# ---- web pages (plugins without an app API, e.g. publication) -----------------------------

_web_client: httpx.AsyncClient | None = None
_web_lock = asyncio.Lock()


async def _web_login(login: dict) -> httpx.AsyncClient:
    """A browser-like session on the Moodle website, logged in with the stored password (kept in memory only)."""
    c = httpx.AsyncClient(timeout=60, follow_redirects=True, headers={"User-Agent": "school-hub"})
    try:
        r = await c.get(f"{login['url']}/login/index.php")
        token = re.search(r'name="logintoken" value="([^"]+)"', r.text)
        r = await c.post(
            f"{login['url']}/login/index.php",
            data={"username": login["user"], "password": login["password"], "logintoken": token.group(1) if token else ""},
        )
    except httpx.HTTPError as e:
        await c.aclose()
        raise MoodleError(f"Moodle does not answer: {e or type(e).__name__}", "network") from None
    if "/login/" in r.url.path:
        await c.aclose()
        # the token login works with the same password, so this is Moodle refusing the website login: never retry in a loop
        raise MoodleError("Moodle refuses the website login", "web_login")
    return c


async def web(path: str, stream: bool = False, data: dict | None = None) -> httpx.Response:
    """GET (or with data POST) a page of the Moodle website with the session; logs in again once when it ran out."""
    global _web_client
    login = load_login()
    if not login:
        raise MoodleError("Moodle is not connected", "not_connected")
    for attempt in (0, 1):
        async with _web_lock:
            if _web_client is None:
                _web_client = await _web_login(login)
            c = _web_client
        try:
            method = "POST" if data is not None else "GET"
            r = await c.send(c.build_request(method, login["url"] + path, data=data), stream=stream, follow_redirects=True)
        except httpx.HTTPError as e:
            raise MoodleError(f"Moodle does not answer: {e or type(e).__name__}", "network") from None
        if "/login/" not in r.url.path:
            return r
        await r.aclose()
        async with _web_lock:
            if _web_client is c:
                _web_client = None
    raise MoodleError("Moodle website session lost", "web_login")


_TAG = re.compile(r"<[^>]+>")
_FILE_LINK = re.compile(r'<a href="[^"]*?download=(\d+)"[^>]*>(.*?)<span class="visually-hidden">', re.S)


def _cell(html_part: str) -> str:
    return " ".join(plain(_TAG.sub(" ", html_part)).split())


async def publication(cmid: int) -> dict:
    """A publication (student files folder): own files and everybody's published files, all pages."""
    own: list[dict] = []
    files: list[dict] = []
    page = 0
    while page < 20:
        r = await web(f"/mod/publication/view.php?id={cmid}&page={page}")
        h = r.text
        if page == 0:
            box = h[h.find('id="id_myfilescontainer"'):]
            box = box[: box.find("</table>")]
            own = []
            for part in box.split("<a href=")[1:]:
                link = _FILE_LINK.search("<a href=" + part)
                if link:
                    state = re.search(r'title="([^"]+)" role="img"', part)
                    own.append({"id": int(link.group(1)), "name": _cell(link.group(2)), "state": plain(state.group(1)) if state else ""})
            can_upload = 'value="Edit/upload files"' in h or "Edit/upload" in h
        table = h[h.find('class="flexible table table-striped table-hover publications"'):]
        table = table[: table.find("</table>")]
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S)[1:]:
            cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
            link = _FILE_LINK.search(row)
            if not link or len(cells) < 4:
                continue
            files.append({"id": int(link.group(1)), "name": _cell(link.group(2)), "modified": _cell(cells[2]), "by": re.sub(r"^[A-Z]{2} ", "", _cell(cells[3]))})
        if f"&amp;page={page + 1}" not in h:
            break
        page += 1
    return {"cmid": cmid, "own": own, "files": files, "canUpload": can_upload}


_HIDDEN = re.compile(r'<input name="([^"]+)" type="hidden" value="([^"]*)"')


async def _upload_form(cmid: int) -> tuple[dict, dict]:
    """Opens the publication's own Edit/upload form: (its fields, {itemid, maxfiles, maxbytes, files})."""
    h = (await web(f"/mod/publication/view.php?id={cmid}")).text
    at = h.find('name="gotoupload"')
    if at < 0:
        raise MoodleError("You cannot upload here (closed or not allowed)", "locked")
    start = h.rfind("<form", 0, at)
    fields = dict(_HIDDEN.findall(h[start:at]))
    fields["gotoupload"] = "Edit/upload files"
    page = (await web("/mod/publication/view.php", data=fields)).text
    start = page.find('name="_qf__mod_publication_upload_form"')
    if start < 0:
        raise MoodleError("Moodle did not open the upload form", "http")
    form = page[page.rfind("<form", 0, start): page.find("</form>", start)]
    fields = dict(_HIDDEN.findall(form))
    item = re.search(r'value="(\d+)" name="attachment_filemanager"', form)
    if not item:
        raise MoodleError("Moodle did not open the upload form", "http")
    fields["attachment_filemanager"] = item.group(1)
    init = page[page.find("M.form_filemanager.init"):]
    limits = {
        "itemid": int(item.group(1)),
        "maxfiles": int(m.group(1)) if (m := re.search(r'maxfiles=(-?\d+)', page)) else -1,
        "maxbytes": int(m.group(1)) if (m := re.search(r'maxbytes=(-?\d+)', page)) else -1,
        "files": re.findall(r'"filename":"((?:[^"\\]|\\.)*)","filepath":"\\/"', init[: init.find("});")]),
    }
    limits["files"] = [json.loads(f'"{n}"') for n in limits["files"]]
    return fields, limits


async def change_publication(cmid: int, add: list[tuple[str, object]] = (), remove: set[str] | None = None) -> None:
    """Changes the own files of a publication through Moodle's own form: removes by name, adds (a new file with a
    taken name replaces the old one), saves. Files here are visible to everyone in the course."""
    fields, form = await _upload_form(cmid)
    names = {name for name, _ in add}
    gone = (set(remove or ()) | names) & set(form["files"])
    left = len(form["files"]) - len(gone) + len(add)
    if form["maxfiles"] > 0 and left > form["maxfiles"]:
        raise MoodleError(f"At most {form['maxfiles']} files", "bad_request")
    if form["maxbytes"] > 0:
        for name, content in add:
            size = len(content) if isinstance(content, (bytes, bytearray)) else os.fstat(content.fileno()).st_size
            if size > form["maxbytes"]:
                raise MoodleError(f"{name} is larger than {form['maxbytes'] >> 20} MB", "bad_request")
    for name in gone:
        r = await web(
            "/repository/draftfiles_ajax.php?action=delete",
            data={"sesskey": fields["sesskey"], "itemid": form["itemid"], "filepath": "/", "filename": name},
        )
        try:
            ok = r.json()
        except ValueError:
            ok = None
        if not ok or (isinstance(ok, dict) and ok.get("error")):
            raise MoodleError(f"Could not remove {name}", "http")
    for name, content in add:
        await upload(form["itemid"], name, content)
    r = await web("/mod/publication/upload.php", data={**fields, "submitbutton": "Save changes"})
    if "/mod/publication/upload.php" in r.url.path:
        err = re.search(r'class="[^"]*(?:invalid-feedback|alert-danger|error)[^"]*"[^>]*>(.*?)</', r.text, re.S)
        raise MoodleError(_cell(err.group(1)) if err and _cell(err.group(1)) else "Moodle did not save the files", "warning")


async def publication_zip(cmid: int):
    """All published files of a publication as one zip (Moodle builds it)."""
    r = await web(f"/mod/publication/view.php?id={cmid}&action=zip&allfilespage=0", stream=True)
    mime = r.headers.get("content-type", "").split(";")[0].strip()
    if r.status_code != 200 or mime == "text/html":
        await r.aclose()
        raise MoodleError("No files to download", "not_found")
    name = _disposition_name(r.headers.get("content-disposition", "")) or "files.zip"

    async def body():
        try:
            async for chunk in r.aiter_bytes():
                yield chunk
        finally:
            await r.aclose()

    return name, mime or "application/zip", None, body()


async def publication_file(cmid: int, file_id: int):
    """(name, media type, size, body) of one file of a publication."""
    r = await web(f"/mod/publication/view.php?id={cmid}&download={file_id}", stream=True)
    mime = r.headers.get("content-type", "application/octet-stream").split(";")[0].strip()
    if r.status_code != 200 or mime == "text/html":
        await r.aclose()
        raise MoodleError("File not available", "not_found")
    name = _disposition_name(r.headers.get("content-disposition", "")) or "file"
    size = _plain_size(r)

    async def body():
        try:
            async for chunk in r.aiter_bytes():
                yield chunk
        finally:
            await r.aclose()

    return name, mime, int(size) if size and size.isdigit() else None, body()


# ---- choices -------------------------------------------------------------------------

async def _find_choice(cmid: int, course_id: int) -> dict:
    out = await cached("mod_choice_get_choices_by_courses", {"courseids": [course_id]} if course_id else {})
    for c in out.get("choices") or []:
        if c.get("coursemodule") == cmid:
            return c
    raise MoodleError("Choice not found in your courses", "not_found")


async def choice(cmid: int, course_id: int = 0) -> dict:
    """A choice activity: its options with the own pick, how many took each and (when the teacher publishes them) who."""
    c = await _find_choice(cmid, course_id)
    me = (await site())["userid"]
    opts, results = await asyncio.gather(
        cached("mod_choice_get_choice_options", {"choiceid": c["id"]}),
        _or(cached("mod_choice_get_choice_results", {"choiceid": c["id"]}), {}),
    )
    taken = {r["id"]: r for r in results.get("options") or [] if r.get("id")}
    unanswered = [plain(u.get("fullname")) for r in results.get("options") or [] if not r.get("id") for u in r.get("userresponses") or []]
    rows = opts.get("options") or []
    closed = not rows  # closed or not open yet: Moodle gives no options, only the reason
    if closed:
        rows = [{"id": r["id"], "text": r.get("text"), "maxanswers": r.get("maxanswer"), "disabled": True} for r in taken.values()]
    options = []
    for o in rows:
        r = taken.get(o["id"]) or {}
        people = [plain(u.get("fullname")) for u in r.get("userresponses") or []]
        mine = bool(o.get("checked")) or any(u.get("userid") == me for u in r.get("userresponses") or [])
        options.append(
            {
                "id": o["id"],
                "text": plain(o.get("text")),
                "checked": mine,
                "disabled": bool(o.get("disabled")),
                "count": o.get("countanswers", r.get("numberofuser")),
                "max": o.get("maxanswers") if c.get("limitanswers") and o.get("maxanswers") else None,
                "people": people,
            }
        )
    answered = any(o["checked"] for o in options)
    return {
        "id": c["id"],
        "cmid": cmid,
        "name": plain(c.get("name")),
        "intro": local_html(c.get("intro")),
        "multiple": bool(c.get("allowmultiple")),
        "answered": answered,
        # a pick can be made or changed: open, and either nothing picked yet or the teacher allows changing
        "canAnswer": not closed and (not answered or bool(c.get("allowupdate"))) and any(not o["disabled"] or o["checked"] for o in options),
        "note": "; ".join(w.get("message", "") for w in opts.get("warnings") or []) if closed else "",
        "options": options,
        # who has not picked yet (only when the teacher shows it)
        "unanswered": unanswered,
    }


async def answer_choice(cmid: int, course_id: int, option_ids: list[int]) -> None:
    c = await _find_choice(cmid, course_id)
    if not option_ids or (len(option_ids) > 1 and not c.get("allowmultiple")):
        raise MoodleError("Pick one option", "bad_request")
    try:
        out = await call("mod_choice_submit_choice_response", {"choiceid": c["id"], "responses": option_ids})
        _warnings("Choice", out.get("warnings") if isinstance(out, dict) else None)
    finally:
        drop_cache()


# ---- assignments ---------------------------------------------------------------------

def _config(a: dict, plugin: str, name: str) -> str:
    for c in a.get("configs") or []:
        if c.get("subtype") == "assignsubmission" and c.get("plugin") == plugin and c.get("name") == name:
            return c.get("value") or ""
    return ""


async def find_assignment(ref: int, course_id: int = 0, by: str = "id") -> dict:
    """The raw assignment for an assignment id or a cmid (by says which one is tried first)."""
    params = {"courseids": [course_id]} if course_id else {}
    out = await cached("mod_assign_get_assignments", params)
    found = [dict(a, coursename=plain(c.get("fullname"))) for c in out.get("courses") or [] for a in c.get("assignments") or []]
    for key in (("id", "cmid") if by == "id" else ("cmid", "id")):
        for a in found:
            if a.get(key) == ref:
                return a
    raise MoodleError("Assignment not found in your courses", "not_found")


def _plugins(status: dict) -> tuple[str, int, list[dict]]:
    """Status, time and plugins of the user's or the team's submission."""
    last = status.get("lastattempt") or {}
    sub = last.get("teamsubmission") or last.get("submission") or {}
    return sub.get("status") or "", sub.get("timemodified") or 0, sub.get("plugins") or []


def _plugin_files(plugins: list[dict], kind: str) -> list[dict]:
    return [f for p in plugins if p.get("type") == kind for area in p.get("fileareas") or [] for f in area.get("files") or []]


def _plugin_text(plugins: list[dict], kind: str) -> str:
    for p in plugins:
        if p.get("type") == kind:
            for f in p.get("editorfields") or []:
                if f.get("text"):
                    return f["text"]
    return ""


async def describe_assignment(a: dict) -> dict:
    status = await cached("mod_assign_get_submission_status", {"assignid": a["id"]})
    max_bytes = _config(a, "file", "maxsubmissionsizebytes")
    max_files = _config(a, "file", "maxfilesubmissions")
    out = {
        "id": a["id"],
        "cmid": a["cmid"],
        "courseId": a.get("course"),
        "course": a.get("coursename", ""),
        "name": plain(a.get("name")),
        "url": f"{load_login()['url']}/mod/assign/view.php?id={a['cmid']}",
        "opens": iso(a.get("allowsubmissionsfromdate")),
        "due": iso(a.get("duedate")),
        "cutoff": iso(a.get("cutoffdate")),
        "extensionDue": None,
        "description": local_html(a.get("intro")),
        "attachments": [_file(f) for f in a.get("introattachments") or []],
        "files": _config(a, "file", "enabled") == "1",
        "maxFiles": int(max_files) if max_files.isdigit() else None,
        "maxBytes": int(max_bytes) if max_bytes.isdigit() and int(max_bytes) > 0 else None,
        "fileTypes": _config(a, "file", "filetypeslist"),
        "onlineText": _config(a, "onlinetext", "enabled") == "1",
        "submitButton": a.get("submissiondrafts") == 1,
        "team": a.get("teamsubmission") == 1,
        "submission": None,
        "feedback": None,
    }
    last = status.get("lastattempt")
    if last:
        state, modified, plugins = _plugins(status)
        out["submission"] = {
            "status": state if state not in ("", "new") else "none",
            "grading": last.get("gradingstatus") or "",
            "modified": iso(modified),
            "canEdit": bool(last.get("canedit")),
            "needsSubmit": a.get("submissiondrafts") == 1 and state == "draft",
            "locked": bool(last.get("locked")),
            "files": [_file(f) for f in _plugin_files(plugins, "file")],
            "text": _plugin_text(plugins, "onlinetext"),
        }
        out["extensionDue"] = iso(last.get("extensionduedate"))
    fb = status.get("feedback")
    if fb:
        comments = [f.get("text") for p in fb.get("plugins") or [] for f in p.get("editorfields") or [] if html_text(f.get("text"))]
        files = [_file(f) for p in fb.get("plugins") or [] for area in p.get("fileareas") or [] for f in area.get("files") or []]
        grade = html_text(fb.get("gradefordisplay"))
        if grade or comments or files:
            out["feedback"] = {"grade": grade, "gradedAt": iso(fb.get("gradeddate")), "comments": local_html("<br>".join(comments)), "files": files}
    return out


def _warnings(step: str, warnings) -> None:
    if warnings:
        text = "; ".join(f"{w.get('message', '')} ({w['warningcode']})" if w.get("warningcode") else w.get("message", "") for w in warnings)
        raise MoodleError(f"{step}: {text}", "warning")


async def save_submission(
    a: dict,
    add: list[tuple[str, object]] = (),
    remove: set[str] | None = None,
    replace_files: bool = False,
    text: str | None = None,
) -> None:
    """Changes the own submission: adds files (name, bytes or open file), removes files by name, sets the online text.

    mod_assign_save_submission replaces the data of every enabled plugin, so what stays is sent again: the files
    already there are copied into a fresh draft area and the current online text goes along.
    """
    files_on = _config(a, "file", "enabled") == "1"
    text_on = _config(a, "onlinetext", "enabled") == "1"
    if add and not files_on:
        raise MoodleError("This assignment does not take files", "bad_request")
    if text is not None and not text_on:
        raise MoodleError("This assignment does not take online text", "bad_request")
    status = await call("mod_assign_get_submission_status", {"assignid": a["id"]})
    last = status.get("lastattempt")
    if not last or not last.get("canedit"):
        raise MoodleError("This submission cannot be changed (closed, locked or already submitted)", "locked")
    _, _, plugins = _plugins(status)
    plugin: dict = {}
    if files_on:
        draft = (await call("core_files_get_unused_draft_itemid"))["itemid"]
        gone = {name for name, _ in add} | (remove or set())
        if not replace_files:
            for f in _plugin_files(plugins, "file"):
                if f.get("filename") in gone:
                    continue
                _, _, data = await download(f["fileurl"])
                await upload(draft, f["filename"], data)
        for name, content in add:
            await upload(draft, name, content)
        plugin["files_filemanager"] = draft
    if text_on:
        plugin["onlinetext_editor"] = {"text": _plugin_text(plugins, "onlinetext") if text is None else text, "format": 1, "itemid": 0}
    try:
        _warnings("Save", await call("mod_assign_save_submission", {"assignmentid": a["id"], "plugindata": plugin}))
    finally:
        drop_cache()


async def submit_for_grading(a: dict) -> None:
    try:
        _warnings(
            "Submit",
            await call("mod_assign_submit_for_grading", {"assignmentid": a["id"], "acceptsubmissionstatement": True}),
        )
    finally:
        drop_cache()

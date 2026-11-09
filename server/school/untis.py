"""Minimal WebUntis client: JSON-RPC for login and master data, the web UI's REST endpoints for absences.

Schools lock accounts after failed logins, so nothing here retries a login.
One pull = login, the whole school year, logout (sessions idle out within minutes).
"""

import base64
import json
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote
from zoneinfo import ZoneInfo

import httpx

USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
VIENNA = ZoneInfo("Europe/Vienna")


class UntisError(Exception):
    def __init__(self, message: str, code: int | None = None):
        super().__init__(message)
        self.code = code

    @property
    def bad_credentials(self) -> bool:
        """Wrong username or password: never retry automatically."""
        return self.code == -8504

    @property
    def unknown_school(self) -> bool:
        """The server has no school of that login name (HTTP 404, before any password check)."""
        return self.code == 404


def to_untis_date(iso: str) -> int:
    return int(iso.replace("-", ""))


def from_untis_date(n: int) -> str:
    s = str(n)
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def add_days(iso: str, days: int) -> str:
    return (date.fromisoformat(iso) + timedelta(days=days)).isoformat()


def today_iso() -> str:
    """Today in Vienna as YYYY-MM-DD."""
    return datetime.now(VIENNA).date().isoformat()


def vienna_now() -> dict:
    """Current date and minutes since midnight in Vienna."""
    now = datetime.now(VIENNA)
    return {"date": now.date().isoformat(), "minutes": now.hour * 60 + now.minute}


def utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def chunks(start: str, end: str, days: int) -> list[tuple[str, str]]:
    """[start, end] split into pieces of at most `days` days."""
    out = []
    while start <= end:
        last = add_days(start, days - 1)
        out.append((start, min(last, end)))
        start = add_days(start, days)
    return out


class UntisSession:
    def __init__(self, server: str, school: str):
        self.base = f"https://{server}/WebUntis"
        self.school = school
        self.cookies = {"schoolname": "_" + base64.b64encode(school.encode()).decode()}
        self.http = httpx.AsyncClient(timeout=30, follow_redirects=False)
        self.rpc_id = 0
        self.person_id = 0
        self.person_type = 0
        self.klasse_id = 0

    @classmethod
    async def login(cls, server: str, school: str, user: str, password: str) -> "UntisSession":
        s = cls(server, school)
        try:
            r = await s.rpc("authenticate", {"user": user, "password": password, "client": "school"})
        except BaseException:
            await s.http.aclose()
            raise
        s.cookies["JSESSIONID"] = r["sessionId"]
        s.person_id = r.get("personId") or 0
        s.person_type = r.get("personType") or 0
        s.klasse_id = r.get("klasseId") or 0
        return s

    def _headers(self, extra: dict | None = None) -> dict:
        return {
            "User-Agent": USER_AGENT,
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json",
            "Cookie": "; ".join(f"{k}={v}" for k, v in self.cookies.items()),
            **(extra or {}),
        }

    def _keep_cookies(self, res: httpx.Response) -> None:
        for name, value in res.cookies.items():
            self.cookies[name] = value
        self.http.cookies.clear()  # the Cookie header above is the only source

    async def rpc(self, method: str, params: dict | None = None):
        self.rpc_id += 1
        try:
            res = await self.http.post(
                f"{self.base}/jsonrpc.do?school={quote(self.school, safe='')}",
                headers=self._headers(),
                json={"id": str(self.rpc_id), "method": method, "params": params or {}, "jsonrpc": "2.0"},
            )
        except httpx.HTTPError as e:
            raise UntisError(f"{method}: {type(e).__name__}") from e
        self._keep_cookies(res)
        if res.status_code == 404:
            raise UntisError(f"{method}: school not found", 404)
        if res.status_code != 200:
            raise UntisError(f"{method}: HTTP {res.status_code}")
        try:
            body = res.json()
        except ValueError:
            raise UntisError(f"{method}: no JSON answer (session expired?)") from None
        if body.get("error"):
            raise UntisError(f"{method}: {body['error'].get('message')}", body["error"].get("code"))
        return body.get("result")

    async def rest(self, path: str, bearer: dict | None = None):
        """GET on the web UI's REST API (cookie session, optional bearer)."""
        extra = {}
        if bearer:
            extra["Authorization"] = f"Bearer {bearer['token']}"
            if bearer.get("tenant_id"):
                extra["Tenant-Id"] = bearer["tenant_id"]
        name = path.split("?")[0]
        try:
            res = await self.http.get(self.base + path, headers=self._headers(extra))
        except httpx.HTTPError as e:
            raise UntisError(f"{name}: {type(e).__name__}") from e
        self._keep_cookies(res)
        if res.status_code != 200:
            raise UntisError(f"{name}: HTTP {res.status_code}")
        try:
            return res.json()
        except ValueError:
            raise UntisError(f"{name}: no JSON answer") from None

    async def token(self) -> dict:
        """Short-lived JWT for /api/rest/view/v1/* (plain text response)."""
        try:
            res = await self.http.get(self.base + "/api/token/new", headers=self._headers())
        except httpx.HTTPError as e:
            raise UntisError(f"token/new: {type(e).__name__}") from e
        self._keep_cookies(res)
        if res.status_code != 200:
            raise UntisError(f"token/new: HTTP {res.status_code}")
        token = res.text.strip()
        tenant_id = None
        try:
            part = token.split(".")[1]
            payload = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
            if payload.get("tenant_id") is not None:
                tenant_id = str(payload["tenant_id"])
        except (IndexError, ValueError):
            pass  # the tenant id is optional
        return {"token": token, "tenant_id": tenant_id}

    async def logout(self) -> None:
        try:
            await self.rpc("logout")
        except UntisError:
            pass  # the session might already be gone
        finally:
            await self.http.aclose()


async def find_school(server: str) -> str | None:
    """The login name of the one school on this WebUntis host (the ?school= value), from the public school search."""
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            res = await http.post(
                "https://mobile.webuntis.com/ms/schoolquery2",
                json={"id": "1", "method": "searchSchool", "params": [{"search": server.split(".")[0]}], "jsonrpc": "2.0"},
            )
            schools = (res.json().get("result") or {}).get("schools") or []
    except (httpx.HTTPError, ValueError):
        return None
    names = [s["loginName"] for s in schools if str(s.get("server", "")).lower() == server.lower() and s.get("loginName")]
    return names[0] if len(names) == 1 else None


async def check_login(server: str, school: str, user: str, password: str) -> None:
    """One login and logout, to verify credentials before they are stored."""
    await (await UntisSession.login(server, school, user, password)).logout()


async def fetch_snapshot(server: str, school: str, user: str, password: str) -> dict:
    """Everything the absence pages need, as the raw WebUntis shapes (dates YYYYMMDD, times HHMM)."""
    s = await UntisSession.login(server, school, user, password)
    try:
        schoolyear = await s.rpc("getCurrentSchoolyear")
        holidays = await s.rpc("getHolidays")
        timegrid = await s.rpc("getTimegridUnits")

        start = from_untis_date(schoolyear["startDate"])
        end = min(today_iso(), from_untis_date(schoolyear["endDate"]))

        # Timetable in 4-week pieces, one after another (Spengergasse resets bursts of requests).
        lessons = []
        for a, b in chunks(start, end, 28):
            lessons += await s.rpc(
                "getTimetable",
                {
                    "options": {
                        "element": {"id": s.person_id, "type": s.person_type or 5},
                        "startDate": to_untis_date(a),
                        "endDate": to_untis_date(b),
                        "showInfo": True,
                        "showSubstText": True,
                        "showLsText": True,
                        "klasseFields": ["id", "name", "longname"],
                        "subjectFields": ["id", "name", "longname"],
                    }
                },
            )

        span = f"startDate={to_untis_date(start)}&endDate={to_untis_date(end)}&studentId={s.person_id}&excuseStatusId=-1"
        absences = ((await s.rest(f"/api/classreg/absences/students?{span}")).get("data") or {}).get("absences") or []

        # Per-lesson view: once without lateness (real absences), once lateness only.
        # Not every school lets students call it; the model then falls back to its own overlap logic.
        absence_times = lateness_times = None
        try:
            at = f"/api/classreg/absencetimes/student?{span}"
            absence_times = ((await s.rest(f"{at}&excludeAbsences=false&excludeLateness=true")).get("data") or {}).get("absenceTimes")
            lateness_times = ((await s.rest(f"{at}&excludeAbsences=true&excludeLateness=false")).get("data") or {}).get("absenceTimes")
        except UntisError:
            pass

        display_name = None
        try:
            app = await s.rest("/api/rest/view/v1/app/data", await s.token())
            display_name = ((app.get("user") or {}).get("person") or {}).get("displayName")
        except UntisError:
            pass

        return {
            "fetchedAt": utc_iso(),
            "personId": s.person_id,
            "klasseId": s.klasse_id,
            "displayName": display_name,
            "schoolyear": schoolyear,
            "holidays": holidays,
            "timegrid": timegrid,
            "lessons": lessons,
            "absences": absences,
            "absenceTimes": absence_times,
            "latenessTimes": lateness_times,
        }
    finally:
        await s.logout()

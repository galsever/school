# Absences

The Absences tab shows the school absences from WebUntis, keeps an own reason per day, makes the Entschuldigung PDF and counts attendance per subject. It is the former excuses app (galsever/excuses, Next.js), rewritten into the hub on 2026-11-09.

| Part | File |
|---|---|
| WebUntis client, one full pull | `server/school/untis.py` |
| model, attendance, storage, login, sync | `server/school/absences.py` |
| the letter (PDF) | `server/school/letter.py` |
| routes and MCP tools | `server/school/absences_api.py` |
| page, WebUntis card in Settings | `web/src/routes/absences.tsx`, `web/src/routes/settings.tsx`, `web/src/lib/absences.ts` |
| tests | `server/tests/test_absences.py` |

## What the user sees

- **Days** (default tab): one card per absence day, newest first. Status chip: *Excused* (every entry is excused in WebUntis), *Partly excused*, *Open*. Each entry shows its time, the lesson numbers (`Lesson 2-3`), a *Late* chip with the minutes, and the reason WebUntis has on file (`WebUntis: Krankheit`).
- **Reason**: the text field of a day is the own reason, the one that goes into the letter. It saves by itself 600 ms after typing stops (`Saving`, `Saved`, `Not saved` below the field).
- **PDF**: tick *PDF* on the days that should go into one letter (only possible with a reason), then *Create PDF* in the bar at the bottom. The file downloads and the days get the line `In a PDF since <date>`.
- **Attendance**: *Semester 1*, *Semester 2*, *Year* or an own date range. One card for the total and one per subject, lowest first. Present share above 70 % is green, from 50 % amber, below red. The bar shows present, excused (blue) and unexcused (red) lessons.
- **Group subjects** (below the cards): pick two or more subjects, give them a name, *Group*. They count as one card (BWM = BWM1 + BWM2). *Remove* splits them again. A subject is in at most one group.
- **Refresh** (round arrow, top right): pulls WebUntis now. Its tooltip shows the age of the data. Opening the page pulls by itself when the data is older than 30 minutes.
- **Settings, WebUntis card**: server (`spengergasse.webuntis.com` or a pasted login URL), school, user, password, place on the letter. Without a stored login the Absences tab only shows *Connect WebUntis*.

## The WebUntis login

Stored in `/data/untis.json` (0600): `{server, school, user, password, place}`. `place` is the town on the letter (`Wien, am ...`); empty gives `Am ...`.

Saving the card does **one** login and logout at WebUntis, and only when server, school, user or password changed. The login is stored only if that worked. An empty password field keeps the stored one.

**School means the login name**, not the real name. For Spengergasse it is `spengergasse` (the `school=` value in the WebUntis login URL); WebUntis itself calls the school "HBLVA Wien 5". A wrong name gets HTTP 404 from `jsonrpc.do` before any password check. The hub then looks the name up in the public school search (`POST https://mobile.webuntis.com/ms/schoolquery2`, method `searchSchool`, the one school whose `server` is the given host) and tries once with it. An empty school field is looked up the same way. If nothing is found: `School not found on this server`.

**Never retry a rejected login.** Spengergasse locks accounts after a few wrong passwords.

| Situation | What the hub does |
|---|---|
| WebUntis rejects user or password while saving (error code -8504) | nothing is stored, the next save is refused for 60 s |
| WebUntis rejects the *stored* login during a sync | meta `auth_blocked` = hash of the login; every sync is skipped until the login is changed in Settings |
| login changed in Settings | `auth_blocked`, `last_error`, `last_sync`, `last_attempt` are cleared, the next page open pulls |

## Sync

`absences.sync(force)`. One pull at a time: a second caller waits for the running one.

| Rule | Value |
|---|---|
| data counts as stale after | 30 min (`STALE_AFTER`) |
| shortest gap between two attempts | 60 s (`MIN_GAP`), also for the Refresh button |
| who asks without force | opening the Absences tab, the MCP tools `absence_days`, `new_open_days`, `attendance` |
| who forces | the Refresh button, the MCP tool `refresh` |

One pull is one WebUntis session, because sessions idle out within minutes (`untis.fetch_snapshot`):

1. JSON-RPC `authenticate` (`/WebUntis/jsonrpc.do?school=...`), then `getCurrentSchoolyear`, `getHolidays`, `getTimegridUnits`.
2. `getTimetable` for the own person from the first school day until today, in pieces of 28 days, one after another (the school resets bursts of requests).
3. `GET /api/classreg/absences/students?startDate=&endDate=&studentId=&excuseStatusId=-1`: the absences.
4. `GET /api/classreg/absencetimes/student`, twice: with `excludeLateness=true` (real absences per lesson) and with `excludeAbsences=true` (lateness per lesson). WebUntis decides what is lateness: 20 min late was lateness, 37 min late an absence. Schools that do not allow this call are handled, see the model.
5. `GET /api/token/new` and `GET /api/rest/view/v1/app/data` for the display name.
6. `logout`.

The raw answer is stored as it came (`snapshot.raw`), not the model built from it. A fix in the model therefore shows up without a new pull.

## From the raw pull to days (`build_snapshot`)

Times are minutes since midnight, dates `YYYY-MM-DD`.

- **Lesson grid**: the time grid of the weekday with the most lessons (it is the same every day at Spengergasse).
- **Lessons**: timetable entries with a subject. Entries without one (Lehrausgang, events) are not part of the attendance numbers, but they still decide which lesson numbers an absence is listed with.
- **Absence per day**: an absence over several days becomes one entry per weekday (Saturday and Sunday are skipped).
- **Slices**: the per-lesson pieces from step 4. A slice is `late` or not, `excused` or not. Without that endpoint the slices are guessed: an absence that starts at a lesson's start, ends before its end and touches no other lesson is lateness.
- **Late**: an entry is *late* when all its slices are late. `lateMinutes` also counts lateness inside a longer absence (`incl. 13 min late`).
- **Lesson numbers and shown time**: the grid lessons the absence overlaps, on days with a timetable only those that had a lesson. The shown time is cut to them, because school may start later than the absence entry.
- **Semesters**: semester 1 ends the day before the holiday whose name contains "Semester", semester 2 starts the day after it. Without such a holiday: the first full week of February.

## Attendance (`subject_stats`)

Counted in grid lessons, never in minutes.

1. A timetable lesson counts once per grid lesson it covers at least half of (a double lesson counts twice).
2. *Held* = not cancelled, inside the range, and already over (Vienna time).
3. A held lesson is *absent* when slices that are not late cover at least half of it. It is *excused* when all those slices are excused, otherwise *unexcused*. Lateness never makes a lesson absent.
4. `percent = present / held * 100`, `present = held - excused - unexcused`.
5. Grouped subjects are added up into one row named after the group.

## The letter (`letter.py`)

German, A4, Helvetica, made with reportlab. Name and class top left, `<place>, am <date>` top right, title *Entschuldigung*, a table (Datum, Uhrzeit, Stunden, Grund), the closing and 140 pt of empty space for the ID Austria signature. No subjects in it. File name `Entschuldigung_<Name>_<date>.pdf`.

Every day needs a reason, otherwise the request fails with the list of days that lack one. Making the PDF sets `exported_at` on its days.

## Storage

`/data/absences.db` (SQLite, WAL):

| Table | Content |
|---|---|
| `snapshot` | one row: `raw` (the last pull as JSON), `updated_at` |
| `day_notes` | per date: `reason`, `updated_at`, `exported_at` (in a PDF), `asked_at` (the assistant asked for the reason) |
| `meta` | `last_sync`, `last_attempt`, `last_error`, `auth_blocked`, `subject_groups` (JSON `[{name, subjects}]`) |

## MCP tools

Same shapes as the old excuses MCP. All answers are JSON text with a `sync` object `{last_sync, error, login_blocked}`.

| Tool | Arguments | Returns |
|---|---|---|
| `absence_days` | `from`, `to`, `open_only` | `days[]`: `date`, `weekday`, `absences[] {time, lessons, subjects, late, late_minutes, webuntis, webuntis_reason}`, `excused`, `only_late`, `reason`, `exported_at`, `asked_at` |
| `new_open_days` | none | open days of the last 14 days that this tool has not returned before; marks them `asked_at` |
| `set_reason` | `date`, `reason` | saves the own reason; an empty one clears it; fails when the date has no absence |
| `attendance` | `range` (semester, s1, s2, year) or `from` + `to` | `range`, `total`, `subjects[] {subject, name, held, present, excused, unexcused, present_percent}` |
| `excuse_pdf` | `dates[]` | `url`: a signed link valid 15 min (`/api/mcp/pdf`, HMAC with the MCP token, no login); downloading marks the days exported |
| `refresh` | none | pulls now |

*Open* = not excused in WebUntis, no own reason, not in a PDF yet.

## What changed against the excuses app

| | excuses | hub |
|---|---|---|
| stack | Next.js 16, better-sqlite3, @react-pdf | FastAPI, sqlite3, reportlab, React page in the hub |
| app login | own login with the WebUntis user, setup code from the pod log | none: Pocket ID gate in front, like the rest of the hub |
| WebUntis login | AES-256-GCM in the database, key file next to it | `/data/untis.json` (0600), next to the Microsoft token |
| website | German | English like the hub; the letter stays German |
| where | k3s on ovh-3 (`p-excuses`), excuses.galsever.com | ghs, school.galsever.com/absences |
| MCP | own endpoint and token | part of the hub's `/api/mcp` |

Moved over on 2026-11-09: the last pull, all reasons with their `exported_at` and `asked_at`, the subject groups and `last_sync`. Not moved: the WebUntis password (it was encrypted for the old app's key), so it was entered again in Settings. The model was checked against the old TypeScript on a real pull, with and without the per-lesson endpoint: identical days, slices, attendance numbers and formatted texts.

## Testing without WebUntis

Never log in at WebUntis from a test or a script. The tests build a small pull by hand:

```
cd server && ../.venv/bin/python -m pytest tests/test_absences.py
```

To look at the page with real data and no login, seed an empty data folder with a saved pull and block the sync:

```
cd server && PYTHONPATH=. DATA_DIR=/path/to/empty APP_AUTH=none ../.venv/bin/python - <<'EOF'
import json
from school import absences as ab
ab.save_snapshot(json.load(open("/path/to/pull.json")))      # the raw shape of untis.fetch_snapshot
ab.set_meta("last_sync", ab.utc_iso())
ab.save_login({"server": "x.webuntis.com", "school": "s", "user": "u", "password": "p", "place": "Wien"})
ab.set_meta("auth_blocked", ab.login_hash(ab.load_login()))  # the sync is skipped, nothing reaches WebUntis
EOF
```

Then start the server with that `DATA_DIR`. A pull of the live data: `snapshot.raw` in `/data/absences.db`. For screenshots: Playwright with the Chrome headless shell under `~/.cache/ms-playwright`, and answer `/api/chats` and `/api/ms/status` in the page (`page.route`) so no Microsoft account is needed.

## Not done

- Nothing is written to WebUntis: an excuse is not handed in there, the signed PDF still goes to the teacher by hand.
- Only the current school year.
- Timetable, exams and homework are MCP tools only (`server/school/timetable.py`, the former Go untis-mcp; same login and block, 5 min cache), not in the web UI.

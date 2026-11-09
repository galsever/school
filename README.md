# School

Personal school hub for HTL Spengergasse at **https://school.galsever.com** (tailnet only, Pocket ID login): a fast Microsoft Teams client (chats, channels, meeting chats, teams, assignments), the school mail, the WebUntis absences with own reasons per day, the Entschuldigung PDF and attendance per subject (the former excuses app), and the school Moodle (courses, files, assignments with hand-in, grades). One MCP endpoint at `/api/mcp` for all of it.

- Server: Python 3.12, FastAPI, httpx. Talks to Microsoft, WebUntis and Moodle directly, no browser, no app registration.
- Website: React 19, TypeScript, Tailwind, shadcn/ui, TanStack Router / Query (same stack as earworm). Contract: [docs/API.md](docs/API.md).
- Android app: planned, native Kotlin like earworm, same API.

## What it does

| Tab | What you get |
|---|---|
| Chats | 1:1 and group chats, meeting chats: read, send, unread state, desktop notifications, images full screen on click |
| Teams | class teams with their channels, posts and files (Office files open as PDF), class assignments next to the main channel |
| Assignments | all assignments by due date, instructions, material, own work: upload, turn in, undo |
| Mail | school Outlook: inbox, sent, archive, search, read, attachments, reply, new mail. Details: [docs/MAIL.md](docs/MAIL.md) |
| Absences | WebUntis absences with own reasons per day, the Entschuldigung PDF, attendance per subject |
| Moodle | courses with their files (one click opens a file), search over all courses, assignments with upload and submit, grades |
| Settings | Microsoft account, WebUntis login, Moodle login, notifications |

**Own names and hiding (Teams tab).** Right click a team or channel (long press on the phone): *Rename* gives it your own display name, *Hide* moves it into the folded *Hidden* group at the bottom of the list (*Show* brings it back).
- The name is used everywhere: teams list, channel header, class name in assignments, notifications, MCP tools. Search finds both your name and Microsoft's. An empty name puts Microsoft's back.
- Hidden also means muted: never unread, no notification. Assignments of a hidden class stay in the Assignments tab.
- Stored on the server (`/data/prefs.json`), so every device shows the same. Microsoft never sees it.

## Data

Everything the app keeps is in the `data` volume (`/data`):

| File | What |
|---|---|
| `tokens.json` | Microsoft refresh token of the school account: treat it like a password |
| `prefs.json` | own display names and hidden flags: `{names: {id: name}, hidden: [id]}`, keys are team ids and channel ids |
| `untis.json` | WebUntis login (0600) |
| `absences.db` | SQLite: the raw WebUntis pull, own reasons per day, subject groups |
| `moodle.json`, `moodle-token.json` | Moodle login (0600) and the web service token it got |
| `moodle-uploads/` | files on their way into a Moodle submission, removed after an hour |
| `mcp-token` | bearer token of the MCP endpoint |
| `session-secret`, `app-password` | only used with `APP_AUTH=password` |

## Microsoft sign-in

Once, in the app under `/connect`: a device code you enter on microsoft.com/devicelogin with the school account. The server signs in as the official Teams public client (`1fec8e78-bce4-4aaf-ab1b-5451cc387264`), so the school tenant needs no consent. One refresh token (`/data/tokens.json`, 0600) is exchanged per resource:

| Resource | Used for |
|---|---|
| `api.spaces.skype.com` -> authsvc skype token | chat service: chats, channels, meeting chats, send, read state |
| `graph.microsoft.com` | me, people names, joined teams and channels, files, mail (Mail.ReadWrite and Mail.Send are in the Teams client's token) |
| same Graph token on `assignments.onenote.com/api/v1.0/edu` | assignments and submissions (Graph's own `/education` is refused for this client) |

## WebUntis

The login (server, school, user, password, place for the letter) is entered once under Settings and checked once at WebUntis before it is stored (`/data/untis.json`, 0600). Each sync is one login, the whole school year, and a logout; data older than 30 minutes is pulled when the Absences page or an MCP tool asks. A rejected login blocks all syncing until the login is changed: the school locks accounts, so nothing retries. The raw pull, the own reasons per day and the subject groups live in `/data/absences.db` (SQLite).

## Moodle

The login (user, password) is entered once under Settings and checked once at Moodle before it is stored
(`/data/moodle.json`, 0600). The server talks to the mobile app web service (`moodle_mobile_app`) with a token it gets
from that login; a rejected login blocks every call until the login is changed, so a typo cannot lock the account.

- **Fast by design.** Every read is cached for 60 s on the server, the same read running twice is sent once, and the
  browser keeps the last answer (localStorage), so the tab paints at once and refreshes in the background. Opening
  the tab reads every course, so a course opens without waiting and the search covers all files. The reload button
  empties the server cache.
- **Two screens.** The course list (with what is due on top and a search over all courses) and one course (content or
  grades). An assignment opens next to its course: task, material, own work with drag and drop, submit, feedback.
- **Hand-in.** Moodle replaces the whole submission on every save, so the server copies the files already there into
  the new draft and sends the current online text along. Assignments with a submit button stay a draft until Submit.
- Files and embedded images are streamed through the server (`/api/moodle/file`), because they need the token; only
  addresses on the Moodle itself are fetched, and the token is blanked in the request log.

## How it runs

- Home server `ghs`, Docker Compose project `school`, deployed by doco-cd (every commit on `main` goes live within about a minute).
- `school.galsever.com` is a personal-infra app (`apps/school-hub`): relay in k3s behind the tailnet gateway and the Pocket ID gate, forwarding to `ghs:8788`. The app has no own login (`APP_AUTH=none`). The old name teams.galsever.com still reaches it: pages redirect, API and MCP calls are answered.

## Develop

```
python3 -m venv .venv && .venv/bin/pip install -r server/requirements.txt
cd server && DATA_DIR=../data APP_AUTH=none SECURE_COOKIES=0 ../.venv/bin/uvicorn school.main:app
cd server && ../.venv/bin/python -m pytest tests
cd web && npm install && npm run dev   # proxies /api to 127.0.0.1:8000
```

`npm run build` (in `web/`) must pass before a push. It is the real school account: never test send, reply, turn-in or delete without asking. Reading is safe; for mail use `mail.get_mail(id, mark_read=False)` so nothing gets marked read. How to test the mail view without a browser: [docs/MAIL.md](docs/MAIL.md).

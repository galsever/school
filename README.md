# School

Personal school hub for HTL Spengergasse at **https://school.galsever.com** (tailnet only, Pocket ID login): a fast Microsoft Teams client (chats, channels, meeting chats, teams, assignments), the school mail, and the WebUntis absences with own reasons per day, the Entschuldigung PDF and attendance per subject (the former excuses app). One MCP endpoint at `/api/mcp` for all of it.

- Server: Python 3.12, FastAPI, httpx. Talks to Microsoft and WebUntis directly, no browser, no app registration.
- Website: React 19, TypeScript, Tailwind, shadcn/ui, TanStack Router / Query (same stack as earworm). Contract: [docs/API.md](docs/API.md).
- Android app: planned, native Kotlin like earworm, same API.

## Microsoft sign-in

Once, in the app under `/connect`: a device code you enter on microsoft.com/devicelogin with the school account. The server signs in as the official Teams public client (`1fec8e78-bce4-4aaf-ab1b-5451cc387264`), so the school tenant needs no consent. One refresh token (`/data/tokens.json`, 0600) is exchanged per resource:

| Resource | Used for |
|---|---|
| `api.spaces.skype.com` -> authsvc skype token | chat service: chats, channels, meeting chats, send, read state |
| `graph.microsoft.com` | me, people names, joined teams and channels, files |
| same Graph token on `assignments.onenote.com/api/v1.0/edu` | assignments and submissions (Graph's own `/education` is refused for this client) |

## WebUntis

The login (server, school, user, password, place for the letter) is entered once under Settings and checked once at WebUntis before it is stored (`/data/untis.json`, 0600). Each sync is one login, the whole school year, and a logout; data older than 30 minutes is pulled when the Absences page or an MCP tool asks. A rejected login blocks all syncing until the login is changed: the school locks accounts, so nothing retries. The raw pull, the own reasons per day and the subject groups live in `/data/absences.db` (SQLite).

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

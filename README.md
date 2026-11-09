# Teams

Fast personal Microsoft Teams client for the Spengergasse school account at **https://teams.galsever.com** (tailnet only, Pocket ID login). Chats, channels, meetings chat, teams and assignments; nothing of the official client's bloat.

- Server: Python 3.12, FastAPI, httpx. Talks to Microsoft directly, no browser, no app registration.
- Website: React 19, TypeScript, Tailwind, shadcn/ui, TanStack Router / Query (same stack as earworm). Contract: [docs/API.md](docs/API.md).
- Android app: planned, native Kotlin like earworm, same API.

## Microsoft sign-in

Once, in the app under `/connect`: a device code you enter on microsoft.com/devicelogin with the school account. The server signs in as the official Teams public client (`1fec8e78-bce4-4aaf-ab1b-5451cc387264`), so the school tenant needs no consent. One refresh token (`/data/tokens.json`, 0600) is exchanged per resource:

| Resource | Used for |
|---|---|
| `api.spaces.skype.com` -> authsvc skype token | chat service: chats, channels, meeting chats, send, read state |
| `graph.microsoft.com` | me, people names, joined teams and channels, files |
| same Graph token on `assignments.onenote.com/api/v1.0/edu` | assignments and submissions (Graph's own `/education` is refused for this client) |

## How it runs

- Home server `ghs`, Docker Compose project `teams`, deployed by doco-cd (every commit on `main` goes live within about a minute).
- `teams.galsever.com` is a personal-infra app (`apps/teams`): relay in k3s behind the tailnet gateway and the Pocket ID gate, forwarding to `ghs:8788`. The app has no own login (`APP_AUTH=none`).

## Develop

```
python3 -m venv .venv && .venv/bin/pip install -r server/requirements.txt
cd server && DATA_DIR=../data APP_AUTH=none SECURE_COOKIES=0 ../.venv/bin/uvicorn teams.main:app
cd web && npm install && npm run dev   # proxies /api to 127.0.0.1:8000
```

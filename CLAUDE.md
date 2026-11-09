# School

Personal school hub at school.galsever.com (HTL Spengergasse): Microsoft Teams client, school mail, assignments, the WebUntis absences (former excuses app) and the school Moodle (former moodle-mcp). Read README.md and docs/API.md first, and mastermem `project:school` (older notes: `project:teams`, `project:excuses`).

- Server `server/school/` (FastAPI): `main.py` routes, `ms.py` device login and tokens, `upstream.py` chat service, Graph and Assignments calls mapped to API shapes, `mcp.py` the MCP at /api/mcp.
- Absences: `untis.py` WebUntis client, `absences.py` model, stats, storage and sync, `letter.py` the Entschuldigung PDF, `absences_api.py` routes and MCP tools. How it works and how to test without WebUntis: docs/ABSENCES.md. Tests: `cd server && ../.venv/bin/python -m pytest tests`.
- WebUntis: a rejected login blocks syncing until the login is changed in Settings. Never retry a login in a loop or test with guessed passwords: Spengergasse locks accounts.
- Moodle: `moodle.py` client (login, cache, files, shapes, submission), `moodle_api.py` routes, uploads, text extraction and the `moodle_*` MCP tools. `mod_assign_save_submission` replaces all plugin data: keep going through `moodle.save_submission`. Never log a file URL (it carries the token).
- `mail.py` school Outlook (docs/MAIL.md), `prefs.py` own team and channel names and hidden flags (`DATA_DIR/prefs.json`).
- Website `web/` (Vite, React, shadcn, TanStack). `npm run build` must pass. Message HTML from Teams is untrusted: always through `safeHtml` (DOMPurify). Mail bodies through `mailHtml` (same file, docs/MAIL.md). Team and channel logic uses `original` (Microsoft's name), display uses `name`.
- A new route or changed shape goes into docs/API.md in the same commit.
- Deploy: push to `main`; doco-cd on ghs runs `docker compose up -d --build`. Routing and login live in personal-infra (`apps/school-hub`, `hosts/ghs`).
- Never test turn-in, send or delete against real classes or chats without asking: it is the real school account.
- Commits: author `136364956+galsever@users.noreply.github.com`, no co-author lines.

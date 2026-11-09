# Teams

Personal Microsoft Teams client (school account). Read README.md and docs/API.md first, and mastermem `project:teams`.

- Server `server/teams/` (FastAPI): `main.py` routes, `ms.py` device login and tokens, `upstream.py` chat service, Graph and Assignments calls mapped to API shapes.
- Website `web/` (Vite, React, shadcn, TanStack). `npm run build` must pass. Message HTML from Teams is untrusted: always through `safeHtml` (DOMPurify).
- Deploy: push to `main`; doco-cd on ghs runs `docker compose up -d --build`. Routing and login live in personal-infra (`apps/teams`, `hosts/ghs`).
- Never test turn-in, send or delete against real classes or chats without asking: it is the real school account.
- Commits: author `136364956+galsever@users.noreply.github.com`, no co-author lines.

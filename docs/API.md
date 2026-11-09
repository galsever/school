# API

All JSON. Errors: `{"error": code, "detail": text}`; `401 login_required` (app password mode only), `409 ms_not_connected` (sign in at `/connect`), `502 upstream`.

| Method | Path | Returns |
|---|---|---|
| GET | `/api/ms/status` | `{connected: true, me}` or `{connected: false, device}` |
| POST | `/api/ms/device` | starts device login: `{state, userCode, url, expiresAt}` |
| GET | `/api/ms/device` | device login state: `pending`, `done`, `failed`, `expired` |
| POST | `/api/ms/logout` | forgets the refresh token |
| GET | `/api/chats` | `Chat[]` (chats, meeting chats, channels with activity), newest first |
| GET | `/api/chats/{id}/messages?cursor=` | `{messages: Message[] oldest first, cursor}`; cursor = next older page |
| POST | `/api/chats/{id}/messages` | `{text}` -> sends as HTML paragraphs |
| POST | `/api/chats/{id}/read` | `{messageId}` -> sets the read horizon |
| GET | `/api/teams` | `Team[]` with channels (cached 10 min); a channel id opens with the chat routes. Team and channel: `{id, name, original, hidden}`, `name` is the own display name when set |
| PUT | `/api/prefs/{id}` | own name and hidden flag of a team or channel: `{name?, hidden?}` (empty name = Microsoft's again). Stored in `DATA_DIR/prefs.json`; names apply to teams, chats, assignments and MCP, hidden ones are never unread |
| GET | `/api/assignments` | `Assignment[]` by due date; `done` = own submission submitted or returned |
| GET | `/api/assignments/{classId}/{id}` | assignment with instructions, resources and own submission |

Types: `web/src/lib/types.ts`.

## Mail (school Outlook, Graph with the same login)

| Method | Path | Returns |
|---|---|---|
| GET | `/api/mail?folder=inbox\|sent\|archive&q=&cursor=` | `{messages, cursor}` newest first; `q` searches |
| GET | `/api/mail/{id}` | mail with sanitizable HTML (inline images rewritten to the attachment route), attachments; marks it read |
| GET | `/api/mail/{id}/attachments/{aid}` | the attachment (images, PDF inline, rest as download) |
| GET | `/api/mail/{id}/attachments/{aid}/parts/{n}` | a file from inside an S/MIME signed mail (Graph hands those over as one `smime.p7m`); `files[].url` and inline images point here |
| GET | `/api/mail/unread` | `{count}` unread in the inbox |
| POST | `/api/mail/send` | `{to[], cc[], subject, text}` |
| POST | `/api/mail/{id}/reply` | `{text, all}` |
| GET | `/api/mail/people?q=` | address suggestions |

## MCP

`POST /api/mcp`: MCP over streamable HTTP (stateless JSON-RPC), bearer token from `DATA_DIR/mcp-token`. Not behind the Pocket ID gate (personal-infra `apps/teams/mcp-route.yaml`), tailnet only.
Tools: `list_chats`, `read_messages`, `send_message`, `list_mail`, `read_mail`, `send_mail`, `reply_mail` (the send/reply ones are the only write tools), `list_teams`, `list_files`, `read_file` (PDF/Office text), `list_assignments`, `get_assignment`. No turn-in or uploads by design.

## Absences (WebUntis)

Own login for WebUntis (`/data/untis.json`), checked once at WebUntis before it is stored. A rejected login blocks all
syncing until the login is changed: schools lock accounts, so nothing retries. Times are minutes since midnight.

| Route | What |
|---|---|
| `GET /api/absences` | `{sync, name, klasse, days}`; a day has `date, status (excused, partial, open), reason, exportedAt, absences[]` |
| `POST /api/absences/sync?force=` | pulls WebUntis when the data is older than 30 min (force: now, at most once a minute); returns `sync` |
| `PUT /api/absences/{date}/reason` | `{reason}`: the own reason of a day (goes into the letter) |
| `POST /api/absences/letter` | `{dates}` -> the Entschuldigung PDF; every day needs a reason; marks the days exported |
| `GET /api/absences/attendance?range=s1,s2,year` or `from=&to=` | `{range, total, subjects, groups, allSubjects}`, per subject `held, present, excused, unexcused, percent` |
| `POST /api/absences/groups`, `DELETE /api/absences/groups/{name}` | subjects counted as one (`{name, subjects}`) |
| `GET/POST /api/absences/login` | WebUntis login `{server, school, user, password, place}`; the password is never returned, empty keeps it |
| `GET /api/mcp/pdf?dates=&exp=&sig=` | signed 15 min link from the MCP tool `excuse_pdf`, no login |

# API

All JSON unless noted. Errors: `{"error": code, "detail": text}`.

| Status | Code | Meaning |
|---|---|---|
| 400 | `bad_id`, `bad_url`, `bad_text`, `bad_mail`, `bad_file`, `upstream` | bad input; `upstream` = Microsoft refused the request as malformed (detail is Microsoft's message) |
| 401 | `login_required` | app password mode only |
| 404 | `upstream`, `not_found` | Microsoft does not know the id |
| 409 | `ms_not_connected` | sign in at `/connect` |
| 502 | `upstream` | any other Microsoft error |

The website does not retry 400, 401, 404 and 409. Types: `web/src/lib/types.ts`.

## Account

| Method | Path | Returns |
|---|---|---|
| GET | `/healthz` | `{ok: true}` |
| GET | `/api/auth/me` | `{authenticated}` (always true with `APP_AUTH=none`) |
| POST | `/api/auth/login`, `/api/auth/logout` | app password mode only |
| GET | `/api/app/handoff?state=` | Android login: hands the Pocket ID gate cookie to the app's own URL scheme |
| GET | `/api/ms/status` | `{connected: true, me}` or `{connected: false, device}` |
| POST | `/api/ms/device` | starts device login: `{state, userCode, url, expiresAt}` |
| GET | `/api/ms/device` | device login state: `pending`, `done`, `failed`, `expired` |
| POST | `/api/ms/logout` | forgets the refresh token |

## Chats and channels

| Method | Path | Returns |
|---|---|---|
| GET | `/api/chats` | `Chat[]` (chats, meeting chats, channels with activity), newest first. A channel carries the own display name; a hidden one is never `unread` |
| GET | `/api/chats/{id}/messages?cursor=` | `{messages: Message[] oldest first, cursor}`; cursor = next older page. A finished meeting recording comes as a message with one file of `type: "recording"` (SharePoint link, title with length); interim recording chunks and transcript notices are left out |
| POST | `/api/chats/{id}/messages` | `{text}` -> sends as HTML paragraphs |
| POST | `/api/chats/{id}/read` | `{messageId}` -> sets the read horizon |
| GET | `/api/media?url=` | a pasted image from a message (needs the skype token, so it goes through the server); Teams media hosts only |

## Teams, names, files

| Method | Path | Returns |
|---|---|---|
| GET | `/api/teams` | `Team[]` with channels, sorted by name (Microsoft's list is cached 10 min, names and hidden flags apply at once). A channel id opens with the chat routes |
| PUT | `/api/prefs/{id}` | own name and hidden flag of a team or channel, body `{name?, hidden?}`, 204 |
| GET | `/api/teams/{teamId}/channels/{channelId}/files` | the channel's folder: `{drive, id, name, webUrl, items}` |
| GET | `/api/drives/{drive}/items/{item}/children` | `{items}` of a subfolder, folders first |
| GET | `/api/drives/{drive}/items/{item}/view?download=` | the file itself: PDF, images, text, video, audio inline; Office files converted to PDF; the rest as download |
| GET | `/api/files/open?url=` | 302 to the SharePoint page of a Graph drive item (assignment material) |

Team and channel: `{id, name, original, hidden}`.
- `name` is the own display name when one is set, else Microsoft's. `original` is always Microsoft's (use it for logic such as finding the main channel `General` / `Allgemein`).
- `PUT /api/prefs/{id}`: `id` is a team id or a channel id. `name` empty or null puts Microsoft's name back (max 80 characters). `hidden: true` folds it away in the website and mutes it. Only the keys you send change.
- The own name also shows in `/api/chats` titles, `className` of assignments and the MCP tools. A hidden team hides and mutes all its channels.

## Assignments

| Method | Path | Returns |
|---|---|---|
| GET | `/api/assignments` | `Assignment[]` by due date; `done` = own submission submitted or returned |
| GET | `/api/assignments/{classId}/{id}` | assignment with instructions, resources and own submission |
| POST | `/api/assignments/{classId}/{id}/files?name=` | raw file body (max 250 MB) -> added to the own work |
| DELETE | `/api/assignments/{classId}/{id}/files/{rid}` | removes a file from the own work |
| POST | `/api/assignments/{classId}/{id}/turn-in`, `/undo-turn-in` | 204 |

`classId` is the team id.

## Mail (school Outlook, Graph with the same login)

| Method | Path | Returns |
|---|---|---|
| GET | `/api/mail?folder=inbox\|sent\|archive&q=&unread=&cursor=` | `{messages: MailSummary[], cursor}` newest first, 50 per page. `q` searches (as one phrase; quotes and backslashes are dropped), `unread=true` only unread |
| GET | `/api/mail/unread` | `{count}` unread in the inbox |
| GET | `/api/mail/{id}` | `Mail`: summary plus `cc`, `html`, `files`. **Marks the mail read.** `read` is the state before opening |
| GET | `/api/mail/{id}/attachments/{aid}?download=` | the attachment (images, PDF, plain text inline, rest as download) |
| GET | `/api/mail/{id}/attachments/{aid}/parts/{n}` | a file from inside an S/MIME signed mail, same rules |
| POST | `/api/mail/send` | `{to[], cc[], subject, text}` -> 204, saved to Sent |
| POST | `/api/mail/{id}/reply` | `{text, all}` -> 204 |
| GET | `/api/mail/people?q=` | address suggestions `{name, address}[]` (school directory and people you mailed), from 2 characters |

- `html` is Microsoft's HTML and untrusted: the website renders it only through `mailHtml` ([MAIL.md](MAIL.md)). Inline images (`cid:`) are already rewritten to the attachment routes.
- `files[]`: `{id, name, size, type, url}`; open `url`, do not build the path yourself (files of signed mails live under `/parts/{n}`).
- `text` of send and reply is plain text, sent as HTML paragraphs.

## Absences (WebUntis)

Own login for WebUntis (`/data/untis.json`), checked once at WebUntis before it is stored. A rejected login blocks all
syncing until the login is changed: schools lock accounts, so nothing retries. Times are minutes since midnight.
Background and rules: [ABSENCES.md](ABSENCES.md).

`sync` = `{configured, lastSync, lastError, blocked, stale}`. An absence entry = `{id, date, start, end, excused, status,
untisReason, late, lateMinutes, units}`. Errors of this area: `400 bad_request`, `400 letter` (a day without a reason, detail
names the days), `400 untis_login` (detail says why: rejected, school not found, not reachable), `403 forbidden` (PDF link).

| Route | What |
|---|---|
| `GET /api/absences` | `{sync, name, klasse, days}`; a day has `date, status (excused, partial, open), reason, exportedAt, absences[]` |
| `POST /api/absences/sync?force=` | pulls WebUntis when the data is older than 30 min (force: now, at most once a minute); returns `sync` |
| `PUT /api/absences/{date}/reason` | `{reason}`: the own reason of a day (goes into the letter) |
| `POST /api/absences/letter` | `{dates}` -> the Entschuldigung PDF; every day needs a reason; marks the days exported |
| `GET /api/absences/attendance?range=s1,s2,year` or `from=&to=` | `{range, total, subjects, groups, allSubjects}`, per subject `held, present, excused, unexcused, percent` |
| `POST /api/absences/groups`, `DELETE /api/absences/groups/{name}` | subjects counted as one (`{name, subjects}`) |
| `GET/POST /api/absences/login` | WebUntis login `{server, school, user, password, place}`; the password is never returned, empty keeps it; `server` may be a pasted login URL; `school` is the login name, the real name or empty is looked up; POST does one login at WebUntis when the login changed |
| `GET /api/mcp/pdf?dates=&exp=&sig=` | signed 15 min link from the MCP tool `excuse_pdf`, no login |

## Moodle

The school Moodle (moodle.spengergasse.at) through its mobile app web service. Own login (`/data/moodle.json`), checked
once at Moodle before it is stored; a rejected login blocks every call until the login is changed. Every read is cached
for 60 s on the server; `POST /api/moodle/refresh` empties that cache (the reload button). Times are ISO UTC.
Errors: 409 `moodle_not_connected` (no login, or Moodle rejects it), 400 / 404 / 502 `moodle` with Moodle's message.

| Route | What |
|---|---|
| `GET /api/moodle` | `{due, courses}`: open to-dos of the timeline (`cmid, name, course, courseId, type, due, overdue, url`) and the courses (`id, name, short, grade, progress, lastAccess`), last used first |
| `POST /api/moodle/refresh` | empties the cache, 204 |
| `GET /api/moodle/courses/{id}` | `{id, name, sections}`; a section has `modules[]` with `cmid, name, type, url, description (HTML), files[], link, done, restricted, dates[]` |
| `GET /api/moodle/courses/{id}/grades` | grade items: `name, type, total, cmid, grade, range, percentage, weight, feedback, gradedAt` |
| `GET /api/moodle/assignments/{cmid}?course=` | the assignment: `description (HTML), attachments, due, cutoff, files, maxFiles, maxBytes, onlineText, submitButton, submission {status, canEdit, needsSubmit, files, text}, feedback` |
| `POST /api/moodle/uploads?name=` | raw file body (max 100 MB) -> `{id, size}`; waits an hour at most for a submission |
| `POST /api/moodle/assignments/{cmid}/submission?course=` | `{add: [upload ids], remove: [file names], text}` -> the assignment afterwards. Files already there are kept |
| `POST /api/moodle/assignments/{cmid}/submit?course=` | submits a draft for grading (assignments with a submit button) -> the assignment afterwards |
| `GET /api/moodle/file?url=&download=` | a Moodle file (`view` of a file): PDF, images, text, media inline, the rest as download. Only addresses on the Moodle itself |
| `GET /api/moodle/page?url=` | `{html}` of a page activity (untrusted: sanitize) |
| `GET/POST /api/moodle/login` | `{configured, url, user, blocked}` / `{user, password, url?}`; the password is never returned, empty keeps it |
| `PUT /api/mcp/moodle-upload/{id}?exp=&sig=`, `GET /api/mcp/moodle-file?url=&exp=&sig=` | signed 15 min links from the MCP tools `moodle_upload_link` and `moodle_read_file`, no login |

## MCP

`POST /api/mcp`: MCP over streamable HTTP (stateless JSON-RPC), bearer token from `DATA_DIR/mcp-token`. Not behind the Pocket ID gate (personal-infra `apps/school-hub/mcp-route.yaml`), tailnet only.

| Area | Tools |
|---|---|
| Chats | `list_chats`, `read_messages`, `send_message` |
| Teams and files | `list_teams`, `list_files`, `read_file` (PDF/Office text) |
| Assignments | `list_assignments`, `get_assignment` |
| Mail | `list_mail`, `read_mail`, `send_mail`, `reply_mail` |
| Absences | `absence_days`, `new_open_days`, `set_reason`, `attendance`, `excuse_pdf`, `refresh` |
| Moodle | `moodle_deadlines`, `moodle_courses`, `moodle_course_contents`, `moodle_assignment`, `moodle_grades`, `moodle_read_file`, `moodle_upload_link`, `moodle_submit_assignment` |

The only tools that write to Microsoft are `send_message`, `send_mail` and `reply_mail`; `set_reason` writes the own reason of a day. No turn-in or uploads by design.

Moodle tools are the former `moodle-mcp` (Go, stdio) with the same shapes. `moodle_submit_assignment` changes the real
submission. A local file gets to the hub in two steps, because the server cannot read the model's disk:
`moodle_upload_link` returns an `upload_id` and a signed link, `curl -T <file> '<url>'` sends the file, then
`moodle_submit_assignment` takes the `upload_id`. `moodle_read_file` answers text (PDF, Word, PowerPoint, OpenDocument,
HTML, code), images as images, and a signed `download_url` for everything else.

`list_teams` and `list_chats` use the own display names; hidden teams and channels are still listed, marked `(hidden)`.

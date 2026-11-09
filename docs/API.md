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

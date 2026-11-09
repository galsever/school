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
| GET | `/api/teams` | `Team[]` with channels (cached 10 min); a channel id opens with the chat routes |
| GET | `/api/assignments` | `Assignment[]` by due date; `done` = own submission submitted or returned |
| GET | `/api/assignments/{classId}/{id}` | assignment with instructions, resources and own submission |

Types: `web/src/lib/types.ts`.

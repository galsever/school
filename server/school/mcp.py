"""MCP server (streamable HTTP, stateless JSON-RPC) at /api/mcp: the school Teams account and the WebUntis absences as tools for Claude.

Read everything, send messages and mail. No turn-in or uploads (his decision 2026-11-09). Own bearer token
(DATA_DIR/mcp-token): the route skips the Pocket ID gate (personal-infra apps/school-hub/mcp-route.yaml), tailnet only.
"""

import hmac
import html
import io
import re
from urllib.parse import unquote

from fastapi import Request
from fastapi.responses import JSONResponse, Response

from . import absences_api, config, mail, upstream

TOKEN = config._secret_file("mcp-token", lambda: __import__("secrets").token_urlsafe(36))
PROTOCOL = "2025-06-18"
MAX_TEXT = 60_000

_BLOCK = re.compile(r"</?(p|div|br|li|tr|h[1-6]|blockquote)[^>]*>", re.I)
_TAG = re.compile(r"<[^>]+>")


def _text(content: str) -> str:
    t = _BLOCK.sub("\n", content or "")
    t = html.unescape(_TAG.sub("", t))
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def _drive_ref(url: str | None) -> dict | None:
    """Graph drive item URL (also wrapped in /api/files/open?url=) -> {drive_id, item_id}."""
    if not url:
        return None
    if url.startswith("/api/files/open?url="):
        url = unquote(url.split("=", 1)[1])
    m = re.search(r"/drives/([^/]+)/items/([^/?]+)", url)
    return {"drive_id": m.group(1), "item_id": m.group(2)} if m else None


# ---- tools ---------------------------------------------------------------------

async def list_chats(unread_only: bool = False, kind: str = "") -> str:
    out = []
    for c in await upstream.chats():
        if (unread_only and not c["unread"]) or (kind and c["kind"] != kind):
            continue
        last = c["last"] or {}
        who = "me" if last.get("mine") else last.get("from", "")
        out.append(
            f"- {c['title']} [{c['kind']}{', UNREAD' if c['unread'] else ''}] id={c['id']}\n"
            f"  last {last.get('time', '')[:16]} {who}: {last.get('text', '')[:160]}"
        )
    return "\n".join(out) or "No chats."


async def read_messages(chat_id: str, limit: int = 40) -> str:
    limit = max(1, min(int(limit), 200))
    msgs, cursor = [], None
    while len(msgs) < limit:
        page = await upstream.messages(chat_id, cursor)
        msgs = page["messages"] + msgs
        cursor = page["cursor"]
        if not cursor or not page["messages"]:
            break
    lines = []
    for m in msgs[-limit:]:
        if m["deleted"]:
            continue
        body = _text(m["html"]) if m["format"] == "html" else m["html"]
        parts = [f"[{m['time'][:16]}] {'me' if m['mine'] else m['from']}:"]
        if m["subject"]:
            parts.append(f"**{m['subject']}**")
        if body:
            parts.append(body)
        for card in m["cards"]:
            parts.append("[card] " + " | ".join(b["text"] for b in card["blocks"]))
            for a in card["actions"]:
                if a["assignment"]:
                    parts.append(f"  -> assignment class_id={a['assignment']['classId']} assignment_id={a['assignment']['id']}")
        for f in m["files"]:
            parts.append(f"[file] {f['name']}" + (f" ({f['url']})" if f["url"] else ""))
        lines.append(" ".join(parts))
    return "\n".join(lines) or "No messages."


async def send_message(chat_id: str, text: str) -> str:
    text = text.strip()
    if not text:
        raise ValueError("empty text")
    await upstream.send(chat_id, text)
    return "Sent."


async def list_teams() -> str:
    out = []
    for t in await upstream.teams():
        out.append(f"- {t['name']}{' (hidden)' if t['hidden'] else ''} team_id={t['id']}")
        out += [f"  # {c['name']}{' (hidden)' if c['hidden'] else ''} channel_id={c['id']}" for c in t["channels"]]
    return "\n".join(out) or "No teams."


async def list_files(team_id: str = "", channel_id: str = "", drive_id: str = "", folder_id: str = "") -> str:
    if drive_id and folder_id:
        if not (upstream.DRIVE_ID.match(drive_id) and upstream.DRIVE_ID.match(folder_id)):
            raise ValueError("bad id")
        d = await upstream.folder(drive_id, folder_id)
        drive, head = drive_id, ""
    elif team_id and channel_id:
        d = await upstream.channel_folder(team_id, channel_id)
        drive, head = d["drive"], f"Folder {d['name']} (drive_id={d['drive']} folder_id={d['id']})\n"
    else:
        raise ValueError("give team_id + channel_id, or drive_id + folder_id")
    rows = [
        f"- {'[folder] ' if i['folder'] else ''}{i['name']}  {'drive_id=' + drive + ' ' if not head else ''}"
        f"{'folder_id' if i['folder'] else 'item_id'}={i['id']}  modified {str(i['modified'])[:10]}"
        for i in d["items"]
    ]
    return head + ("\n".join(rows) or "Empty folder.")


async def read_file(drive_id: str, item_id: str) -> str:
    if not (upstream.DRIVE_ID.match(drive_id) and upstream.DRIVE_ID.match(item_id)):
        raise ValueError("bad id")
    name, mime, _, body = await upstream.file_stream(drive_id, item_id)
    data = b""
    async for chunk in body:
        data += chunk
        if len(data) > 60 * 1024 * 1024:
            return f"{name}: too big to read."
    if mime == "application/pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        text = "\n\n".join(f"--- page {n} ---\n{(p.extract_text() or '').strip()}" for n, p in enumerate(reader.pages, 1))
    elif mime.startswith("text/") or name.lower().endswith((".md", ".csv", ".java", ".py", ".kt", ".sql", ".json", ".xml")):
        text = data.decode("utf-8", "replace")
    else:
        return f"{name} ({mime}): no text to read (images, video and archives are not supported)."
    text = text.strip() or "(no extractable text, maybe a scan)"
    if len(text) > MAX_TEXT:
        text = text[:MAX_TEXT] + f"\n\n[truncated, {len(text)} characters in total]"
    return f"# {name}\n\n{text}"


async def list_assignments(include_done: bool = False) -> str:
    import time

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    stale = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 60 * 86400))
    out = []
    for a in await upstream.assignments():
        closed = a["closes"] and a["closes"] < now
        # open = like the app: not done, not closed, not abandoned more than 60 days ago
        if not include_done and (a["done"] or closed or (a["due"] and a["due"] < stale)):
            continue
        state = "done" if a["done"] else ("closed" if closed else ("LATE" if a["due"] and a["due"] < now else "open"))
        out.append(
            f"- {a['title']} [{state}] class={a['className'] or '?'} due={str(a['due'])[:16]}\n"
            f"  class_id={a['classId']} assignment_id={a['id']}"
        )
    return "\n".join(out) or "Nothing open."


async def get_assignment(class_id: str, assignment_id: str) -> str:
    a = await upstream.assignment(class_id, assignment_id)
    lines = [
        f"# {a['title']}",
        f"Class: {a['className']}  Due: {a['due']}  Closes: {a['closes']}  Points: {a['points']}",
    ]
    sub = a.get("submission")
    if sub:
        lines.append(f"My status: {sub['status']}  submitted: {sub['submitted']}  points: {sub['points']}")
    if a["instructions"]:
        lines += ["", "## Instructions", _text(a["instructions"])]

    def files(title, items):
        if items:
            lines.extend(["", f"## {title}"])
            for r in items:
                ref = _drive_ref(r["url"])
                lines.append(
                    f"- {r['name']}"
                    + (f"  drive_id={ref['drive_id']} item_id={ref['item_id']}" if ref else (f"  {r['url']}" if r["url"] else ""))
                )

    files("Material", a["resources"])
    if sub:
        files("My work", sub["resources"])
        if sub["feedback"]:
            lines += ["", "## Feedback"] + [_text(f) for f in sub["feedback"]]
    return "\n".join(lines)


async def list_mail(folder: str = "inbox", unread_only: bool = False, search: str = "", limit: int = 25) -> str:
    d = await mail.list_mail(folder, None, unread_only, search.strip())
    rows = []
    for m in d["messages"][: max(1, min(int(limit), 50))]:
        who = ", ".join(r["name"] for r in m["to"]) if folder == "sent" else m["from"]["name"]
        rows.append(
            f"- {'' if m['read'] else '[UNREAD] '}{str(m['time'])[:16]} {who}: {m['subject']}"
            f"{' [attachments]' if m['attachments'] else ''}\n  id={m['id']}\n  {m['preview'][:140]}"
        )
    return "\n".join(rows) or "No mail."


async def read_mail(mail_id: str) -> str:
    if not mail.valid_id(mail_id):
        raise ValueError("bad id")
    m = await mail.get_mail(mail_id)
    lines = [
        f"# {m['subject']}",
        f"From: {m['from']['name']} <{m['from']['address']}>",
        "To: " + ", ".join(f"{r['name']} <{r['address']}>" for r in m["to"]),
    ]
    if m["cc"]:
        lines.append("Cc: " + ", ".join(f"{r['name']} <{r['address']}>" for r in m["cc"]))
    lines += [f"Date: {m['time']}", "", _text(m["html"])[:MAX_TEXT]]
    if m["files"]:
        lines += ["", "Attachments: " + ", ".join(f["name"] for f in m["files"])]
    return "\n".join(lines)


async def send_mail(to: str, subject: str, text: str, cc: str = "") -> str:
    split = lambda v: [a for a in re.split(r"[,;\s]+", v or "") if a]
    await mail.send(split(to), subject, text, split(cc))
    return "Sent."


async def reply_mail(mail_id: str, text: str, reply_all: bool = False) -> str:
    if not mail.valid_id(mail_id):
        raise ValueError("bad id")
    await mail.reply(mail_id, text, reply_all)
    return "Replied."


S = {"type": "string"}
TOOLS = {
    "list_chats": (
        list_chats,
        "List chats, meeting chats and active channels with their last message, newest first. Use the id with read_messages.",
        {"unread_only": {"type": "boolean"}, "kind": {"type": "string", "enum": ["chat", "meeting", "channel"]}},
        [],
    ),
    "read_messages": (
        read_messages,
        "Read the latest messages of a chat or channel (oldest first), including cards, attached files and assignment links.",
        {"chat_id": S, "limit": {"type": "integer", "minimum": 1, "maximum": 200}},
        ["chat_id"],
    ),
    "send_message": (
        send_message,
        "Send a plain text message to a chat or channel as the user (real school account: only when the user asked for this exact message).",
        {"chat_id": S, "text": S},
        ["chat_id", "text"],
    ),
    "list_teams": (list_teams, "List the user's class teams with their channels (ids for read_messages and list_files).", {}, []),
    "list_files": (
        list_files,
        "List a channel's files (team_id + channel_id) or a subfolder (drive_id + folder_id).",
        {"team_id": S, "channel_id": S, "drive_id": S, "folder_id": S},
        [],
    ),
    "read_file": (
        read_file,
        "Read the text of a file (PDF, Word, PowerPoint, Excel via PDF conversion, plain text).",
        {"drive_id": S, "item_id": S},
        ["drive_id", "item_id"],
    ),
    "list_assignments": (
        list_assignments,
        "List assignments by due date; by default only open ones (not turned in, not closed, due within the last 60 days or later).",
        {"include_done": {"type": "boolean"}},
        [],
    ),
    "get_assignment": (
        get_assignment,
        "Assignment details: instructions, material files (readable with read_file), own submission, feedback and points.",
        {"class_id": S, "assignment_id": S},
        ["class_id", "assignment_id"],
    ),
    "list_mail": (
        list_mail,
        "School Outlook mail: list a folder newest first, optionally only unread or a search.",
        {
            "folder": {"type": "string", "enum": ["inbox", "sent", "archive", "deleted"]},
            "unread_only": {"type": "boolean"},
            "search": S,
            "limit": {"type": "integer", "minimum": 1, "maximum": 50},
        },
        [],
    ),
    "read_mail": (read_mail, "Read one school mail (marks it read).", {"mail_id": S}, ["mail_id"]),
    "send_mail": (
        send_mail,
        "Send a new mail from the school account (only when the user asked for this exact mail). to/cc: addresses separated by commas.",
        {"to": S, "subject": S, "text": S, "cc": S},
        ["to", "subject", "text"],
    ),
    "reply_mail": (
        reply_mail,
        "Reply to a school mail (only when the user asked for this exact reply).",
        {"mail_id": S, "text": S, "reply_all": {"type": "boolean"}},
        ["mail_id", "text"],
    ),
}
TOOLS.update(absences_api.TOOLS)
READ_ONLY = {n for n in TOOLS if n not in ("send_message", "send_mail", "reply_mail") and n not in absences_api.WRITES}


def _tool_list():
    return [
        {
            "name": name,
            "description": desc,
            "inputSchema": {"type": "object", "properties": props, "required": req},
            "annotations": {"readOnlyHint": name in READ_ONLY},
        }
        for name, (_, desc, props, req) in TOOLS.items()
    ]


async def _call(name: str, args: dict) -> dict:
    if name not in TOOLS:
        raise KeyError(name)
    fn, _, props, _ = TOOLS[name]
    args = {("from_" if k == "from" else k): v for k, v in (args or {}).items() if k in props}
    try:
        text = await fn(**args)
        return {"content": [{"type": "text", "text": text}]}
    except upstream.Upstream as e:
        return {"content": [{"type": "text", "text": f"Microsoft error {e.status}: {e}"}], "isError": True}
    except absences_api.Fail as e:
        return {"content": [{"type": "text", "text": str(e)}], "isError": True}
    except (ValueError, TypeError) as e:
        return {"content": [{"type": "text", "text": f"Bad arguments: {e}"}], "isError": True}


async def handle(request: Request):
    auth = request.headers.get("authorization", "")
    if not hmac.compare_digest(auth.encode(), f"Bearer {TOKEN}".encode()):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    if request.method == "GET":
        return Response(status_code=405)  # no server-initiated stream
    if request.method == "DELETE":
        return Response(status_code=204)
    try:
        msg = await request.json()
    except ValueError:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}, status_code=400)
    # Public origin of this request, for the signed PDF link of excuse_pdf.
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    absences_api.ORIGIN.set(f"{request.headers.get('x-forwarded-proto') or request.url.scheme}://{host}")
    batch = isinstance(msg, list)
    replies = [r for r in [await _one(m) for m in (msg if batch else [msg])] if r]
    if not replies:
        return Response(status_code=202)
    return JSONResponse(replies if batch else replies[0])


async def _one(m: dict) -> dict | None:
    mid, method, params = m.get("id"), m.get("method"), m.get("params") or {}
    if mid is None:  # notification
        return None

    def ok(result):
        return {"jsonrpc": "2.0", "id": mid, "result": result}

    if method == "initialize":
        return ok(
            {
                "protocolVersion": params.get("protocolVersion") or PROTOCOL,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "school", "version": "0.2.0"},
                "instructions": "The user's school hub (HTL Spengergasse). Microsoft account: Teams chats, class teams, channel files, "
                "assignments and Outlook mail. Reading is free; send_message, send_mail and reply_mail act as the user on the real "
                "school account, so only send what the user asked for. WebUntis absences: absence days with the user's own reason "
                "per day, attendance per subject and the Entschuldigung PDF they sign and send to the teacher. Dates are "
                "YYYY-MM-DD (Europe/Vienna). A day needs a reason before it can go into a PDF. Lateness (only_late) never counts "
                "against attendance.",
            }
        )
    if method == "ping":
        return ok({})
    if method == "tools/list":
        return ok({"tools": _tool_list()})
    if method == "tools/call":
        try:
            return ok(await _call(params.get("name", ""), params.get("arguments") or {}))
        except KeyError:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": "Unknown tool"}}
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "Method not found"}}

"""School Outlook mail through Graph with the same login (Mail.ReadWrite, Mail.Send are in the Teams client's token)."""

import asyncio
import base64
import email
import email.policy
import re
import time
from urllib.parse import quote

from .ms import GRAPH, session
from .upstream import GRAPH_URL, Upstream, _check

FOLDERS = {"inbox": "inbox", "sent": "sentitems", "archive": "archive", "deleted": "deleteditems"}
ID = re.compile(r"^[A-Za-z0-9=_\-+/]{10,300}$")
LIST_FIELDS = "id,subject,from,toRecipients,receivedDateTime,sentDateTime,isRead,bodyPreview,hasAttachments,flag"


def valid_id(i: str) -> bool:
    return bool(ID.match(i))


async def _req(method: str, path: str, **kw):
    tok = await session.token(GRAPH)
    headers = {"Authorization": f"Bearer {tok}", **kw.pop("headers", {})}
    return _check(await session.http.request(method, GRAPH_URL + path, headers=headers, timeout=60, **kw))


def _addr(r: dict | None) -> dict:
    e = (r or {}).get("emailAddress") or {}
    return {"name": e.get("name") or e.get("address") or "", "address": e.get("address") or ""}


def _summary(m: dict) -> dict:
    return {
        "id": m["id"],
        "subject": m.get("subject") or "",
        "from": _addr(m.get("from")),
        "to": [_addr(r) for r in m.get("toRecipients") or []],
        "time": m.get("receivedDateTime") or m.get("sentDateTime"),
        "read": bool(m.get("isRead")),
        "preview": (m.get("bodyPreview") or "")[:200],
        "attachments": bool(m.get("hasAttachments")),
        "flagged": (m.get("flag") or {}).get("flagStatus") == "flagged",
    }


async def list_mail(folder: str = "inbox", cursor: str | None = None, unread_only: bool = False, search: str = "") -> dict:
    f = FOLDERS.get(folder, "inbox")
    if cursor:
        if not cursor.startswith(GRAPH_URL + "/me/"):
            raise Upstream(400, "bad cursor")
        path = cursor[len(GRAPH_URL):]
    else:
        path = f"/me/mailFolders/{f}/messages?$top=50&$select={LIST_FIELDS}"
        # the term is sent as one quoted phrase: a quote or backslash inside it is a Graph syntax error
        search = re.sub(r'["\\]+', " ", search[:100]).strip()
        if search:
            path += "&$search=" + quote(f'"{search}"')  # $search cannot be combined with $orderby
        else:
            path += "&$orderby=receivedDateTime desc"
            if unread_only:
                path += "&$filter=isRead eq false"
    d = (await _req("GET", path)).json()
    return {"messages": [_summary(m) for m in d.get("value", [])], "cursor": d.get("@odata.nextLink")}


async def unread_count() -> int:
    d = (await _req("GET", "/me/mailFolders/inbox?$select=unreadItemCount")).json()
    return int(d.get("unreadItemCount") or 0)


_signed: dict[tuple[str, str], tuple[float, list[dict]]] = {}


async def signed_parts(mid: str, aid: str) -> list[dict]:
    """Leaf parts of an S/MIME signed mail. Graph hands the whole signed MIME over as one attachment
    (smime.p7m, multipart/signed), so its inline images and real attachments are only in there."""
    hit = _signed.get((mid, aid))
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    data = (await _req("GET", f"/me/messages/{mid}/attachments/{aid}/$value")).content
    parts = []
    for p in email.message_from_bytes(data, policy=email.policy.default).walk():
        if p.is_multipart():
            continue
        ctype, name = p.get_content_type(), p.get_filename() or ""
        if "pkcs7-signature" in ctype or (ctype in ("text/plain", "text/html") and not name):
            continue  # the signature and the body Graph already gave us
        parts.append(
            {
                "name": name,
                "type": ctype,
                "cid": (p.get("Content-ID") or "").strip().strip("<>"),
                "data": p.get_payload(decode=True) or b"",
            }
        )
    if len(_signed) >= 8:
        _signed.pop(min(_signed, key=lambda k: _signed[k][0]))
    _signed[(mid, aid)] = (time.time(), parts)
    return parts


async def _with_files(m: dict, mark_read: bool) -> dict:
    """Summary plus cc, html and files of a Graph message that was read with its body."""
    mid = m["id"]
    body = (m.get("body") or {}).get("content", "")
    if (m.get("body") or {}).get("contentType") == "text":
        body = _html(body)
    atts = []
    if m.get("hasAttachments") or "cid:" in body:
        atts = (
            await _req(
                "GET",
                f"/me/messages/{mid}/attachments?$select=id,name,size,contentType,isInline,microsoft.graph.fileAttachment/contentId",
            )
        ).json().get("value", [])
    # inline images: src="cid:<contentId>" -> our attachment route
    base = f"/api/mail/{quote(mid, safe='')}/attachments/"
    files = []
    for a in atts:
        url = base + quote(a["id"], safe="")
        if a.get("contentId"):
            body = body.replace(f'cid:{a["contentId"]}', url)
        if (a.get("contentType") or "").startswith("multipart/signed"):
            try:
                parts = await signed_parts(mid, a["id"])
            except Exception:  # not parseable: keep the p7m as a plain attachment
                parts = None
            if parts is not None:
                for n, p in enumerate(parts):
                    inline = bool(p["cid"]) and f'cid:{p["cid"]}' in body
                    if inline:
                        body = body.replace(f'cid:{p["cid"]}', f"{url}/parts/{n}")
                    else:
                        files.append({"id": f'{a["id"]}/parts/{n}', "name": p["name"] or "file", "size": len(p["data"]), "type": p["type"], "url": f"{url}/parts/{n}"})
                continue
        if not a.get("isInline"):
            files.append({"id": a["id"], "name": a.get("name", ""), "size": a.get("size"), "type": a.get("contentType", ""), "url": url})
    if mark_read and not m.get("isRead"):
        await _req("PATCH", f"/me/messages/{mid}", json={"isRead": True})
    out = _summary(m)
    out.update(
        {
            "cc": [_addr(r) for r in m.get("ccRecipients") or []],
            "html": body,
            "files": files,
        }
    )
    return out


FULL_FIELDS = f"{LIST_FIELDS},ccRecipients,body"
HTML = {"Prefer": 'outlook.body-content-type="html"'}


async def get_mail(mid: str, mark_read: bool = True) -> dict:
    m = (await _req("GET", f"/me/messages/{mid}?$select={FULL_FIELDS}", headers=HTML)).json()
    return await _with_files(m, mark_read)


_skip_folders: list[str] = []


async def _skipped_folders() -> list[str]:
    """Ids of Deleted Items and Drafts: mails there are not part of a conversation view."""
    if not _skip_folders:
        for f in ("deleteditems", "drafts"):
            try:
                _skip_folders.append((await _req("GET", f"/me/mailFolders/{f}?$select=id")).json()["id"])
            except Upstream:
                pass
    return _skip_folders


async def thread(mid: str, mark_read: bool = True) -> dict:
    """All mails of the conversation of `mid` in every folder (Inbox, Sent, Archive, ...), oldest first.
    Drafts and deleted mails are left out, the opened mail is always in. Unread ones are marked read."""
    first = (await _req("GET", f"/me/messages/{mid}?$select=conversationId,subject")).json()
    cid = first.get("conversationId") or ""
    msgs: list[dict] = []
    if cid:
        flt = quote(f"conversationId eq '{cid.replace(chr(39), chr(39) * 2)}'")
        d = (await _req("GET", f"/me/messages?$filter={flt}&$top=40&$select={FULL_FIELDS},parentFolderId,isDraft", headers=HTML)).json()
        skip = await _skipped_folders()
        msgs = [m for m in d.get("value", []) if m["id"] == mid or (not m.get("isDraft") and m.get("parentFolderId") not in skip)]
    if not any(m["id"] == mid for m in msgs):
        msgs.append((await _req("GET", f"/me/messages/{mid}?$select={FULL_FIELDS}", headers=HTML)).json())
    msgs.sort(key=lambda m: m.get("receivedDateTime") or m.get("sentDateTime") or "")
    msgs = msgs[-30:]
    out = await asyncio.gather(*(_with_files(m, mark_read) for m in msgs))
    return {"subject": first.get("subject") or "", "messages": list(out)}


async def attachment(mid: str, aid: str) -> tuple[bytes, str, str]:
    meta = (await _req("GET", f"/me/messages/{mid}/attachments/{aid}?$select=name,contentType")).json()
    data = (await _req("GET", f"/me/messages/{mid}/attachments/{aid}/$value")).content
    return data, meta.get("contentType") or "application/octet-stream", meta.get("name") or "file"


def _recipients(addrs: list[str]) -> list[dict]:
    out = []
    for a in addrs:
        a = a.strip()
        if not re.fullmatch(r"[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+", a):
            raise Upstream(400, f"bad address: {a}")
        out.append({"emailAddress": {"address": a}})
    return out


def _html(text: str) -> str:
    import html

    return "".join(f"<p>{html.escape(line) or '&nbsp;'}</p>" for line in text.split("\n"))


async def send(to: list[str], subject: str, text: str, cc: list[str] | None = None) -> None:
    if not to:
        raise Upstream(400, "no recipient")
    msg = {
        "subject": subject,
        "body": {"contentType": "HTML", "content": _html(text)},
        "toRecipients": _recipients(to),
        "ccRecipients": _recipients(cc or []),
    }
    await _req("POST", "/me/sendMail", json={"message": msg, "saveToSentItems": True})


async def reply(mid: str, text: str, reply_all: bool = False) -> None:
    await _req("POST", f"/me/messages/{mid}/{'replyAll' if reply_all else 'reply'}", json={"comment": _html(text)})


MAX_FILES = 25 << 20  # all attachments of one mail together (Outlook's limit for school accounts is about this)
SMALL = 3 << 20  # larger attachments go through an upload session
CHUNK = 12 * 320 * 1024  # upload session chunks must be multiples of 320 KiB
MODES = {"new": None, "reply": "createReply", "replyAll": "createReplyAll", "forward": "createForward"}


async def _attach(draft: str, f: dict) -> None:
    name, ctype, data = f["name"], f["type"], f["data"]
    if len(data) <= SMALL:
        a = {"@odata.type": "#microsoft.graph.fileAttachment", "name": name, "contentType": ctype, "contentBytes": base64.b64encode(data).decode()}
        await _req("POST", f"/me/messages/{draft}/attachments", json=a)
        return
    item = {"AttachmentItem": {"attachmentType": "file", "name": name, "size": len(data), "contentType": ctype}}
    url = (await _req("POST", f"/me/messages/{draft}/attachments/createUploadSession", json=item)).json()["uploadUrl"]
    for start in range(0, len(data), CHUNK):
        part = data[start : start + CHUNK]
        rng = f"bytes {start}-{start + len(part) - 1}/{len(data)}"
        # the upload URL carries its own token: no Authorization header
        _check(await session.http.put(url, content=part, headers={"Content-Range": rng, "Content-Type": "application/octet-stream"}, timeout=120))


def _prepend(own: str, draft_html: str) -> str:
    """Own text in front of the quoted mail Outlook put into a reply or forward draft."""
    m = re.search(r"<body[^>]*>", draft_html, re.I)
    return draft_html[: m.end()] + own + draft_html[m.end() :] if m else own + draft_html


async def compose(mode: str, mid: str | None, to: list[str], cc: list[str], subject: str, html: str, files: list[dict]) -> None:
    """New mail, reply, reply all or forward, as HTML with attachments.
    Goes through a draft (Outlook adds the quote and, for forwards, the original attachments) and sends it.
    Recipients always come from the caller, also for replies (a reply to an own sent mail goes to its recipients)."""
    if mode not in MODES or (mode != "new") != bool(mid):
        raise Upstream(400, "bad mode")
    if not to:
        raise Upstream(400, "no recipient")
    if sum(len(f["data"]) for f in files) > MAX_FILES:
        raise Upstream(400, f"attachments larger than {MAX_FILES >> 20} MB")
    rcpt = {"toRecipients": _recipients(to), "ccRecipients": _recipients(cc)}
    if mode == "new":
        draft = (await _req("POST", "/me/messages", json={"subject": subject, "body": {"contentType": "HTML", "content": html}, **rcpt})).json()
    else:
        draft = (await _req("POST", f"/me/messages/{mid}/{MODES[mode]}", json={}, headers=HTML)).json()
        quoted = (draft.get("body") or {}).get("content", "")
        if (draft.get("body") or {}).get("contentType") == "text":
            quoted = _html(quoted)
        patch = {"body": {"contentType": "HTML", "content": _prepend(html, quoted)}, **rcpt}
        if subject:
            patch["subject"] = subject
        await _req("PATCH", f"/me/messages/{draft['id']}", json=patch)
    try:
        for f in files:
            await _attach(draft["id"], f)
        await _req("POST", f"/me/messages/{draft['id']}/send")
    except Exception:
        try:  # no half-made draft left behind in Outlook
            await _req("DELETE", f"/me/messages/{draft['id']}")
        except Exception:
            pass
        raise


async def search_people(q: str) -> list[dict]:
    """Address suggestions for the compose form (school directory and people you mailed)."""
    d = (await _req("GET", f"/me/people?$search={quote(q[:60])}&$top=8&$select=displayName,scoredEmailAddresses")).json()
    out = []
    for p in d.get("value", []):
        for e in p.get("scoredEmailAddresses") or []:
            if e.get("address"):
                out.append({"name": p.get("displayName") or e["address"], "address": e["address"]})
                break
    return out

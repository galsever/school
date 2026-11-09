"""Calls to Microsoft: chat service (chats, channels, meetings), Graph (teams, people), Assignments.

Every function returns the app's own API shapes (docs/API.md), never raw upstream JSON.
"""

import asyncio
import base64
import html
import json
import re
import secrets
import time

from .ms import GRAPH, session

ASSIGNMENTS = "https://assignments.onenote.com/api/v1.0/edu"
GRAPH_URL = "https://graph.microsoft.com/v1.0"

# conversations that are not something you open (team roots, notification streams)
CHAT_KINDS = {"chat": "chat", "meeting": "meeting", "topic": "channel"}

_names: dict[str, str] = {}  # user object id -> display name
_me: dict | None = None
_teams: tuple[float, list] | None = None


class Upstream(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status


def _check(r):
    if r.status_code >= 400:
        raise Upstream(r.status_code, r.text[:300])
    return r


async def _chat(method: str, path: str, **kw):
    tok, base = await session.skype()
    url = path if path.startswith("https://") else base + path
    if not url.startswith(base):
        raise Upstream(400, "foreign url")
    r = await session.http.request(method, url, headers={"Authentication": f"skypetoken={tok}"}, **kw)
    return _check(r)


async def _graph(path: str, base: str = GRAPH_URL):
    tok = await session.token(GRAPH)
    r = await session.http.get(base + path, headers={"Authorization": f"Bearer {tok}"})
    return _check(r).json()


def _oid(mri: str) -> str:
    """'8:orgid:<uuid>' or a contact URL ending in it -> '<uuid>'."""
    return mri.rsplit("8:orgid:", 1)[-1] if "8:orgid:" in mri else ""


_TAG = re.compile(r"<[^>]+>")


def text_of(content: str) -> str:
    return html.unescape(_TAG.sub(" ", content or "")).split("\n")[0].strip()[:200]


# ---- media -------------------------------------------------------------------

def media_allowed(url: str) -> bool:
    """Only Teams' own media hosts (pasted images, stickers) go through the proxy."""
    from urllib.parse import urlparse

    u = urlparse(url)
    host = u.hostname or ""
    return u.scheme == "https" and (
        host.endswith(".asyncgw.teams.microsoft.com") or host.endswith(".asm.skype.com")
    )


async def media(url: str) -> tuple[bytes, str]:
    tok, _ = await session.skype()
    r = await session.http.get(url, headers={"Authorization": f"skype_token {tok}"}, follow_redirects=True)
    _check(r)
    ctype = r.headers.get("content-type", "application/octet-stream")
    if not ctype.startswith("image/"):
        raise Upstream(415, "not an image")
    return r.content, ctype


# ---- people ----------------------------------------------------------------

async def me() -> dict:
    global _me
    if not _me:
        d = await _graph("/me?$select=id,displayName,mail,userPrincipalName")
        _me = {"id": d["id"], "name": d["displayName"], "mail": d.get("mail") or d.get("userPrincipalName")}
    return _me


async def names(ids: list[str]) -> dict[str, str]:
    missing = [i for i in set(ids) if i and i not in _names]
    if missing:
        tok = await session.token(GRAPH)
        for chunk in (missing[i : i + 20] for i in range(0, len(missing), 20)):
            body = {
                "requests": [
                    {"id": str(n), "method": "GET", "url": f"/users/{oid}?$select=id,displayName"}
                    for n, oid in enumerate(chunk)
                ]
            }
            r = await session.http.post(
                f"{GRAPH_URL}/$batch", json=body, headers={"Authorization": f"Bearer {tok}"}
            )
            for res in r.json().get("responses", []):
                oid = chunk[int(res["id"])]
                _names[oid] = res.get("body", {}).get("displayName") or ""
    return {i: _names.get(i, "") for i in ids}


# ---- chats -----------------------------------------------------------------

async def chats() -> list[dict]:
    my = (await me())["id"]
    r = await _chat("GET", "/v1/users/ME/conversations?view=msnp24Equivalent&pageSize=200")
    out, untitled = [], []
    for c in r.json().get("conversations", []):
        tp = c.get("threadProperties", {})
        kind = CHAT_KINDS.get(tp.get("threadType", ""))
        if not kind or c.get("properties", {}).get("isemptyconversation") == "True":
            continue
        last = c.get("lastMessage") or {}
        horizon = (c.get("properties", {}).get("consumptionhorizon") or "0").split(";")[0]
        last_id = last.get("id") or "0"
        mine = _oid(last.get("from", "")) == my
        item = {
            "id": c["id"],
            "kind": kind,
            "title": tp.get("topic") or tp.get("spaceThreadTopic") or "",
            "last": {
                "text": _preview(last),
                "from": last.get("imdisplayname") or "",
                "time": last.get("composetime"),
                "mine": mine,
            }
            if last
            else None,
            "unread": not mine and last_id.isdigit() and horizon.isdigit() and int(last_id) > int(horizon),
        }
        if not item["title"]:
            untitled.append(item)
        out.append(item)
    await _title_from_members(untitled, my)
    out.sort(key=lambda x: (x["last"] or {}).get("time") or "", reverse=True)
    return out


async def _title_from_members(items: list[dict], my: str) -> None:
    async def members(item):
        try:
            t = (await _chat("GET", f"/v1/threads/{item['id']}?view=msnp24Equivalent")).json()
            return item, [_oid(m["id"]) for m in t.get("members", []) if _oid(m["id"]) and _oid(m["id"]) != my]
        except Upstream:
            return item, []

    pairs = await asyncio.gather(*(members(i) for i in items))
    resolved = await names([oid for _, ids in pairs for oid in ids])
    for item, ids in pairs:
        item["title"] = ", ".join(resolved[i] for i in ids[:4]) or "Chat"


# ---- cards and files ----------------------------------------------------------

_SWIFT = re.compile(r'<Swift b64="([^"]+)"')
_ASSIGNMENT_LINK = "66aeee93-507d-479a-a3ef-8f494af43945"  # Assignments app id in Teams deep links


def _assignment_target(url: str) -> dict | None:
    """Teams deep link of the Assignments app -> {classId, id} for our own page."""
    if _ASSIGNMENT_LINK not in url:
        return None
    from urllib.parse import parse_qs, urlparse

    try:
        ctx = json.loads(parse_qs(urlparse(url).query)["context"][0])
        cls = json.loads(ctx["subEntityId"])["config"]["classes"][0]
        return {"classId": cls["id"], "id": cls["assignmentIds"][0]}
    except (KeyError, IndexError, ValueError, TypeError):
        return None


def _action(a: dict) -> dict | None:
    url = a.get("url") or a.get("value")
    if a.get("type") not in ("Action.OpenUrl", "openUrl") or not isinstance(url, str) or not url.startswith("https://"):
        return None
    return {"title": a.get("title") or "Open", "url": url, "assignment": _assignment_target(url)}


def _walk(node, out: dict) -> None:
    """Collect what can be shown from an Adaptive Card body: text, facts, images, buttons."""
    if isinstance(node, list):
        for n in node:
            _walk(n, out)
        return
    if not isinstance(node, dict):
        return
    t = node.get("type")
    if t == "TextBlock" and str(node.get("text", "")).strip():
        out["blocks"].append(
            {
                "text": str(node["text"]).strip(),
                "size": node.get("size", "default").lower(),
                "bold": str(node.get("weight", "")).lower() == "bolder",
                "subtle": bool(node.get("isSubtle")),
            }
        )
    elif t == "RichTextBlock":
        text = "".join(i.get("text", "") if isinstance(i, dict) else str(i) for i in node.get("inlines", []))
        if text.strip():
            out["blocks"].append({"text": text.strip(), "size": "default", "bold": False, "subtle": False})
    elif t == "FactSet":
        for f in node.get("facts", []):
            out["blocks"].append({"text": f"{f.get('title', '')}: {f.get('value', '')}", "size": "small", "bold": False, "subtle": False})
    elif t == "Image" and str(node.get("url", "")).startswith("https://"):
        out["images"].append(node["url"])
    elif t and t.startswith("Action."):
        a = _action(node)
        if a:
            out["actions"].append(a)
    for key in ("body", "items", "columns", "actions", "card"):
        if key in node:
            _walk(node[key], out)
    if node.get("selectAction"):
        _walk(node["selectAction"], out)


def _cards(content: str) -> list[dict]:
    m = _SWIFT.search(content or "")
    if not m:
        return []
    try:
        swift = json.loads(base64.b64decode(m.group(1)))
    except ValueError:
        return []
    cards = []
    for att in swift.get("attachments", []):
        c = att.get("content") or {}
        out = {"blocks": [], "images": [], "actions": []}
        ctype = att.get("contentType", "")
        if ctype.endswith("card.adaptive"):
            _walk(c.get("body", []), out)
            _walk(c.get("actions", []), out)
        else:  # hero / thumbnail / o365 connector cards
            for key, size, bold in (("title", "large", True), ("subtitle", "default", False), ("text", "default", False)):
                if c.get(key):
                    out["blocks"].append({"text": _TAG.sub(" ", str(c[key])).strip(), "size": size, "bold": bold, "subtle": key == "subtitle"})
            out["images"] += [i["url"] for i in c.get("images", []) if str(i.get("url", "")).startswith("https://")]
            out["actions"] += [a for a in (_action(b) for b in c.get("buttons", [])) if a]
        if out["blocks"] or out["actions"]:
            cards.append(out)
    return cards


def _files(props: dict) -> list[dict]:
    files = props.get("files")
    if isinstance(files, str):
        try:
            files = json.loads(files)
        except ValueError:
            files = []
    return [
        {
            "name": f.get("fileName") or f.get("title") or "File",
            "url": f.get("objectUrl") or (f.get("fileInfo") or {}).get("fileUrl"),
            "type": (f.get("fileType") or "").lower(),
            "size": f.get("fileSize"),
        }
        for f in files or []
        if isinstance(f, dict)
    ]


def _preview(m: dict) -> str:
    if m.get("messagetype") == "RichText/Media_Card":
        cards = _cards(m.get("content", ""))
        return cards[0]["blocks"][0]["text"][:200] if cards and cards[0]["blocks"] else "Card"
    text = text_of(m.get("content", ""))
    if not text:
        files = _files(m.get("properties") or {})
        return files[0]["name"] if files else ""
    return text


def _message(m: dict, my: str) -> dict | None:
    mtype = m.get("messagetype", "")
    if not (mtype.startswith("RichText") or mtype == "Text"):
        return None
    props = m.get("properties") or {}
    card = mtype == "RichText/Media_Card"
    return {
        "id": m["id"],
        "fromId": _oid(m.get("from", "")),
        "from": m.get("imdisplayname") or "",
        "mine": _oid(m.get("from", "")) == my,
        "time": m.get("composetime"),
        "html": "" if props.get("deletetime") or card else m.get("content", ""),
        "format": "html" if mtype.startswith("RichText") else "text",
        "cards": _cards(m.get("content", "")) if card else [],
        "files": _files(props),
        "edited": bool(props.get("edittime")),
        "deleted": bool(props.get("deletetime")),
        "subject": props.get("subject") or None,
    }


async def messages(conv: str, cursor: str | None) -> dict:
    my = (await me())["id"]
    path = cursor or (
        f"/v1/users/ME/conversations/{conv}/messages"
        "?view=msnp24Equivalent|supportsMessageProperties&pageSize=50&startTime=1"
    )
    d = (await _chat("GET", path)).json()
    items = [x for x in (_message(m, my) for m in d.get("messages", [])) if x]
    items.reverse()  # oldest first
    return {"messages": items, "cursor": d.get("_metadata", {}).get("backwardLink")}


async def send(conv: str, text: str) -> dict:
    my = await me()
    body = "".join(f"<p>{html.escape(line) or '&nbsp;'}</p>" for line in text.split("\n"))
    payload = {
        "content": body,
        "messagetype": "RichText/Html",
        "contenttype": "text",
        "clientmessageid": str(secrets.randbelow(10**18) + 10**18),
        "imdisplayname": my["name"],
        "properties": {"importance": "", "subject": ""},
    }
    r = await _chat("POST", f"/v1/users/ME/conversations/{conv}/messages", json=payload)
    return {"id": str(r.json().get("OriginalArrivalTime", "")), "clientId": payload["clientmessageid"]}


async def mark_read(conv: str, message_id: str) -> None:
    now = int(time.time() * 1000)
    await _chat(
        "PUT",
        f"/v1/users/ME/conversations/{conv}/properties?name=consumptionhorizon",
        json={"consumptionhorizon": f"{message_id};{now};{message_id}"},
    )


# ---- teams and channels ----------------------------------------------------

async def teams() -> list[dict]:
    global _teams
    if _teams and _teams[0] > time.time() - 600:
        return _teams[1]
    ts = (await _graph("/me/joinedTeams?$select=id,displayName,description")).get("value", [])

    async def channels(t):
        try:
            cs = (await _graph(f"/teams/{t['id']}/channels?$select=id,displayName,membershipType")).get("value", [])
        except Upstream:
            cs = []
        return {
            "id": t["id"],
            "name": t["displayName"],
            "channels": [{"id": c["id"], "name": c["displayName"]} for c in cs],
        }

    out = sorted(await asyncio.gather(*(channels(t) for t in ts)), key=lambda t: t["name"].lower())
    _teams = (time.time(), out)
    return out


# ---- assignments -----------------------------------------------------------

async def _class_names() -> dict[str, str]:
    return {t["id"]: t["name"] for t in await teams()}


def _assignment(a: dict, classes: dict[str, str]) -> dict:
    return {
        "id": a["id"],
        "classId": a["classId"],
        "className": classes.get(a["classId"], ""),
        "title": a.get("displayName", ""),
        "due": a.get("dueDateTime"),
        "closes": a.get("closeDateTime"),
        "assigned": a.get("assignedDateTime"),
        # per student: the own submission decides, the assignment flags are the teacher's view
        "done": _sub_done(a) if "submissions" in a else bool(a.get("isCompleted")),
        "status": a.get("status"),
        "points": (a.get("grading") or {}).get("maxPoints"),
        "webUrl": a.get("webUrl"),
    }


def _sub_done(a: dict) -> bool:
    return any(s.get("status") in ("submitted", "returned") for s in a.get("submissions") or [])


async def assignments() -> list[dict]:
    classes = await _class_names()
    d = await _graph("/me/work?$top=200&$expand=submissions($select=status)", base=ASSIGNMENTS)
    out = [_assignment(a, classes) for a in d.get("value", [])]
    out.sort(key=lambda a: a["due"] or "9999")
    return out


async def assignment(class_id: str, aid: str) -> dict:
    classes = await _class_names()
    a = await _graph(f"/classes/{class_id}/assignments/{aid}?$expand=resources", base=ASSIGNMENTS)
    subs = await _graph(
        f"/classes/{class_id}/assignments/{aid}/submissions?$expand=resources,submittedResources,outcomes",
        base=ASSIGNMENTS,
    )
    a["submissions"] = subs.get("value") or []
    out = _assignment(a, classes)
    out["instructions"] = (a.get("instructions") or {}).get("content", "")
    out["resources"] = [_resource(r) for r in a.get("resources", [])]
    sub = (subs.get("value") or [None])[0]
    if sub:
        out["submission"] = {
            "id": sub["id"],
            "status": sub.get("status"),
            "submitted": sub.get("submittedDateTime"),
            "returned": sub.get("returnedDateTime"),
            "resources": [_resource(r) for r in sub.get("resources", [])],
            "feedback": [
                (o.get("feedback") or {}).get("text", {}).get("content")
                for o in sub.get("outcomes", [])
                if (o.get("feedback") or {}).get("text")
            ],
            "points": next(
                ((o.get("points") or {}).get("points") for o in sub.get("outcomes", []) if o.get("points")),
                None,
            ),
        }
    return out


def _resource(r: dict) -> dict:
    res = r.get("resource") or {}
    return {
        "id": r.get("id"),
        "name": res.get("displayName", ""),
        "kind": (res.get("@odata.type") or "").rsplit(".", 1)[-1],
        "url": res.get("link") or res.get("fileUrl") or r.get("webUrl") or None,
    }

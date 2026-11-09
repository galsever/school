"""Teams API server. Contract: docs/API.md."""

import asyncio
import logging
import time
from urllib.parse import urlencode

from fastapi import Body, Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, StreamingResponse

from . import auth, config, mail, mcp, upstream
from .ms import NotConnected, session

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("teams")

app = FastAPI(title="Teams", docs_url=None, redoc_url=None, openapi_url=None)
guard = [Depends(auth.require)]


@app.exception_handler(HTTPException)
async def _http_error(request: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, dict) else {"error": "error", "detail": str(exc.detail)}
    return JSONResponse(detail, status_code=exc.status_code)


@app.exception_handler(NotConnected)
async def _not_connected(request: Request, exc: NotConnected):
    return JSONResponse({"error": "ms_not_connected", "detail": "Sign in to Microsoft first"}, status_code=409)


@app.exception_handler(upstream.Upstream)
async def _upstream(request: Request, exc: upstream.Upstream):
    log.warning("upstream %s %s: %s", request.url.path, exc.status, exc)
    status = exc.status if exc.status in (400, 404) else 502
    return JSONResponse({"error": "upstream", "detail": str(exc)[:300]}, status_code=status)


# ---- app login (only when APP_AUTH=password) ---------------------------------

@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/api/auth/me")
def auth_me(request: Request):
    return {"authenticated": auth.is_authenticated(request)}


@app.get("/api/app/handoff")
def app_handoff(request: Request, state: str = ""):
    """Android login: the app opens the Pocket ID gate in a Chrome tab with rd= this URL; behind the gate
    the request carries the gate cookie, which goes back to the app through its own scheme."""
    cookie = request.cookies.get("_oauth2_proxy")
    if not cookie or not state or len(state) > 64:
        raise HTTPException(400, "no gate session")
    return RedirectResponse(
        "com.galsever.teams://auth?" + urlencode({"state": state, "c": cookie}),
        status_code=302,
        headers={"Cache-Control": "no-store"},
    )


_failed: list[float] = []


@app.post("/api/auth/login")
async def login(payload: dict = Body(...)):
    now = time.time()
    _failed[:] = [t for t in _failed if now - t < 600]
    if len(_failed) >= 10:
        raise HTTPException(429, {"error": "too_many_attempts", "detail": "Try again later"})
    if not auth.check_password(str(payload.get("password", ""))):
        _failed.append(now)
        await asyncio.sleep(1)
        raise HTTPException(401, {"error": "bad_password", "detail": "Wrong password"})
    response = Response(status_code=204)
    auth.issue(response)
    return response


@app.post("/api/auth/logout")
def logout():
    response = Response(status_code=204)
    auth.clear(response)
    return response


# ---- Microsoft account -------------------------------------------------------

@app.get("/api/ms/status", dependencies=guard)
async def ms_status():
    if not session.connected:
        return {"connected": False, "device": session.device}
    return {"connected": True, "me": await upstream.me()}


@app.post("/api/ms/device", dependencies=guard)
async def ms_device():
    return await session.start_device_login()


@app.get("/api/ms/device", dependencies=guard)
def ms_device_state():
    return session.device or {"state": "none"}


@app.post("/api/ms/logout", dependencies=guard)
def ms_logout():
    session.logout()
    return Response(status_code=204)


# ---- chats -------------------------------------------------------------------

@app.get("/api/chats", dependencies=guard)
async def chats():
    return await upstream.chats()


@app.get("/api/chats/{conv}/messages", dependencies=guard)
async def messages(conv: str, cursor: str | None = None):
    return await upstream.messages(conv, cursor)


@app.post("/api/chats/{conv}/messages", dependencies=guard)
async def send(conv: str, payload: dict = Body(...)):
    text = str(payload.get("text", "")).strip()
    if not text or len(text) > 28000:
        raise HTTPException(400, {"error": "bad_text", "detail": "Empty or too long"})
    return await upstream.send(conv, text)


@app.post("/api/chats/{conv}/read", dependencies=guard)
async def mark_read(conv: str, payload: dict = Body(...)):
    mid = str(payload.get("messageId", ""))
    if not mid.isdigit():
        raise HTTPException(400, {"error": "bad_id", "detail": "messageId"})
    await upstream.mark_read(conv, mid)
    return Response(status_code=204)


@app.get("/api/media", dependencies=guard)
async def media(url: str):
    if not upstream.media_allowed(url):
        raise HTTPException(400, {"error": "bad_url", "detail": "Not a Teams media URL"})
    body, ctype = await upstream.media(url)
    return Response(body, media_type=ctype, headers={"Cache-Control": "private, max-age=86400"})


# ---- teams, assignments ------------------------------------------------------

@app.get("/api/teams", dependencies=guard)
async def teams():
    return await upstream.teams()


def _ids(*ids: str) -> None:
    if not all(upstream.DRIVE_ID.match(i) for i in ids):
        raise HTTPException(400, {"error": "bad_id", "detail": "Bad id"})


@app.get("/api/teams/{team_id}/channels/{channel_id}/files", dependencies=guard)
async def channel_files(team_id: str, channel_id: str):
    return await upstream.channel_folder(team_id, channel_id)


@app.get("/api/drives/{drive}/items/{item}/children", dependencies=guard)
async def folder(drive: str, item: str):
    _ids(drive, item)
    return await upstream.folder(drive, item)


@app.get("/api/drives/{drive}/items/{item}/view", dependencies=guard)
async def view_file(drive: str, item: str, download: bool = False):
    """Streams the file: PDFs, images, text inline; Office files converted to PDF; the rest as download."""
    _ids(drive, item)
    from urllib.parse import quote

    name, mime, inline, body = await upstream.file_stream(drive, item)
    disposition = "inline" if inline and not download else "attachment"
    return StreamingResponse(
        body,
        media_type=mime,
        headers={
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(name)}",
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.get("/api/assignments", dependencies=guard)
async def assignments():
    return await upstream.assignments()


@app.get("/api/assignments/{class_id}/{aid}", dependencies=guard)
async def assignment(class_id: str, aid: str):
    return await upstream.assignment(class_id, aid)


MAX_UPLOAD = 250 * 1024 * 1024


@app.post("/api/assignments/{class_id}/{aid}/files", dependencies=guard)
async def upload(class_id: str, aid: str, request: Request, name: str):
    """Raw file body; name in the query. Streams into a Graph upload session."""
    size = int(request.headers.get("content-length") or 0)
    name = name.strip().replace("/", "_").replace("\\", "_")[:200]
    if not name or not 0 < size <= MAX_UPLOAD:
        raise HTTPException(400, {"error": "bad_file", "detail": "Empty, too big or no name"})
    return await upstream.upload(class_id, aid, name, size, request.stream())


@app.delete("/api/assignments/{class_id}/{aid}/files/{rid}", dependencies=guard)
async def remove_file(class_id: str, aid: str, rid: str):
    await upstream.remove_file(class_id, aid, rid)
    return Response(status_code=204)


@app.post("/api/assignments/{class_id}/{aid}/turn-in", dependencies=guard)
async def turn_in(class_id: str, aid: str):
    await upstream.turn_in(class_id, aid)
    return Response(status_code=204)


@app.post("/api/assignments/{class_id}/{aid}/undo-turn-in", dependencies=guard)
async def undo_turn_in(class_id: str, aid: str):
    await upstream.turn_in(class_id, aid, undo=True)
    return Response(status_code=204)


@app.get("/api/files/open", dependencies=guard)
async def open_file(url: str):
    """Assignment files are Graph drive item URLs; send the browser to the SharePoint page."""
    if not url.startswith(upstream.GRAPH_URL + "/drives/"):
        raise HTTPException(400, {"error": "bad_url", "detail": "Not a drive item"})
    return RedirectResponse(await upstream.file_web_url(url), status_code=302)


# ---- mail (school Outlook) ---------------------------------------------------------

def _mid(*ids: str) -> None:
    if not all(mail.valid_id(i) for i in ids):
        raise HTTPException(400, {"error": "bad_id", "detail": "Bad id"})


@app.get("/api/mail", dependencies=guard)
async def mail_list(folder: str = "inbox", cursor: str | None = None, unread: bool = False, q: str = ""):
    return await mail.list_mail(folder, cursor, unread, q.strip())


@app.get("/api/mail/unread", dependencies=guard)
async def mail_unread():
    return {"count": await mail.unread_count()}


@app.get("/api/mail/people", dependencies=guard)
async def mail_people(q: str):
    return await mail.search_people(q) if len(q.strip()) >= 2 else []


@app.post("/api/mail/send", dependencies=guard)
async def mail_send(payload: dict = Body(...)):
    to = [str(a) for a in payload.get("to") or []]
    cc = [str(a) for a in payload.get("cc") or []]
    text = str(payload.get("text", "")).strip()
    if not to or not text:
        raise HTTPException(400, {"error": "bad_mail", "detail": "Recipient and text needed"})
    await mail.send(to, str(payload.get("subject", ""))[:300], text, cc)
    return Response(status_code=204)


@app.get("/api/mail/{mid}", dependencies=guard)
async def mail_get(mid: str):
    _mid(mid)
    return await mail.get_mail(mid)


@app.post("/api/mail/{mid}/reply", dependencies=guard)
async def mail_reply(mid: str, payload: dict = Body(...)):
    _mid(mid)
    text = str(payload.get("text", "")).strip()
    if not text:
        raise HTTPException(400, {"error": "bad_mail", "detail": "Empty text"})
    await mail.reply(mid, text, bool(payload.get("all")))
    return Response(status_code=204)


@app.get("/api/mail/{mid}/attachments/{aid}/parts/{n}", dependencies=guard)
async def mail_signed_part(mid: str, aid: str, n: int, download: bool = False):
    """A file from inside an S/MIME signed mail (see mail.signed_parts)."""
    _mid(mid, aid)
    parts = await mail.signed_parts(mid, aid)
    if not 0 <= n < len(parts):
        raise HTTPException(404, {"error": "not_found", "detail": "No such part"})
    return _mail_file(parts[n]["data"], parts[n]["type"], parts[n]["name"] or "file", download)


@app.get("/api/mail/{mid}/attachments/{aid}", dependencies=guard)
async def mail_attachment(mid: str, aid: str, download: bool = False):
    _mid(mid, aid)
    return _mail_file(*await mail.attachment(mid, aid), download)


def _mail_file(data: bytes, ctype: str, name: str, download: bool) -> Response:
    from urllib.parse import quote

    inline = ctype.startswith(("image/", "application/pdf", "text/plain")) and "svg" not in ctype and not download
    return Response(
        data,
        media_type=ctype,
        headers={
            "Content-Disposition": f"{'inline' if inline else 'attachment'}; filename*=UTF-8''{quote(name)}",
            "Cache-Control": "private, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ---- MCP (own bearer token, no app login) ------------------------------------------

app.add_api_route("/api/mcp", mcp.handle, methods=["GET", "POST", "DELETE"], include_in_schema=False)


# ---- website -----------------------------------------------------------------

@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, {"error": "not_found", "detail": "Not found"})
    target = (config.WEB_DIR / path).resolve()
    if path and target.is_file() and config.WEB_DIR.resolve() in target.parents:
        cache_header = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
        return FileResponse(target, headers={"Cache-Control": cache_header})
    index = config.WEB_DIR / "index.html"
    if not index.exists():
        return JSONResponse({"error": "no_frontend", "detail": "Website not built"}, status_code=503)
    return FileResponse(index, headers={"Cache-Control": "no-cache"})

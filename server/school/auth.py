"""App login: one password, a signed long-lived session cookie."""

import hashlib
import hmac
import time

from fastapi import HTTPException, Request, Response

from . import config

COOKIE = "tm_session"
MAX_AGE = 90 * 24 * 3600


def _sign(payload: str) -> str:
    return hmac.new(config.SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def issue(response: Response) -> None:
    issued = str(int(time.time()))
    response.set_cookie(
        COOKIE,
        f"{issued}.{_sign(issued)}",
        max_age=MAX_AGE,
        httponly=True,
        secure=config.SECURE_COOKIES,
        samesite="strict",
        path="/",
    )


def clear(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/")


def is_authenticated(request: Request) -> bool:
    if config.APP_AUTH == "none":
        return True
    raw = request.cookies.get(COOKIE, "")
    issued, _, sig = raw.partition(".")
    if not issued.isdigit() or not hmac.compare_digest(sig, _sign(issued)):
        return False
    return time.time() - int(issued) < MAX_AGE


def check_password(password: str) -> bool:
    return hmac.compare_digest(password.encode(), config.APP_PASSWORD.encode())


def require(request: Request) -> None:
    if not is_authenticated(request):
        raise HTTPException(401, {"error": "login_required", "detail": "Login required"})

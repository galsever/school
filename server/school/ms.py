"""Microsoft sign-in: device code flow with the Teams public client, one refresh token for everything.

The refresh token (DATA_DIR/tokens.json) is exchanged per resource:
- spaces (api.spaces.skype.com) -> authsvc -> skype token for the chat service
- graph (graph.microsoft.com) -> Graph and the Assignments backend (assignments.onenote.com)
"""

import asyncio
import json
import logging
import os
import time

import httpx

from . import config

log = logging.getLogger("school.ms")

CLIENT_ID = "1fec8e78-bce4-4aaf-ab1b-5451cc387264"  # Microsoft Teams public client
AUTHORITY = "https://login.microsoftonline.com/organizations/oauth2/v2.0"
SPACES = "https://api.spaces.skype.com/.default"
GRAPH = "https://graph.microsoft.com/.default"
TOKEN_FILE = config.DATA_DIR / "tokens.json"


class NotConnected(Exception):
    pass


class Session:
    def __init__(self) -> None:
        self.http = httpx.AsyncClient(timeout=30)
        self._refresh: str | None = None
        self._access: dict[str, tuple[str, float]] = {}
        self._skype: tuple[str, str, float] | None = None  # token, chat service url, expiry
        self._lock = asyncio.Lock()
        self.device: dict | None = None  # running device login, for the UI
        if TOKEN_FILE.exists():
            self._refresh = json.loads(TOKEN_FILE.read_text()).get("refresh_token")

    @property
    def connected(self) -> bool:
        return bool(self._refresh)

    def _save(self, refresh: str) -> None:
        self._refresh = refresh
        fd = os.open(TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump({"refresh_token": refresh}, f)

    def logout(self) -> None:
        self._refresh = None
        self._access.clear()
        self._skype = None
        TOKEN_FILE.unlink(missing_ok=True)

    # ---- device login ------------------------------------------------------

    async def start_device_login(self) -> dict:
        r = await self.http.post(
            f"{AUTHORITY}/devicecode",
            data={"client_id": CLIENT_ID, "scope": f"{SPACES} offline_access openid profile"},
        )
        r.raise_for_status()
        d = r.json()
        self.device = {
            "state": "pending",
            "userCode": d["user_code"],
            "url": d["verification_uri"],
            "expiresAt": time.time() + d["expires_in"],
        }
        asyncio.create_task(self._poll_device(d["device_code"], d.get("interval", 5), self.device))
        return self.device

    async def _poll_device(self, code: str, interval: int, state: dict) -> None:
        while time.time() < state["expiresAt"] and self.device is state:
            await asyncio.sleep(interval)
            r = await self.http.post(
                f"{AUTHORITY}/token",
                data={
                    "client_id": CLIENT_ID,
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    "device_code": code,
                },
            )
            body = r.json()
            if "refresh_token" in body:
                self._access.clear()
                self._skype = None
                self._save(body["refresh_token"])
                state["state"] = "done"
                return
            if body.get("error") == "slow_down":
                interval += 5
            elif body.get("error") != "authorization_pending":
                log.warning("device login failed: %s", body.get("error"))
                state["state"] = "failed"
                return
        if state["state"] == "pending":
            state["state"] = "expired"

    # ---- tokens ------------------------------------------------------------

    async def token(self, scope: str) -> str:
        hit = self._access.get(scope)
        if hit and hit[1] > time.time() + 120:
            return hit[0]
        async with self._lock:
            hit = self._access.get(scope)
            if hit and hit[1] > time.time() + 120:
                return hit[0]
            if not self._refresh:
                raise NotConnected()
            r = await self.http.post(
                f"{AUTHORITY}/token",
                data={
                    "client_id": CLIENT_ID,
                    "grant_type": "refresh_token",
                    "refresh_token": self._refresh,
                    "scope": scope,
                },
            )
            body = r.json()
            if "access_token" not in body:
                log.warning("token refresh failed: %s %s", body.get("error"), body.get("error_codes"))
                if body.get("error") in ("invalid_grant", "interaction_required"):
                    self.logout()
                    raise NotConnected()
                raise RuntimeError(body.get("error_description", "token refresh failed")[:300])
            if body.get("refresh_token") and body["refresh_token"] != self._refresh:
                self._save(body["refresh_token"])
            self._access[scope] = (body["access_token"], time.time() + int(body.get("expires_in", 3600)))
            return body["access_token"]

    async def skype(self) -> tuple[str, str]:
        """Skype token and regional chat service base URL."""
        if self._skype and self._skype[2] > time.time() + 300:
            return self._skype[0], self._skype[1]
        bearer = await self.token(SPACES)
        r = await self.http.post(
            "https://teams.microsoft.com/api/authsvc/v1.0/authz",
            headers={"Authorization": f"Bearer {bearer}"},
        )
        r.raise_for_status()
        a = r.json()
        tok = a["tokens"]["skypeToken"]
        self._skype = (tok, a["regionGtms"]["chatService"], time.time() + int(a["tokens"].get("expiresIn", 3600)))
        return self._skype[0], self._skype[1]


session = Session()

"""Settings from the environment. Secrets are generated into DATA_DIR on first start."""

import os
import secrets
from pathlib import Path

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
WEB_DIR = Path(os.environ.get("WEB_DIR", "/app/web"))
SECURE_COOKIES = os.environ.get("SECURE_COOKIES", "1") == "1"
# The public host name; page requests on any other name (the old teams.galsever.com) are redirected to it.
CANONICAL_HOST = os.environ.get("CANONICAL_HOST", "")

DATA_DIR.mkdir(parents=True, exist_ok=True)


def _secret_file(name: str, factory) -> str:
    path = DATA_DIR / name
    if not path.exists():
        path.write_text(factory())
        path.chmod(0o600)
    return path.read_text().strip()


SESSION_SECRET = _secret_file("session-secret", lambda: secrets.token_hex(32))
# Login: "none" when a gate in front does it (Pocket ID via personal-infra); "password" anywhere else.
APP_AUTH = os.environ.get("APP_AUTH", "password")
APP_PASSWORD = os.environ.get("APP_PASSWORD") or (
    _secret_file("app-password", lambda: secrets.token_urlsafe(18)) if APP_AUTH == "password" else ""
)

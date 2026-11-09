"""Own display names and hidden flags for teams and channels (DATA_DIR/prefs.json). Microsoft never sees them.

Keys are team ids (GUID) and channel ids (19:...@thread.tacv2); the two never collide.
"""

import json
import re

from . import config

FILE = config.DATA_DIR / "prefs.json"
ID = re.compile(r"^[A-Za-z0-9:@._\-]{10,200}$")
_data: dict | None = None


def _load() -> dict:
    global _data
    if _data is None:
        try:
            d = json.loads(FILE.read_text())
        except (OSError, ValueError):
            d = {}
        _data = {"names": dict(d.get("names") or {}), "hidden": list(d.get("hidden") or [])}
    return _data


def any_set() -> bool:
    d = _load()
    return bool(d["names"] or d["hidden"])


def name(item: str, default: str) -> str:
    return _load()["names"].get(item) or default


def hidden(item: str) -> bool:
    return item in _load()["hidden"]


def update(item: str, changes: dict) -> None:
    """`name`: the own name, empty or null puts Microsoft's back. `hidden`: true or false."""
    d = _load()
    if "name" in changes:
        n = str(changes["name"] or "").strip()[:80]
        if n:
            d["names"][item] = n
        else:
            d["names"].pop(item, None)
    if "hidden" in changes:
        if changes["hidden"] and item not in d["hidden"]:
            d["hidden"].append(item)
        elif not changes["hidden"] and item in d["hidden"]:
            d["hidden"].remove(item)
    tmp = FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1))
    tmp.replace(FILE)

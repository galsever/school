"""mail.compose and mail.thread against a fake Graph (no real mailbox)."""

import asyncio

import pytest

from school import mail
from school.upstream import Upstream


class Resp:
    def __init__(self, data=None):
        self.data = data or {}
        self.status_code = 200

    def json(self):
        return self.data


def fake(monkeypatch, answers):
    calls = []

    async def req(method, path, **kw):
        calls.append((method, path, kw.get("json")))
        for (m, prefix), data in answers.items():
            if m == method and path.startswith(prefix):
                return Resp(data(path) if callable(data) else data)
        return Resp()

    monkeypatch.setattr(mail, "_req", req)
    return calls


def test_prepend_goes_after_body_tag():
    assert mail._prepend("<p>hi</p>", '<html><body dir="ltr"><hr>old</body></html>') == '<html><body dir="ltr"><p>hi</p><hr>old</body></html>'
    assert mail._prepend("<p>hi</p>", "old") == "<p>hi</p>old"


def test_reply_patches_draft_and_sends(monkeypatch):
    calls = fake(monkeypatch, {("POST", "/me/messages/abcdefghijk/createReplyAll"): {"id": "draft1", "body": {"contentType": "html", "content": "<html><body><hr>q</body></html>"}}})
    asyncio.run(mail.compose("replyAll", "abcdefghijk", ["a@b.at"], ["c@d.at"], "", "<div>x</div>", [{"name": "f.txt", "type": "text/plain", "data": b"hi"}]))
    methods = [(m, p) for m, p, _ in calls]
    assert methods == [
        ("POST", "/me/messages/abcdefghijk/createReplyAll"),
        ("PATCH", "/me/messages/draft1"),
        ("POST", "/me/messages/draft1/attachments"),
        ("POST", "/me/messages/draft1/send"),
    ]
    patch = calls[1][2]
    assert patch["body"]["content"] == "<html><body><div>x</div><hr>q</body></html>"
    assert patch["toRecipients"] == [{"emailAddress": {"address": "a@b.at"}}]
    assert "subject" not in patch
    assert calls[2][2]["contentBytes"] == "aGk="


def test_failed_send_deletes_draft(monkeypatch):
    calls = []

    async def req(method, path, **kw):
        calls.append((method, path))
        if path.endswith("/send"):
            raise Upstream(400, "nope")
        return Resp({"id": "d2"})

    monkeypatch.setattr(mail, "_req", req)
    with pytest.raises(Upstream):
        asyncio.run(mail.compose("new", None, ["a@b.at"], [], "s", "<p>x</p>", []))
    assert calls[-1] == ("DELETE", "/me/messages/d2")


def test_compose_checks_mode_and_size(monkeypatch):
    fake(monkeypatch, {})
    with pytest.raises(Upstream):
        asyncio.run(mail.compose("reply", None, ["a@b.at"], [], "", "x", []))
    with pytest.raises(Upstream):
        asyncio.run(mail.compose("new", None, ["a@b.at"], [], "", "x", [{"name": "big", "type": "x", "data": b"0" * (mail.MAX_FILES + 1)}]))
    with pytest.raises(Upstream):
        asyncio.run(mail.compose("new", None, ["not an address"], [], "", "x", []))


def test_thread_sorts_and_skips_drafts_and_deleted(monkeypatch):
    mail._skip_folders.clear()

    def msg(i, t, **kw):
        return {"id": i, "receivedDateTime": t, "isRead": True, "body": {"contentType": "html", "content": f"<p>{i}</p>"}, **kw}

    listing = {
        "value": [
            msg("opened00001", "2026-11-02T10:00:00Z", parentFolderId="inbox"),
            msg("older000001", "2026-11-01T10:00:00Z", parentFolderId="sent"),
            msg("draft000001", "2026-11-03T10:00:00Z", parentFolderId="drafts-id", isDraft=True),
            msg("trash000001", "2026-11-04T10:00:00Z", parentFolderId="deleted-id"),
        ]
    }
    fake(
        monkeypatch,
        {
            ("GET", "/me/messages/opened00001?"): {"conversationId": "c1", "subject": "Re: x"},
            ("GET", "/me/messages?$filter="): listing,
            ("GET", "/me/mailFolders/deleteditems"): {"id": "deleted-id"},
            ("GET", "/me/mailFolders/drafts"): {"id": "drafts-id"},
        },
    )
    t = asyncio.run(mail.thread("opened00001", mark_read=False))
    assert t["subject"] == "Re: x"
    assert [m["id"] for m in t["messages"]] == ["older000001", "opened00001"]
    mail._skip_folders.clear()

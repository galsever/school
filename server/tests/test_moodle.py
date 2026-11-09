"""Moodle client against a fake Moodle (httpx.MockTransport): login, token renewal, cache, file urls, submissions."""

import asyncio
import io
import json
import zipfile
from urllib.parse import parse_qs

import httpx
import pytest

from school import moodle as md
from school import moodle_api as api

BASE = "https://moodle.test"


class FakeMoodle:
    def __init__(self):
        self.password = "right"
        self.token = "tok1"
        self.logins = 0
        self.calls: list[tuple[str, dict]] = []
        self.uploads: list[tuple[str, str, bytes]] = []
        self.answers: dict[str, object] = {
            "core_webservice_get_site_info": {"userid": 7, "sitename": "Test"},
            "core_files_get_unused_draft_itemid": {"itemid": 900},
            "mod_assign_save_submission": [],
            "mod_assign_submit_for_grading": [],
        }
        self.files: dict[str, bytes] = {}

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/login/token.php":
            self.logins += 1
            form = parse_qs(request.content.decode())
            if form["password"][0] != self.password:
                return httpx.Response(200, json={"error": "Invalid login", "errorcode": "invalidlogin"})
            return httpx.Response(200, json={"token": self.token})
        if path == "/webservice/rest/server.php":
            form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
            if form.pop("wstoken") != self.token:
                return httpx.Response(200, json={"exception": "x", "errorcode": "invalidtoken", "message": "Invalid token"})
            fn = form.pop("wsfunction")
            form.pop("moodlewsrestformat")
            self.calls.append((fn, form))
            return httpx.Response(200, json=self.answers[fn])
        if path == "/webservice/upload.php":
            body = request.content
            name = body.split(b'filename="')[1].split(b'"')[0].decode()
            item = body.split(b'name="itemid"\r\n\r\n')[1].split(b"\r\n")[0].decode()
            data = body.split(b"\r\n\r\n")[-1].rsplit(b"\r\n--", 1)[0]
            self.uploads.append((item, name, data))
            return httpx.Response(200, json=[{"itemid": int(item), "filename": name}])
        if path.startswith("/webservice/pluginfile.php/"):
            if request.url.params.get("token") != self.token:
                return httpx.Response(200, json={"errorcode": "invalidtoken", "message": "Invalid token"})
            data = self.files.get(path)
            if data is None:
                return httpx.Response(404, json={"errorcode": "filenotfound", "message": "No file"})
            return httpx.Response(200, content=data, headers={"content-type": "application/pdf", "content-disposition": 'inline; filename="a b.pdf"'})
        return httpx.Response(404)


@pytest.fixture
def fake(monkeypatch):
    f = FakeMoodle()
    for p in (md._LOGIN, md._STATE):
        p.unlink(missing_ok=True)
    md._LOGIN.write_text(json.dumps({"url": BASE, "user": "me", "password": "right"}))
    monkeypatch.setattr(md, "_http", httpx.AsyncClient(transport=httpx.MockTransport(f.handle)))
    monkeypatch.setattr(md, "_state", None)
    monkeypatch.setattr(md, "_site", None)
    md.drop_cache()
    yield f
    for p in (md._LOGIN, md._STATE):
        p.unlink(missing_ok=True)


def run(coro):
    return asyncio.run(coro)


def test_login_once_and_cache(fake):
    async def go():
        a = await md.cached("core_webservice_get_site_info")
        b = await md.cached("core_webservice_get_site_info")
        return a, b

    a, b = run(go())
    assert a == b == {"userid": 7, "sitename": "Test"}
    assert fake.logins == 1 and len(fake.calls) == 1
    md.drop_cache()
    run(md.cached("core_webservice_get_site_info"))
    assert len(fake.calls) == 2 and fake.logins == 1


def test_same_call_at_once_is_sent_once(fake):
    async def go():
        return await asyncio.gather(*(md.cached("core_webservice_get_site_info") for _ in range(5)))

    assert len(run(go())) == 5 and len(fake.calls) == 1


def test_rejected_token_is_renewed(fake):
    run(md.call("core_webservice_get_site_info"))
    fake.token = "tok2"
    assert run(md.call("core_webservice_get_site_info"))["userid"] == 7
    assert fake.logins == 2


def test_wrong_password_is_never_retried(fake):
    md._LOGIN.write_text(json.dumps({"url": BASE, "user": "me", "password": "typo"}))
    for _ in range(3):
        with pytest.raises(md.MoodleError) as e:
            run(md.call("core_webservice_get_site_info"))
        assert e.value.not_connected
    assert fake.logins == 1
    assert md.status()["blocked"]
    with pytest.raises(ValueError):
        run(md.set_login(BASE, "me", "typo"))
    assert fake.logins == 1
    run(md.set_login(BASE, "me", "right"))
    assert not md.status()["blocked"] and fake.logins == 2


def test_not_connected(fake):
    md._LOGIN.unlink()
    with pytest.raises(md.MoodleError) as e:
        run(md.call("core_webservice_get_site_info"))
    assert e.value.code == "not_connected"


def test_params_are_flattened(fake):
    fake.answers["mod_assign_save_submission"] = []
    run(md.call("mod_assign_save_submission", {"assignmentid": 3, "plugindata": {"files_filemanager": 9, "onlinetext_editor": {"text": "x", "format": 1}}, "ids": [4, 5], "on": True}))
    assert fake.calls[-1][1] == {
        "assignmentid": "3",
        "plugindata[files_filemanager]": "9",
        "plugindata[onlinetext_editor][text]": "x",
        "plugindata[onlinetext_editor][format]": "1",
        "ids[0]": "4",
        "ids[1]": "5",
        "on": "1",
    }


def test_file_url_stays_on_the_site(fake):
    ok = md._file_url(f"{BASE}/pluginfile.php/12/mod_resource/content/1/a.pdf?forcedownload=1", "T")
    assert ok == f"{BASE}/webservice/pluginfile.php/12/mod_resource/content/1/a.pdf?token=T"
    assert md._file_url(f"{BASE}/webservice/pluginfile.php/1/x?token=old", "T").endswith("/x?token=T")
    for bad in ("https://evil.test/pluginfile.php/1/a.pdf", f"{BASE}/login/index.php", f"{BASE}/pluginfile.php.evil/1", "http://moodle.test/pluginfile.php/1/a"):
        with pytest.raises(md.MoodleError):
            md._file_url(bad, "T")


def test_download_and_errors(fake):
    fake.files["/webservice/pluginfile.php/1/a.pdf"] = b"%PDF-data"
    name, mime, data = run(md.download(f"{BASE}/pluginfile.php/1/a.pdf"))
    assert (name, mime, data) == ("a b.pdf", "application/pdf", b"%PDF-data")
    with pytest.raises(md.MoodleError) as e:
        run(md.download(f"{BASE}/pluginfile.php/1/missing.pdf"))
    assert e.value.code == "filenotfound"


def test_html_helpers():
    assert md.plain("A &amp; B ") == "A & B"
    assert md.html_text("<p>Hello <b>you</b></p><ul><li>one</li><li>two</li></ul><a href='https://x.test/a'>link</a>") == "Hello you\n\n- one\n- two\nlink (https://x.test/a)"
    assert md.html_text("plain") == "plain"
    out = md.local_html(f'<img src="{BASE}/pluginfile.php/5/a.png?x=1&amp;y=2"> <a href="https://other.test/">o</a>')
    assert 'src="/api/moodle/file?url=https%3A%2F%2Fmoodle.test%2Fpluginfile.php%2F5%2Fa.png%3Fx%3D1%26y%3D2"' in out
    assert 'href="https://other.test/"' in out


ASSIGN = {
    "id": 40,
    "cmid": 400,
    "course": 2,
    "name": "Essay &amp; more",
    "intro": "<p>Write</p>",
    "duedate": 1_800_000_000,
    "submissiondrafts": 1,
    "configs": [
        {"plugin": "file", "subtype": "assignsubmission", "name": "enabled", "value": "1"},
        {"plugin": "file", "subtype": "assignsubmission", "name": "maxfilesubmissions", "value": "3"},
        {"plugin": "onlinetext", "subtype": "assignsubmission", "name": "enabled", "value": "1"},
    ],
}


def _status(files=("old.pdf", "keep.txt"), text="<p>before</p>", state="draft", canedit=True):
    return {
        "lastattempt": {
            "submission": {
                "status": state,
                "timemodified": 1_700_000_000,
                "plugins": [
                    {"type": "file", "fileareas": [{"area": "submission_files", "files": [{"filename": n, "fileurl": f"{BASE}/pluginfile.php/9/{n}"} for n in files]}]},
                    {"type": "onlinetext", "editorfields": [{"name": "onlinetext", "text": text}]},
                ],
            },
            "canedit": canedit,
            "gradingstatus": "notgraded",
        }
    }


def test_find_and_describe(fake):
    fake.answers["mod_assign_get_assignments"] = {"courses": [{"id": 2, "fullname": "Deutsch", "assignments": [ASSIGN, dict(ASSIGN, id=400, cmid=77)]}]}
    fake.answers["mod_assign_get_submission_status"] = _status()
    assert run(md.find_assignment(400, by="cmid"))["id"] == 40
    assert run(md.find_assignment(400, by="id"))["cmid"] == 77
    assert run(md.find_assignment(77))["id"] == 400
    with pytest.raises(md.MoodleError):
        run(md.find_assignment(1))
    d = run(md.describe_assignment(run(md.find_assignment(40))))
    assert d["name"] == "Essay & more" and d["course"] == "Deutsch" and d["maxFiles"] == 3 and d["files"] and d["onlineText"]
    assert d["submission"]["status"] == "draft" and d["submission"]["needsSubmit"] and d["submission"]["canEdit"]
    assert [f["name"] for f in d["submission"]["files"]] == ["old.pdf", "keep.txt"]
    out = api._assignment_out(d)
    assert out["submission_types"] == ["file (max 3 files)", "online_text"] and out["submission"]["online_text"] == "before"


def test_save_keeps_what_is_there(fake):
    fake.answers["mod_assign_get_submission_status"] = _status()
    fake.files["/webservice/pluginfile.php/9/old.pdf"] = b"OLD"
    fake.files["/webservice/pluginfile.php/9/keep.txt"] = b"KEEP"
    run(md.save_submission(ASSIGN, add=[("old.pdf", b"NEW"), ("extra.txt", io.BytesIO(b"EXTRA"))], remove=set()))
    # the kept file is copied into the fresh draft area, the same name is replaced, the online text goes along unchanged
    assert fake.uploads == [("900", "keep.txt", b"KEEP"), ("900", "old.pdf", b"NEW"), ("900", "extra.txt", b"EXTRA")]
    fn, form = fake.calls[-1]
    assert fn == "mod_assign_save_submission"
    assert form["plugindata[files_filemanager]"] == "900" and form["plugindata[onlinetext_editor][text]"] == "<p>before</p>"


def test_save_remove_and_replace(fake):
    fake.answers["mod_assign_get_submission_status"] = _status()
    fake.files["/webservice/pluginfile.php/9/keep.txt"] = b"KEEP"
    run(md.save_submission(ASSIGN, remove={"old.pdf"}, text="new text"))
    assert fake.uploads == [("900", "keep.txt", b"KEEP")]
    assert fake.calls[-1][1]["plugindata[onlinetext_editor][text]"] == "new text"
    fake.uploads.clear()
    run(md.save_submission(ASSIGN, add=[("only.txt", b"X")], replace_files=True))
    assert fake.uploads == [("900", "only.txt", b"X")]


def test_save_refuses_a_locked_submission(fake):
    fake.answers["mod_assign_get_submission_status"] = _status(canedit=False)
    with pytest.raises(md.MoodleError) as e:
        run(md.save_submission(ASSIGN, add=[("a.txt", b"A")]))
    assert e.value.code == "locked" and not fake.uploads


def test_save_reports_warnings(fake):
    fake.answers["mod_assign_get_submission_status"] = _status(files=())
    fake.answers["mod_assign_save_submission"] = [{"warningcode": "couldnotsavesubmission", "message": "Too many files"}]
    with pytest.raises(md.MoodleError) as e:
        run(md.save_submission(ASSIGN, add=[("a.txt", b"A")]))
    assert "Too many files" in str(e.value)


def test_deadlines_take_the_cmid_from_the_url(fake):
    fake.answers["core_calendar_get_action_events_by_timesort"] = {
        "events": [{"name": "x is due", "activityname": "Quiz &amp; Co", "modulename": "quiz", "instance": 5, "timesort": 1_800_000_000, "overdue": False, "url": f"{BASE}/mod/quiz/view.php?id=321", "course": {"id": 2, "fullname": "Deutsch"}, "action": {"name": "Attempt", "actionable": True}}]
    }
    row = run(md.deadlines())[0]
    assert row["cmid"] == 321 and row["name"] == "Quiz & Co" and row["action"] == "Attempt" and row["due"] == "2027-01-15T08:00:00Z"


def test_course_shape(fake):
    fake.answers["core_enrol_get_users_courses"] = [{"id": 2, "fullname": "Deutsch &amp; Co", "shortname": "D"}]
    fake.answers["core_course_get_contents"] = [
        {"id": 1, "section": 0, "name": "General", "summary": "", "modules": [
            {"id": 10, "name": "Script", "modname": "resource", "uservisible": True, "contents": [{"type": "file", "filename": "s.pdf", "filepath": "/", "fileurl": f"{BASE}/webservice/pluginfile.php/3/s.pdf?forcedownload=1", "filesize": 12, "mimetype": "application/pdf"}], "completiondata": {"state": 1}},
            {"id": 11, "name": "Hidden", "modname": "page", "uservisible": False},
            {"id": 12, "name": "Later", "modname": "assign", "uservisible": False, "availabilityinfo": "<b>Not yet</b>"},
            {"id": 13, "name": "Site", "modname": "url", "uservisible": True, "contents": [{"type": "url", "fileurl": "https://x.test/"}]},
            {"id": 14, "name": "Essay", "modname": "assign", "instance": 40, "uservisible": True},
            {"id": 15, "name": "Lab", "modname": "assign", "instance": 41, "uservisible": True},
        ]},
        {"id": 2, "section": 1, "name": "Empty", "summary": "<p> </p>", "modules": []},
    ]
    fake.answers["gradereport_user_get_grade_items"] = {"usergrades": [{"gradeitems": [
        {"itemname": "Essay", "itemtype": "mod", "itemmodule": "assign", "cmid": 14, "gradeformatted": "2"},
        {"itemname": "Lab", "itemtype": "mod", "itemmodule": "assign", "cmid": 15, "gradeformatted": "-"},
        {"itemname": "Test 1", "itemtype": "manual", "gradeformatted": "3", "rangeformatted": "1&ndash;5"},
        {"itemname": "Hidden", "itemtype": "manual", "gradeformatted": "5", "gradeishidden": True},
        {"itemname": None, "itemtype": "course", "gradeformatted": "2,5"},
    ]}]}
    fake.answers["mod_assign_get_submission_status"] = _status(state="submitted")
    c = run(md.course(2))
    assert c["name"] == "Deutsch & Co" and len(c["sections"]) == 1
    mods = c["sections"][0]["modules"]
    assert [m["cmid"] for m in mods] == [10, 12, 13, 14, 15]
    # assignments carry status and grade; a restricted one is not asked about
    assert (mods[3]["status"], mods[3]["grade"]) == ("submitted", "2") and (mods[4]["status"], mods[4]["grade"]) == ("submitted", None)
    assert mods[1]["status"] is None and len([c for c in fake.calls if c[0] == "mod_assign_get_submission_status"]) == 2
    # the grade list keeps only graded items that are not on an assignment row; the course total stands alone
    assert c["total"] == "2,5" and [(g["name"], g["grade"], g["range"]) for g in c["grades"]] == [("Test 1", "3", "1\u20135")]
    assert mods[0]["done"] and mods[0]["files"][0]["name"] == "s.pdf" and mods[0]["files"][0]["view"].startswith("/api/moodle/file?url=https%3A")
    assert mods[1]["restricted"] == "Not yet" and mods[2]["link"] == "https://x.test/"


def test_office_text():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Hello</w:t><w:tab/><w:t>you</w:t></w:r></w:p><w:p><w:r><w:t>Two</w:t></w:r></w:p></w:body></w:document>')
    assert api.extract_text("a.docx", "application/octet-stream", buf.getvalue()) == "Hello\tyou\nTwo\n"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("ppt/slides/slide10.xml", '<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Ten</a:t></a:r></a:p></p:sld>')
        z.writestr("ppt/slides/slide2.xml", '<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Two</a:t></a:r></a:p></p:sld>')
    assert api.extract_text("a.pptx", "", buf.getvalue()) == "--- slide 2 ---\nTwo\n--- slide 10 ---\nTen\n"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("content.xml", '<o:doc xmlns:o="o" xmlns:text="t"><text:h>Title</text:h><text:p>Hello <text:span>bold</text:span> end</text:p></o:doc>')
    assert api.extract_text("a.odt", "", buf.getvalue()) == "Title\nHello bold end\n"
    assert api.extract_text("a.py", "application/octet-stream", b"print(1)") == "print(1)"
    with pytest.raises(api.NoText):
        api.extract_text("a.zip", "application/zip", b"PK")


def test_uploads_and_signed_links(fake):
    uid = api.new_upload("../evil/na me.txt")
    assert (api._UPLOADS / f"{uid}.name").read_text() == ".._evil_na me.txt"
    with pytest.raises(ValueError):
        api._take([uid])  # no bytes yet
    (api._UPLOADS / f"{uid}.data").write_bytes(b"DATA")
    assert api._take([uid])[0][0] == ".._evil_na me.txt"
    with pytest.raises(ValueError):
        api._take(["../../etc/passwd"])
    api.ORIGIN.set("https://school.test")
    link = api._link(f"/api/mcp/moodle-upload/{uid}", f"upload|{uid}")
    exp, sig = int(link.split("exp=")[1].split("&")[0]), link.split("sig=")[1]
    api._check(f"upload|{uid}", exp, sig)
    from fastapi import HTTPException

    for what, e, s in ((f"upload|other", exp, sig), (f"upload|{uid}", exp + 1, sig), (f"upload|{uid}", 1, api._sign(f"upload|{uid}", 1))):
        with pytest.raises(HTTPException):
            api._check(what, e, s)

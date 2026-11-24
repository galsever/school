"""Books against a fake digi4school (httpx.MockTransport): login, blocked login, shelf, LTI hops, download, text, search, MCP."""

import asyncio
import json
import shutil

import httpx
import pytest

from school import books as bk
from school import books_api as api

INDEX = """<html><head><meta name="pageLabels" content="U1,1,2"/></head><body><script>IDRViewer.makeNavBar(3,'.svg')</script></body></html>"""


def svg(rows, image=False):
    """rows: (x, baseline, letters): one <use> per letter, 5 px apart."""
    uses = "".join(
        f'<use xlink:href="#f0_a" transform="matrix(9,0,0,9,{x + 5 * i},{y})"/>' for x, y, n in rows for i in range(n)
    )
    img = '<image x="0" y="0" width="10" height="10" xlink:href="img/a.png" />' if image else ""
    return f'<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><path id="f0_a" d="M0,0"/></defs>{uses}{img}</svg>'


# content.xml sits 5 px right and 7 px down of the SVG (media box vs crop box)
CONTENT = """<?xml version="1.0"?><pdf2xml>
<page number="1" position="absolute" top="0" left="0" height="150" width="110">
<text top="18" left="15" width="40" height="10" font="0">Titelseite</text>
<text top="38" left="15" width="40" height="10" font="0">Schulbuch</text>
</page>
<page number="2" position="absolute" top="0" left="0" height="150" width="110">
<text top="18" left="15" width="45" height="10" font="0"><b>Größenvergleich</b></text>
<text top="38" left="15" width="40" height="10" font="0">Bilanzsumme &amp; Co</text>
</page>
<page number="3" position="absolute" top="0" left="0" height="150" width="110">
<text top="18" left="15" width="40" height="10" font="0">Kostenrechnung</text>
<text top="38" left="15" width="40" height="10" font="0">Deckungsbeitrag</text>
</page>
</pdf2xml>"""
PAGES = {
    1: svg([(10, 21, 10), (10, 41, 9)]),
    2: svg([(10, 21, 15), (10, 41, 14)], image=True),
    3: svg([(10, 21, 14), (10, 41, 15)]),
}


class FakeD4S:
    def __init__(self):
        self.password = "right"
        self.logins = 0
        self.viewer_sessions = 0
        self.drop_viewer_once = False
        self.hits: list[str] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        url, path = request.url, request.url.path
        cookies = request.headers.get("cookie", "")
        self.hits.append(f"{url.host}{path}")
        if url.host == "digi4school.at":
            if path == "/br/xhr/login":
                self.logins += 1
                ok = f"password={self.password}" in request.content.decode()
                return httpx.Response(200, text="OK" if ok else "KO", headers={"set-cookie": "digi4s=s1; Path=/"} if ok else {})
            if "digi4s=s1" not in cookies:
                return httpx.Response(260, text="")
            if path == "/br/xhr/v2/synch":
                books = [
                    {"id": 14478, "code": "25abc", "title": "Unternehmensrechnung", "publisher": "Trauner"},
                    {"id": 14478, "code": "24old", "title": "Unternehmensrechnung", "publisher": "Trauner"},
                    {"id": 7585, "code": "24eng", "title": "English", "publisher": "Cambridge"},
                ]
                return httpx.Response(200, json={"user": {}, "books": books})
            if path == "/ebook/25abc":
                return httpx.Response(
                    200,
                    text='<form name="ltiLaunchForm" action="https://kat.digi4school.at/lti" method="post" enctype="application/x-www-form-urlencoded">'
                    '<input name="resource_link_id" value="500"/></form>',
                )
        if url.host == "kat.digi4school.at" and path == "/lti":
            return httpx.Response(200, text='<form action="https://a.digi4school.at/lti" method="post"><input name="x" value="1"/></form>')
        if url.host == "a.digi4school.at":
            if path == "/lti":
                self.viewer_sessions += 1
                return httpx.Response(302, headers={"location": "/ebook/500/", "set-cookie": f"digi4b=v{self.viewer_sessions}; Path=/"})
            if "digi4b=" not in cookies or (self.drop_viewer_once and path.endswith("3.svg")):
                self.drop_viewer_once = False
                return httpx.Response(302, headers={"location": "https://digi4school.at/br/find/500/"})
            files = {
                "/ebook/500/": INDEX,
                "/ebook/500/assets/content.xml": CONTENT,
                "/ebook/500/bookmarks/bookmarks.js": 'var bookmarks = [{"title":"1 Kosten","page":2},{"title":"1.1 Teil","page":2},{"title":"2 Ende","page":3}];',
            }
            if path in files:
                return httpx.Response(200, text=files[path])
            if path == "/ebook/500/thumbnails/1.jpg":
                return httpx.Response(200, content=b"\xff\xd8jpg", headers={"content-type": "image/jpeg"})
            if path == "/ebook/500/img/a.png":
                return httpx.Response(200, content=b"PNG", headers={"content-type": "image/png"})
            for n, body in PAGES.items():
                if path == f"/ebook/500/{n}.svg":
                    return httpx.Response(200, text=body)
        return httpx.Response(404, text="nope")


@pytest.fixture
def fake(monkeypatch):
    f = FakeD4S()
    monkeypatch.setattr(bk, "_TRANSPORT", httpx.MockTransport(f.handle))
    monkeypatch.setattr(bk, "_client", None)
    monkeypatch.setattr(bk, "_logged_in", False)
    bk._shelf_cache.clear()
    shutil.rmtree(bk.ROOT, ignore_errors=True)
    monkeypatch.setattr(bk, "_db", None)
    for p in (bk._LOGIN, bk._STATE):
        p.unlink(missing_ok=True)
    bk._LOGIN.write_text(json.dumps({"email": "me@x.at", "password": "right"}))
    return f


def run(coro):
    return asyncio.run(coro)


async def _download(book_id=14478):
    shelf = await bk.shelf()
    b = next(x for x in shelf if x["id"] == book_id)
    bk.ensure(b)
    await bk._jobs[book_id]


def test_shelf_dedupes_and_logs_in_once(fake):
    books = run(bk.shelf())
    assert [b["id"] for b in books] == [14478, 7585]
    assert books[0]["code"] == "25abc" and books[0]["state"] == "none"
    assert fake.logins == 1


def test_rejected_login_is_never_retried(fake):
    fake.password = "other"
    with pytest.raises(bk.BooksError) as e:
        run(bk.remote_shelf())
    assert e.value.not_connected
    assert bk.status()["blocked"]
    bk._shelf_cache.clear()
    with pytest.raises(bk.BooksError):
        run(bk.remote_shelf(refresh=True))
    assert fake.logins == 1


def test_set_login_checks_once(fake):
    with pytest.raises(ValueError):
        run(bk.set_login("me@x.at", "wrong"))
    assert fake.logins == 1
    run(bk.set_login("me@x.at", "right"))
    assert bk.status() == {"configured": True, "user": "me@x.at", "blocked": False}


def test_download_pages_text_toc(fake):
    run(_download())
    m = bk.meta(14478)
    assert m["state"] == "ready" and m["text"]
    assert [p["label"] for p in m["pages"]] == ["U1", "1", "2"]
    assert m["pages"][0]["w"] == 100 and m["pages"][0]["h"] == 140
    assert m["toc"][0] == {"title": "1 Kosten", "page": 2}
    page2 = bk.page_file(14478, 2).read_text()
    assert "data:image/png;base64,UE5H" in page2 and "img/a.png" not in page2
    assert bk.cover_file(14478).read_bytes().startswith(b"\xff\xd8")
    # text placed on the SVG (content.xml is 5 px right and 7 px down of it; too few votes here: centred, 2 px off)
    runs = bk.runs(14478, 2)
    assert runs[0][0] == 10.0 and abs(runs[0][1] - 11.0) <= 2 and runs[0][4] == "Größenvergleich"
    assert runs[1][4] == "Bilanzsumme & Co"


def test_search_prefix_and_umlauts(fake):
    run(_download())
    assert bk.search("grossen")[0]["page"] == 2  # ss finds ß
    hits = bk.search("Größen")
    assert hits and hits[0]["label"] == "1" and "\x02Größenvergleich\x03" in hits[0]["snippet"]
    assert bk.search("and") == []  # a word, not an operator
    assert bk.search("deckung", 14478)[0]["label"] == "2"
    assert bk.search("") == []


def test_viewer_session_lost_reopens_book(fake):
    fake.drop_viewer_once = True
    run(_download())
    assert bk.meta(14478)["state"] == "ready"
    assert fake.viewer_sessions == 2


def test_mcp_tools(fake):
    run(_download())
    listed = json.loads(run(api.list_tool()))
    assert listed[0]["downloaded"] and not listed[1]["downloaded"]
    toc = json.loads(run(api.list_tool(14478)))
    assert toc["toc"][0] == {"title": "1 Kosten", "page": "1"}
    out = json.loads(run(api.read_tool(14478, pages="1-2")))
    assert out["pages"] == "1-2" and "Größenvergleich" in out["text"] and "Deckungsbeitrag" in out["text"]
    out = json.loads(run(api.read_tool(14478, chapter="1")))
    assert out["pages"] == "1-1"
    hits = json.loads(run(api.search_tool("Kosten")))
    assert hits["hits"][0]["page"] == "2" and "English" in hits["not_searched"]
    with pytest.raises(bk.BooksError):
        run(api.read_tool(14478, pages="99"))
    assert "[Kosten" in hits["hits"][0]["text"] and "\x02" not in hits["hits"][0]["text"]
    one = json.loads(run(api.search_tool("Kosten", limit=1)))
    assert len(one["hits"]) == 1 and ("more" in one) == (len(hits["hits"]) > 1)
    for bad in (dict(pages="-2"), dict(chapter="  ")):
        with pytest.raises(bk.BooksError):
            run(api.read_tool(14478, **bad))
    out = json.loads(run(api.read_tool(14478, pages="1", offset=-5, max_chars=1)))
    assert out["text"].startswith("--- page 1") and "capped" not in out


def test_fit_offset_pools_pages():
    page = ([(10 + 5 * i, 21.0) for i in range(8)] + [(10 + 5 * i, 41.0) for i in range(9)], [[15, 18, 40, 10, "Achtzehn"], [15, 38, 40, 10, "Neunzehnt"]])
    assert bk.fit_offset([page] * 5) == (5.0, 7.0)
    assert bk.fit_offset([page]) is None  # two votes are not enough


def test_page_text_joins_words():
    runs = [[0, 10, 40, 10, "Die Halb-"], [0, 30, 40, 10, "wertszeit von CO"], [40.5, 33, 4, 7, "2"], [0, 50, 30, 10, "Arbeit\xadnehmer"]]
    assert bk.page_text(runs) == "Die Halbwertszeit von CO2\nArbeitnehmer"
    assert bk.page_text([[0, 10, 20, 10, "Nord-"], [0, 30, 20, 10, "Süd"]]) == "Nord-\nSüd"


def test_snap_runs_to_glyph_rows():
    points = [(10 + 5 * i, 50.0) for i in range(5)]
    snapped = bk.snap_runs(points, [[10.5, 39, 30, 10, "Hallo"], [300, 39, 30, 10, "fern"]])
    assert snapped[0][1] == 42.0  # baseline 50 = top + 0.8 * 10
    assert snapped[1][1] == 39  # no glyph where it starts: unchanged


def test_fts_query():
    assert bk.fts_query("Straße CO2") == '("Strasse"* OR "Straße"*) AND "CO2"*'
    assert bk.fts_query("***") == ""


def test_parsers():
    assert bk.labels({"firstPage": "3"}, 4) == ["U1", "U2", "1", "2"]
    assert bk.labels({}, 2) == ["1", "2"]
    assert bk.volumes('<html><a href="1/index.html">Band 1</a><a href="2/">Band 2</a></html>') == ["1/", "2/"]
    assert bk.volumes(INDEX) == []
    assert bk.page_text([[0, 10, 20, 10, "Erste"], [25, 10, 20, 10, "Zeile"], [0, 30, 20, 10, "Zweite"]]) == "Erste Zeile\nZweite"
    broken = '<page number="1" position="absolute" top="0" left="0" height="10" width="10"><text top="1" left="2" width="3" height="4" font="0"><b>a<i>b</b></i></text></page>'
    assert bk.parse_content(broken)[1]["runs"] == [[2.0, 1.0, 3.0, 4.0, "ab"]]

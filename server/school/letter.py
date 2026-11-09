"""The Entschuldigung PDF (German, A4). Signed afterwards with ID Austria, so the end of the page stays empty."""

import io
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from . import absences
from .absences import format_date, format_day, format_range, format_units
from .untis import today_iso

MARGIN = 56
BASE = ParagraphStyle("base", fontName="Helvetica", fontSize=10.5, leading=14.7)
BOLD = ParagraphStyle("bold", parent=BASE, fontName="Helvetica-Bold")
RIGHT = ParagraphStyle("right", parent=BASE, alignment=TA_RIGHT)
TITLE = ParagraphStyle("title", parent=BOLD, fontSize=16, leading=22.4, spaceBefore=36, spaceAfter=12)
TH = ParagraphStyle("th", parent=BOLD, fontSize=9.5, leading=13.3)
SMALL = ParagraphStyle("small", parent=BASE, fontSize=9, leading=12.6, textColor=colors.HexColor("#444444"))


def _p(text: str, style: ParagraphStyle = BASE) -> Paragraph:
    return Paragraph(escape(text).replace("\n", "<br/>"), style)


def _row(day: dict) -> list:
    times, units = [], []
    for a in day["absences"]:
        times.append(_p(format_range(a["start"], a["end"])))
        if a["late"]:
            times.append(_p(f"Verspätung, {a['lateMinutes']} Min.", SMALL))
        elif a["lateMinutes"] > 0:
            times.append(_p(f"davon {a['lateMinutes']} Min. Verspätung", SMALL))
        units.append(_p(format_units(a["units"]) or "-"))
    return [_p(format_day(day["date"])), times, units, _p(day["reason"].strip())]


def render(name: str, klasse: str, place: str, day: str, days: list[dict]) -> bytes:
    width = A4[0] - 2 * MARGIN
    head = Table(
        [[[_p(name, BOLD), _p(f"Klasse {klasse}")], _p(f"{place + ', am' if place else 'Am'} {format_date(day)}", RIGHT)]],
        colWidths=[width * 0.6, width * 0.4],
        style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]),
    )
    table = Table(
        [[_p("Datum", TH), _p("Uhrzeit", TH), _p("Stunden", TH), _p("Grund", TH)]] + [_row(d) for d in days],
        colWidths=[width * 0.22, width * 0.22, width * 0.20, width * 0.36],
        repeatRows=1,
        style=TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (-1, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LINEABOVE", (0, 0), (-1, 0), 1, colors.HexColor("#999999")),
                ("LINEBELOW", (0, 0), (-1, -1), 0.5, colors.HexColor("#bbbbbb")),
            ]
        ),
    )
    many = "an den folgenden Tagen" if len(days) > 1 else "am folgenden Tag"
    story = [
        head,
        _p("Entschuldigung", TITLE),
        _p(f"Hiermit entschuldige ich mein Fernbleiben vom Unterricht {many}:"),
        Spacer(1, 14),
        table,
        # Closing with room for the ID Austria signature block, never split from each other.
        KeepTogether([Spacer(1, 28), _p("Mit freundlichen Grüßen"), Spacer(1, 4), _p(name), Spacer(1, 140)]),
    ]
    out = io.BytesIO()
    SimpleDocTemplate(
        out,
        pagesize=A4,
        # The frame pads its content by 6 pt: text and tables then both start at MARGIN.
        leftMargin=MARGIN - 6,
        rightMargin=MARGIN - 6,
        topMargin=MARGIN - 6,
        bottomMargin=MARGIN - 6,
        title=f"Entschuldigung {name}",
        author=name,
        lang="de-AT",
    ).build(story)
    return out.getvalue()


def build(dates: list[str]) -> tuple[bytes, str]:
    """Renders the letter for these days and marks them as exported. Raises ValueError when a day has no reason."""
    c = absences.check_letter(dates)
    today = today_iso()
    pdf = render(c["name"], c["klasse"], (absences.load_login() or {}).get("place", ""), today, c["days"])
    absences.mark_exported([d["date"] for d in c["days"]])
    return pdf, f"Entschuldigung_{'_'.join(c['name'].split())}_{today}.pdf"

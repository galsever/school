"""Absence model, attendance stats and the letter, on a small made-up WebUntis pull."""

from teams import absences as ab
from teams import letter
from teams.untis import chunks

GRID = [
    {"name": "1", "startTime": 800, "endTime": 850},
    {"name": "2", "startTime": 850, "endTime": 940},
    {"name": "3", "startTime": 955, "endTime": 1045},
    {"name": "4", "startTime": 1045, "endTime": 1135},
]


def lesson(day, start, end, su, code=None):
    return {"id": 0, "date": day, "startTime": start, "endTime": end, "kl": [{"id": 7, "name": "5XHIF"}], "su": [{"id": 1, "name": su, "longname": su + " lang"}], "code": code}


def absence(aid, day, start, end, excused=False, reason=""):
    return {"id": aid, "startDate": day, "endDate": day, "startTime": start, "endTime": end, "isExcused": excused, "excuseStatus": "entschuldigt" if excused else None, "reason": reason}


def piece(aid, day, start, end, excused=False):
    return {"absenceId": aid, "date": day, "startTime": start, "endTime": end, "excused": excused, "missedMins": ab.to_minutes(end) - ab.to_minutes(start)}


def raw(**over):
    return {
        "fetchedAt": "2026-10-06T08:00:00Z",
        "personId": 1,
        "klasseId": 7,
        "displayName": "Test Person",
        "schoolyear": {"id": 1, "name": "2026/2027", "startDate": 20260907, "endDate": 20270704},
        "holidays": [{"id": 1, "name": "Ferien4", "longName": "Semesterferien", "startDate": 20270201, "endDate": 20270207}],
        "timegrid": [{"day": 2, "timeUnits": GRID}],
        "lessons": [
            lesson(20260928, 800, 850, "AM"),
            lesson(20260928, 850, 940, "AM"),
            lesson(20260928, 955, 1045, "D"),
            lesson(20260928, 1045, 1135, "D", "cancelled"),
            lesson(20260929, 800, 940, "POS"),  # double lesson
            lesson(20260929, 955, 1045, "D"),
        ],
        "absences": [absence(10, 20260928, 800, 940, True, "Krankheit"), absence(11, 20260929, 955, 1007, False, "Verspätung")],
        "absenceTimes": [piece(10, 20260928, 800, 850, True), piece(10, 20260928, 850, 940, True)],
        "latenessTimes": [piece(11, 20260929, 955, 1007)],
        **over,
    }


NOW = {"date": "2026-10-06", "minutes": 12 * 60}
YEAR = ("2026-09-07", "2027-07-04")


def stats(snap, start=YEAR[0], end=YEAR[1], now=NOW):
    return ab.subject_stats(snap["lessons"], snap["parts"], snap["units"], start, end, now)


def test_semesters_split_at_the_semesterferien():
    assert ab.semesters(raw()) == [
        {"name": "1. Semester", "start": "2026-09-07", "end": "2027-01-31"},
        {"name": "2. Semester", "start": "2027-02-08", "end": "2027-07-04"},
    ]


def test_semesters_fall_back_to_the_first_full_week_of_february():
    s1, s2 = ab.semesters(raw(holidays=[]))
    assert (s1["end"], s2["start"]) == ("2027-01-31", "2027-02-08")  # 1 Feb 2027 is a Monday


def test_snapshot_reads_name_class_lateness_and_lesson_numbers():
    snap = ab.build_snapshot(raw())
    assert (snap["name"], snap["klasse"]) == ("Test Person", "5XHIF")
    late, sick = snap["absences"]  # newest first
    assert (late["date"], late["late"], late["lateMinutes"], late["units"]) == ("2026-09-29", True, 12, ["3"])
    assert (sick["date"], sick["late"], sick["excused"], sick["units"], sick["untisReason"]) == ("2026-09-28", False, True, ["1", "2"], "Krankheit")
    assert [d["date"] for d in ab.group_days(snap["absences"])] == ["2026-09-29", "2026-09-28"]


def test_multi_day_absences_split_per_weekday():
    long = {**absence(20, 20261002, 955, 1135), "endDate": 20261005}
    snap = ab.build_snapshot(raw(absences=[long], absenceTimes=[], latenessTimes=[]))
    assert [(a["date"], a["start"], a["end"]) for a in snap["absences"]] == [("2026-10-05", 480, 695), ("2026-10-02", 595, 695)]


def test_lateness_is_guessed_without_the_per_lesson_endpoint():
    snap = ab.build_snapshot(raw(absenceTimes=None, latenessTimes=None, absences=[absence(30, 20260928, 800, 812)]))
    assert snap["absences"][0]["late"] and all(p["late"] for p in snap["parts"])


def test_subject_stats():
    snap = ab.build_snapshot(raw())
    rows = stats(snap)
    by = {s["subject"]: s for s in rows}
    # excused absences per subject, cancelled lessons skipped
    assert (by["AM"]["held"], by["AM"]["excused"], by["AM"]["unexcused"], by["AM"]["percent"]) == (2, 2, 0, 0)
    assert (by["D"]["held"], by["D"]["excused"], by["D"]["percent"]) == (2, 0, 100)
    # a double lesson is two units, lateness is not an absence
    assert (by["POS"]["held"], by["POS"]["present"]) == (2, 2)
    total = ab.total_stats(rows)
    assert (total["held"], total["excused"], total["unexcused"]) == (6, 2, 0)
    # lessons that have not happened yet do not count
    early = stats(snap, now={"date": "2026-09-28", "minutes": 9 * 60})
    assert next(s for s in early if s["subject"] == "AM")["held"] == 1
    assert sorted(s["subject"] for s in stats(snap, "2026-09-29", "2026-09-29")) == ["D", "POS"]


def test_grouped_subjects_merge_into_one_row():
    rows = stats(ab.build_snapshot(raw()))
    before = ab.total_stats(rows)
    grouped = ab.group_stats(rows, [{"name": "AMD", "subjects": ["AM", "D", "X"]}])
    amd = next(s for s in grouped if s["subject"] == "AMD")
    assert (amd["subjectLong"], amd["held"], amd["excused"], amd["present"], amd["percent"]) == ("AM + D", 4, 2, 2, 50)
    assert not any(s["subject"] in ("AM", "D") for s in grouped)
    assert ab.total_stats(grouped) == before


def test_helpers():
    assert ab.format_units(["2"]) == "2. Stunde"
    assert ab.format_units(["1", "2", "3", "5"]) == "1. bis 3., 5. Stunde"
    assert ab.format_units([]) == ""
    assert ab.format_day("2026-10-06") == "Di, 06.10.2026"
    assert chunks("2026-09-07", "2026-10-06", 28) == [("2026-09-07", "2026-10-04"), ("2026-10-05", "2026-10-06")]
    assert ab.parse_server("https://x.webuntis.com/WebUntis/?school=abc#/basic/login") == ("x.webuntis.com", "abc")
    assert ab.parse_server("Spengergasse.WebUntis.com") == ("spengergasse.webuntis.com", None)


def test_letter_needs_a_reason_and_marks_days_exported():
    ab.save_snapshot(raw())
    try:
        letter.build(["2026-09-28"])
        assert False, "a day without a reason must not make a letter"
    except ValueError as e:
        assert "2026-09-28" in str(e)
    ab.save_reason("2026-09-28", "Krank (Fieber)")
    pdf, name = letter.build(["2026-09-28", "2026-01-01"])
    assert pdf.startswith(b"%PDF") and name.startswith("Entschuldigung_Test_Person_")
    day = next(d for d in ab.day_views(ab.load_snapshot()) if d["date"] == "2026-09-28")
    assert day["exportedAt"] and day["reason"] == "Krank (Fieber)" and day["status"] == "excused"

import asyncio
from datetime import date

import pytest

from school import absences as ab
from school import mcp, timetable, untis


def test_lesson_status_and_original_teacher():
    p = {
        "date": 20261110, "startTime": 800, "endTime": 850, "code": "irregular", "lstext": "Kapitel 3",
        "su": [{"name": "AM", "longname": "Mathematik"}], "te": [{"name": "---", "orgname": "ABC"}], "ro": [{"name": "B4.12"}],
        "activityType": "Unterricht",
    }
    o = timetable.lesson_out(p)
    assert o == {
        "day": "2026-11-10 Tue", "time": "08:00-08:50", "subject": "AM", "subject_name": "Mathematik", "rooms": ["B4.12"],
        "status": "changed (no teacher)", "was_teachers": ["ABC"], "topic": "Kapitel 3",
    }
    assert timetable.lesson_out({**p, "code": "cancelled", "te": [{"name": "ABC"}]})["status"] == "cancelled"


def test_exam_in_days():
    e = {"examDate": 20261112, "startTime": 1000, "endTime": 1050, "examType": "SA", "subject": "D", "name": "D", "teachers": ["X"]}
    o = timetable.exam_out(e, date(2026, 11, 10))
    assert o["type"] == "Schularbeit" and o["in"] == "in 2 days" and "name" not in o
    assert timetable.exam_out(e, date(2026, 11, 11))["in"] == "tomorrow"
    assert timetable.exam_out(e, date(2026, 11, 14))["in"] == "2 days ago"


def test_homework_subject_teacher_and_completed():
    data = {
        "lessons": [{"id": 7, "subject": "E1"}],
        "teachers": [{"id": 3, "name": "XYZ"}],
        "records": [{"homeworkId": 1, "teacherId": 3}],
        "homeworks": [
            {"id": 1, "lessonId": 7, "date": 20261103, "dueDate": 20261117, "text": "Essay", "completed": False},
            {"id": 2, "lessonId": 7, "date": 20261103, "dueDate": 20261111, "text": "Read", "completed": True},
        ],
    }
    assert timetable.homework_out(data, False) == [
        {"due": "2026-11-17 Tue", "subject": "E1", "text": "Essay", "assigned": "2026-11-03 Tue", "teacher": "XYZ"}
    ]
    assert [h["text"] for h in timetable.homework_out(data, True)] == ["Read", "Essay"]


def test_rejected_login_blocks_and_is_never_retried(monkeypatch):
    login = {"server": "x.webuntis.com", "school": "s", "user": "u", "password": "p", "place": ""}
    monkeypatch.setattr(ab, "load_login", lambda: login)
    ab.set_meta("auth_blocked", None)
    calls = []

    async def reject(*a):
        calls.append(a)
        raise untis.UntisError("bad", -8504)

    monkeypatch.setattr(untis.UntisSession, "login", reject)
    timetable._cache.clear()
    for _ in range(2):
        with pytest.raises(timetable.Fail, match="login_blocked"):
            asyncio.run(timetable.timetable("2026-11-10", "2026-11-10"))
    assert len(calls) == 1
    assert ab.get_meta("auth_blocked") == ab.login_hash(login)
    ab.set_meta("auth_blocked", None)


def test_tools_registered_with_write_hints():
    names = {t["name"]: t for t in mcp._tool_list()}
    for n in ("timetable", "exams", "homework", "moodle_choice", "moodle_publication"):
        assert names[n]["annotations"]["readOnlyHint"] is True
    for n in ("turn_in", "undo_turn_in", "add_assignment_file", "remove_assignment_file", "moodle_choose", "moodle_publication_change", "upload_link"):
        assert names[n]["annotations"]["readOnlyHint"] is False

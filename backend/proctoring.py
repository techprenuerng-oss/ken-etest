"""Ken E-Test - backend/proctoring.py
Basic browser-based monitoring: stores the events sent by js/proctoring.js.
The severity of every event type is decided here, on the server."""
from .auth import require_admin, require_student
from .db import fetch_all, generate_id, run
from .exams import find_exam, get_active_attempt
from .helpers import (auth_required, clean_text, fail, is_scalar, now_utc, ok, req, to_iso,
                      utc_now_seconds, utc_timestamp)
from .results import find_result

EVENT_SEVERITIES = {
    "TAB_SWITCH": "high",
    "FULLSCREEN_EXIT": "high",
    "WINDOW_BLUR": "medium",
    "COPY_ATTEMPT": "medium",
    "CUT_ATTEMPT": "medium",
    "PASTE_ATTEMPT": "medium",
    "RIGHT_CLICK": "low",
    "KEYBOARD_RESTRICTION": "low",
    "MAX_WARNINGS_REACHED": "high",
}


def may_log_event(student_id, exam_id):
    """Events are accepted while the examination is in progress. The last event
    (MAX_WARNINGS_REACHED) is sent a moment before the automatic submission, so a short
    time after submitting is allowed too."""
    if get_active_attempt(student_id, exam_id):
        return True
    result = find_result(student_id, exam_id)
    return bool(result) and (utc_now_seconds() - utc_timestamp(result["submit_time"])) <= 120


def action_logProctoringEvent(data):
    student = require_student(data)
    if not student:
        return auth_required()

    exam = find_exam(req(data, "exam_id"))
    if not exam:
        return fail("Examination not found.", "NOT_FOUND")

    event_type = req(data, "event_type")
    event_type = event_type.upper() if isinstance(event_type, str) else ""
    if event_type not in EVENT_SEVERITIES:
        return fail("Unknown event type.", "VALIDATION")
    if not may_log_event(student["student_id"], exam["exam_id"]):
        return fail("No examination is in progress.", "NOT_STARTED")

    run("INSERT INTO proctoring_logs (log_id, student_id, exam_id, event_type, event_description, logged_at, severity) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (generate_id("log", "LOG", 4), student["student_id"], exam["exam_id"], event_type,
         clean_text(req(data, "event_description"), 200), now_utc(), EVENT_SEVERITIES[event_type]))
    return ok("Event recorded.")


def action_adminGetProctoringLogs(data):
    """Monitoring events for the admin panel. Optional filters: exam_id, event_type."""
    if not require_admin(data):
        return auth_required()

    sql = ("SELECT l.*, s.full_name AS student_name, e.title AS exam_title "
           "FROM proctoring_logs l "
           "LEFT JOIN students s ON s.student_id = l.student_id "
           "LEFT JOIN exams e ON e.exam_id = l.exam_id")
    conditions, params = [], []
    exam_id, event_type = req(data, "exam_id"), req(data, "event_type")
    if is_scalar(exam_id) and str(exam_id) != "":
        conditions.append("l.exam_id = %s")
        params.append(str(exam_id))
    if is_scalar(event_type) and str(event_type) != "":
        conditions.append("l.event_type = %s")
        params.append(str(event_type))
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY l.logged_at DESC, l.log_id DESC LIMIT 500"

    listing = []
    for row in fetch_all(sql, params):
        listing.append({
            "log_id": row["log_id"],
            "student_id": row["student_id"],
            "student_name": row["student_name"] if row["student_name"] is not None else "Unknown student",
            "exam_id": row["exam_id"],
            "exam_title": row["exam_title"] if row["exam_title"] is not None else "Unknown examination",
            "event_type": row["event_type"],
            "event_description": row["event_description"],
            "timestamp": to_iso(row["logged_at"]),
            "severity": row["severity"],
        })
    return ok("Monitoring events loaded.", listing)

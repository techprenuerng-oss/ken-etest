"""Ken E-Test - backend/results.py
Reading stored results (students see their own; admins see all in admin.py)."""
from .auth import require_student
from .db import fetch_all, fetch_one
from .helpers import auth_required, fail, is_scalar, ok, req, to_iso, utc_timestamp


def result_select_sql():
    """Results joined with the student and examination names."""
    return ("SELECT r.*, s.full_name AS student_name, e.title AS exam_title, "
            "e.subject AS exam_subject, e.pass_mark AS exam_pass_mark "
            "FROM results r "
            "LEFT JOIN students s ON s.student_id = r.student_id "
            "LEFT JOIN exams e ON e.exam_id = r.exam_id")


def find_result(student_id, exam_id):
    return fetch_one("SELECT * FROM results WHERE student_id = %s AND exam_id = %s", (student_id, exam_id))


def format_result(row):
    """Turns a joined result row into the structure the website expects."""
    spent = int(utc_timestamp(row["submit_time"]) - utc_timestamp(row["start_time"]))
    return {
        "result_id": row["result_id"],
        "student_id": row["student_id"],
        "student_name": row["student_name"] if row["student_name"] is not None else "Unknown student",
        "exam_id": row["exam_id"],
        "exam_title": row["exam_title"] if row["exam_title"] is not None else "Unknown examination",
        "subject": row["exam_subject"] if row["exam_subject"] is not None else "",
        "pass_mark": float(row["exam_pass_mark"]) if row["exam_pass_mark"] is not None else 0,
        "score": int(row["score"]),
        "total_marks": int(row["total_marks"]),
        "percentage": float(row["percentage"]),
        "status": row["status"],
        "start_time": to_iso(row["start_time"]),
        "submit_time": to_iso(row["submit_time"]),
        "time_spent_seconds": spent if spent >= 0 else None,
    }


def format_results(rows):
    return [format_result(row) for row in rows]


def action_getStudentResults(data):
    student = require_student(data)
    if not student:
        return auth_required()
    rows = fetch_all(result_select_sql() + " WHERE r.student_id = %s ORDER BY r.submit_time DESC, r.result_id DESC",
                     (student["student_id"],))
    return ok("Results loaded.", format_results(rows))


def action_getResult(data):
    student = require_student(data)
    if not student:
        return auth_required()
    result_id = req(data, "result_id")
    # A student can only open their own results.
    row = None
    if is_scalar(result_id):
        row = fetch_one(result_select_sql() + " WHERE r.result_id = %s AND r.student_id = %s",
                        (str(result_id), student["student_id"]))
    if not row:
        return fail("Result not found.", "NOT_FOUND")
    return ok("Result loaded.", format_result(row))

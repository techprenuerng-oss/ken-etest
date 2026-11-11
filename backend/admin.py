"""Ken E-Test - backend/admin.py
Everything the administrator can do. Every function first checks that the request
carries a valid ADMIN session token."""
import math

from .auth import public_student, require_admin
from .db import fetch_all, fetch_one, generate_id, run
from .exams import build_exam_info, exam_select_sql, find_exam, questions_for_exam
from .helpers import (auth_required, clean_text, fail, is_scalar, now_utc, ok, req, round_half_up,
                      text_length, to_iso, to_number, whole_number)
from .results import format_results, result_select_sql


def _percent(part, whole):
    """Whole-number percentage, .5 rounded up."""
    return int(math.floor(part / whole * 100 + 0.5))


# ---------- dashboard ----------

def action_adminGetStats(data):
    if not require_admin(data):
        return auth_required()

    totals = fetch_one(
        "SELECT COUNT(*) AS submissions, COALESCE(AVG(percentage), 0) AS average, "
        "COALESCE(SUM(CASE WHEN status = 'PASS' THEN 1 ELSE 0 END), 0) AS passed, "
        "(SELECT COUNT(*) FROM students) AS students, (SELECT COUNT(*) FROM exams) AS exams, "
        "(SELECT COUNT(*) FROM proctoring_logs) AS events FROM results")
    submissions = int(totals["submissions"])

    exam_stats = []
    rows = fetch_all(
        "SELECT e.exam_id, e.title, COUNT(r.result_id) AS submissions, COALESCE(AVG(r.percentage), 0) AS average, "
        "COALESCE(SUM(CASE WHEN r.status = 'PASS' THEN 1 ELSE 0 END), 0) AS passed "
        "FROM exams e LEFT JOIN results r ON r.exam_id = e.exam_id "
        "GROUP BY e.exam_id, e.title ORDER BY LENGTH(e.exam_id), e.exam_id")
    for row in rows:
        count = int(row["submissions"])
        exam_stats.append({
            "exam_id": row["exam_id"],
            "title": row["title"],
            "submissions": count,
            "average": round_half_up(float(row["average"]), 1) if count else 0,
            "pass_rate": _percent(int(row["passed"]), count) if count else 0,
        })

    recent = fetch_all(result_select_sql() + " ORDER BY r.submit_time DESC, r.result_id DESC LIMIT 5")
    return ok("Statistics loaded.", {
        "total_students": int(totals["students"]),
        "total_exams": int(totals["exams"]),
        "total_submissions": submissions,
        "average_score": round_half_up(float(totals["average"]), 1) if submissions else 0,
        "pass_rate": _percent(int(totals["passed"]), submissions) if submissions else 0,
        "total_events": int(totals["events"]),
        "exam_stats": exam_stats,
        "recent_results": format_results(recent),
    })


# ---------- examinations ----------

def action_adminGetExams(data):
    if not require_admin(data):
        return auth_required()
    rows = fetch_all(
        "SELECT x.*, (SELECT COUNT(*) FROM results r WHERE r.exam_id = x.exam_id) AS submissions "
        "FROM (" + exam_select_sql() + ") x ORDER BY LENGTH(x.exam_id), x.exam_id")
    listing = []
    for row in rows:
        info = build_exam_info(row)
        info["submissions"] = int(row["submissions"])
        info["date_created"] = to_iso(row["date_created"])
        listing.append(info)
    return ok("Examinations loaded.", listing)


def validate_exam_input(data):
    """Checks the examination form. Returns (error_reply, None) or (None, fields)."""
    title = clean_text(req(data, "title"), 120)
    if text_length(title) < 3:
        return fail("Enter an examination title (at least 3 characters).", "VALIDATION"), None
    subject = clean_text(req(data, "subject"), 80)
    if subject == "":
        return fail("Enter the subject.", "VALIDATION"), None
    duration = whole_number(req(data, "duration_minutes"), 1, 300)
    if duration is None:
        return fail("Duration must be a whole number of minutes from 1 to 300.", "VALIDATION"), None
    pass_mark = to_number(req(data, "pass_mark"))
    if pass_mark is None or pass_mark < 0 or pass_mark > 100:
        return fail("Pass mark must be a percentage from 0 to 100.", "VALIDATION"), None
    status = "Active" if req(data, "status") == "Active" else "Inactive"
    return None, {
        "title": title,
        "subject": subject,
        "description": clean_text(req(data, "description"), 300),
        "duration_minutes": duration,
        "pass_mark": round_half_up(pass_mark, 2),
        "status": status,
    }


def action_adminCreateExam(data):
    if not require_admin(data):
        return auth_required()
    error, exam = validate_exam_input(data)
    if error:
        return error
    exam_id = generate_id("exam", "EX", 3)
    run("INSERT INTO exams (exam_id, title, subject, description, duration_minutes, pass_mark, status, date_created) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (exam_id, exam["title"], exam["subject"], exam["description"], exam["duration_minutes"],
         exam["pass_mark"], exam["status"], now_utc()))
    return ok("Examination created.", {"exam_id": exam_id})


def action_adminUpdateExam(data):
    if not require_admin(data):
        return auth_required()
    existing = find_exam(req(data, "exam_id"))
    if not existing:
        return fail("Examination not found.", "NOT_FOUND")
    error, exam = validate_exam_input(data)
    if error:
        return error
    run("UPDATE exams SET title = %s, subject = %s, description = %s, duration_minutes = %s, pass_mark = %s, "
        "status = %s WHERE exam_id = %s",
        (exam["title"], exam["subject"], exam["description"], exam["duration_minutes"], exam["pass_mark"],
         exam["status"], existing["exam_id"]))
    return ok("Examination updated.")


def action_adminSetExamStatus(data):
    if not require_admin(data):
        return auth_required()
    existing = find_exam(req(data, "exam_id"))
    if not existing:
        return fail("Examination not found.", "NOT_FOUND")
    status = req(data, "status")
    if status not in ("Active", "Inactive"):
        return fail("Status must be Active or Inactive.", "VALIDATION")
    if status == "Active" and int(existing["question_count"]) == 0:
        return fail("Add at least one question before activating this examination.", "NO_QUESTIONS")
    run("UPDATE exams SET status = %s WHERE exam_id = %s", (status, existing["exam_id"]))
    return ok("Examination is now " + status.lower() + ".")


# ---------- questions ----------

def format_admin_question(row):
    return {
        "question_id": row["question_id"],
        "exam_id": row["exam_id"],
        "question": row["question"],
        "option_a": row["option_a"],
        "option_b": row["option_b"],
        "option_c": row["option_c"],
        "option_d": row["option_d"],
        "correct_answer": row["correct_answer"],
        "marks": int(row["marks"]),
    }


def action_adminGetQuestions(data):
    if not require_admin(data):
        return auth_required()
    exam_id = req(data, "exam_id")
    if is_scalar(exam_id) and str(exam_id) != "":
        rows = questions_for_exam(str(exam_id))
    else:
        rows = fetch_all("SELECT * FROM questions ORDER BY LENGTH(question_id), question_id")
    return ok("Questions loaded.", [format_admin_question(row) for row in rows])


def validate_question_input(data):
    """Checks the question form. Returns (error_reply, None) or (None, fields)."""
    exam_id = clean_text(req(data, "exam_id"), 10)
    if not find_exam(exam_id):
        return fail("Choose a valid examination.", "VALIDATION"), None
    text = clean_text(req(data, "question"), 500)
    if text_length(text) < 5:
        return fail("Enter the question text (at least 5 characters).", "VALIDATION"), None
    options = [clean_text(req(data, key), 200) for key in ("option_a", "option_b", "option_c", "option_d")]
    if any(option == "" for option in options):
        return fail("All four options are required.", "VALIDATION"), None
    correct = req(data, "correct_answer")
    correct = correct.upper() if isinstance(correct, str) else ""
    if correct not in ("A", "B", "C", "D"):
        return fail("Choose the correct answer (A, B, C or D).", "VALIDATION"), None
    marks = whole_number(req(data, "marks"), 1, 100)
    if marks is None:
        return fail("Marks must be a whole number from 1 to 100.", "VALIDATION"), None
    return None, {
        "exam_id": exam_id, "question": text,
        "option_a": options[0], "option_b": options[1], "option_c": options[2], "option_d": options[3],
        "correct_answer": correct, "marks": marks,
    }


def action_adminAddQuestion(data):
    if not require_admin(data):
        return auth_required()
    error, q = validate_question_input(data)
    if error:
        return error
    question_id = generate_id("question", "Q", 3)
    run("INSERT INTO questions (question_id, exam_id, question, option_a, option_b, option_c, option_d, correct_answer, marks) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (question_id, q["exam_id"], q["question"], q["option_a"], q["option_b"], q["option_c"], q["option_d"],
         q["correct_answer"], q["marks"]))
    return ok("Question added.", {"question_id": question_id})


def _find_question(question_id):
    if not is_scalar(question_id):
        return None
    return fetch_one("SELECT * FROM questions WHERE question_id = %s", (str(question_id),))


def action_adminUpdateQuestion(data):
    if not require_admin(data):
        return auth_required()
    existing = _find_question(req(data, "question_id"))
    if not existing:
        return fail("Question not found.", "NOT_FOUND")
    error, q = validate_question_input(data)
    if error:
        return error
    run("UPDATE questions SET exam_id = %s, question = %s, option_a = %s, option_b = %s, option_c = %s, option_d = %s, "
        "correct_answer = %s, marks = %s WHERE question_id = %s",
        (q["exam_id"], q["question"], q["option_a"], q["option_b"], q["option_c"], q["option_d"],
         q["correct_answer"], q["marks"], existing["question_id"]))
    return ok("Question updated.")


def action_adminDeleteQuestion(data):
    if not require_admin(data):
        return auth_required()
    existing = _find_question(req(data, "question_id"))
    if not existing:
        return fail("Question not found.", "NOT_FOUND")
    run("DELETE FROM questions WHERE question_id = %s", (existing["question_id"],))
    return ok("Question deleted.")


# ---------- students ----------

def action_adminGetStudents(data):
    if not require_admin(data):
        return auth_required()
    rows = fetch_all(
        "SELECT s.*, (SELECT COUNT(*) FROM results r WHERE r.student_id = s.student_id) AS exams_taken "
        "FROM students s ORDER BY LENGTH(s.student_id), s.student_id")
    listing = []
    for row in rows:
        student = public_student(row)
        student["exams_taken"] = int(row["exams_taken"])
        listing.append(student)
    return ok("Students loaded.", listing)


def action_adminSetStudentStatus(data):
    if not require_admin(data):
        return auth_required()
    student_id = req(data, "student_id")
    student = fetch_one("SELECT student_id FROM students WHERE student_id = %s", (str(student_id),)) \
        if is_scalar(student_id) else None
    if not student:
        return fail("Student not found.", "NOT_FOUND")
    status = req(data, "status")
    if status not in ("Active", "Inactive"):
        return fail("Status must be Active or Inactive.", "VALIDATION")
    run("UPDATE students SET status = %s WHERE student_id = %s", (status, student["student_id"]))
    return ok("Student account is now " + status.lower() + ".")


# ---------- results ----------

def action_adminGetResults(data):
    """Results for the admin panel. Optional filter: exam_id."""
    if not require_admin(data):
        return auth_required()
    exam_id = req(data, "exam_id")
    if is_scalar(exam_id) and str(exam_id) != "":
        rows = fetch_all(result_select_sql() + " WHERE r.exam_id = %s ORDER BY r.submit_time DESC, r.result_id DESC",
                         (str(exam_id),))
    else:
        rows = fetch_all(result_select_sql() + " ORDER BY r.submit_time DESC, r.result_id DESC")
    return ok("Results loaded.", format_results(rows))

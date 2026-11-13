"""Ken E-Test - backend/exams.py
The student side of an examination: list, instructions, start, submit and marking.

Randomisation (how it works)
- When a student STARTS an examination the server shuffles the order of the questions
  and (optionally) the order of the four options of each question.
- The shuffle is saved in `exam_attempts`. If the student refreshes the page or comes
  back later they receive exactly the same order, and the server knows how to mark
  the letters they chose.
- Example: option order "CADB" means the option shown as A is really option C,
  B is really A, C is really D and D is really B.
- Correct answers are never sent to the browser."""
import json
from datetime import datetime, timezone

from . import config
from .auth import require_student
from .db import fetch_all, fetch_one, generate_id, get_conn, is_duplicate_key, run
from .helpers import (auth_required, fail, is_active_status, is_scalar, now_utc, ok, req,
                      round_half_up, secure_shuffle, utc_now_seconds, utc_timestamp)
from .results import find_result, format_result, result_select_sql

LETTERS = ["A", "B", "C", "D"]


# ---------- shared builders ----------

def exam_select_sql():
    """Exams together with their question count and total marks (counted from `questions`)."""
    return ("SELECT e.*, "
            "(SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.exam_id) AS question_count, "
            "(SELECT COALESCE(SUM(q.marks), 0) FROM questions q WHERE q.exam_id = e.exam_id) AS marks_sum "
            "FROM exams e")


def find_exam(exam_id):
    if not is_scalar(exam_id):
        return None
    return fetch_one(exam_select_sql() + " WHERE e.exam_id = %s", (str(exam_id),))


def build_exam_info(exam):
    return {
        "exam_id": exam["exam_id"],
        "title": exam["title"],
        "subject": exam["subject"],
        "description": exam["description"],
        "duration_minutes": int(exam["duration_minutes"]),
        "total_questions": int(exam["question_count"]),
        "total_marks": int(exam["marks_sum"]),
        "pass_mark": float(exam["pass_mark"]),
        "status": exam["status"],
        "scheduled_start": exam.get("scheduled_start").replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z") if exam.get("scheduled_start") else None,
        "scheduled_end": exam.get("scheduled_end").replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z") if exam.get("scheduled_end") else None,
    }


def exam_window(exam):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    start, end = exam.get("scheduled_start"), exam.get("scheduled_end")
    if start and now < start:
        return "upcoming"
    if end and now >= end:
        return "expired"
    return "open"


def build_attempt(result):
    if not result:
        return None
    return {
        "result_id": result["result_id"],
        "score": int(result["score"]),
        "total_marks": int(result["total_marks"]),
        "percentage": float(result["percentage"]),
        "status": result["status"],
    }


def get_active_attempt(student_id, exam_id):
    return fetch_one("SELECT * FROM exam_attempts WHERE student_id = %s AND exam_id = %s", (student_id, exam_id))


# ---------- questions ----------

def questions_for_exam(exam_id):
    """Questions of one examination INCLUDING the correct answer (server side only)."""
    return fetch_all("SELECT * FROM questions WHERE exam_id = %s ORDER BY LENGTH(question_id), question_id", (exam_id,))


def is_valid_option_order(order):
    return isinstance(order, str) and len(order) == 4 and sorted(order) == LETTERS


def create_layout(questions):
    """Creates a new random layout for a student: the order of the questions and,
    for every question, the order of its options."""
    ids = [q["question_id"] for q in questions]
    if config.SHUFFLE_QUESTIONS:
        ids = secure_shuffle(ids)
    option_order = {}
    for question in questions:
        letters = list(LETTERS)
        if config.SHUFFLE_OPTIONS:
            letters = secure_shuffle(letters)
        option_order[question["question_id"]] = "".join(letters)
    return ids, option_order


def resolve_layout(attempt, questions):
    """Applies the saved layout to the examination's CURRENT questions.
    Returns a list of {question, order}. Questions deleted since the student started are
    skipped; questions added since then are appended at the end."""
    by_id = {q["question_id"]: q for q in questions}
    try:
        saved_questions = json.loads(attempt["question_order"])
        saved_options = json.loads(attempt["option_order"])
    except (TypeError, ValueError):
        saved_questions, saved_options = [], {}
    if not isinstance(saved_questions, list):
        saved_questions = []
    if not isinstance(saved_options, dict):
        saved_options = {}

    ordered = []
    for question_id in saved_questions:
        if isinstance(question_id, str) and question_id in by_id:
            ordered.append(by_id.pop(question_id))
    ordered.extend(by_id.values())

    layout = []
    for question in ordered:
        order = saved_options.get(question["question_id"], "ABCD")
        if not is_valid_option_order(order):
            order = "ABCD"
        layout.append({"question": question, "order": order})
    return layout


def public_question(question, order):
    """The version of a question that the student receives: no correct answer, and the
    options are in the student's own order (displayed A..D)."""
    options = {}
    for i in range(4):
        options[LETTERS[i]] = question["option_" + order[i].lower()]
    return {
        "question_id": question["question_id"],
        "question": question["question"],
        "options": options,
        "marks": int(question["marks"]),
    }


# ---------- actions: student ----------

def action_getAvailableExams(data):
    """Active examinations that have questions, plus this student's result (if any)."""
    student = require_student(data)
    if not student:
        return auth_required()

    exams = fetch_all(exam_select_sql() + " WHERE e.status = 'Active' ORDER BY LENGTH(e.exam_id), e.exam_id")
    results = {row["exam_id"]: row for row in
               fetch_all("SELECT * FROM results WHERE student_id = %s", (student["student_id"],))}

    listing = []
    for exam in exams:
        if int(exam["question_count"]) == 0:
            continue
        info = build_exam_info(exam)
        info["attempt"] = build_attempt(results.get(exam["exam_id"]))
        info["window_status"] = exam_window(exam)
        listing.append(info)
    return ok("Examinations loaded.", listing)


def action_getExam(data):
    """Details for the instructions page."""
    student = require_student(data)
    if not student:
        return auth_required()

    exam = find_exam(req(data, "exam_id"))
    if not exam:
        return fail("Examination not found.", "NOT_FOUND")
    if not is_active_status(exam["status"]):
        return fail("This examination is not active.", "EXAM_INACTIVE")

    info = build_exam_info(exam)
    info["window_status"] = exam_window(exam)
    result = find_result(student["student_id"], exam["exam_id"])
    info["attempt"] = build_attempt(result)
    info["in_progress"] = result is None and get_active_attempt(student["student_id"], exam["exam_id"]) is not None
    return ok("Examination loaded.", info)


def action_startExam(data):
    """Starts (or resumes) an examination. The server stores the start time, so refreshing
    the page cannot reset the timer."""
    student = require_student(data)
    if not student:
        return auth_required()

    exam = find_exam(req(data, "exam_id"))
    if not exam:
        return fail("Examination not found.", "NOT_FOUND")
    if not is_active_status(exam["status"]):
        return fail("This examination is not active.", "EXAM_INACTIVE")
    window = exam_window(exam)
    if window == "upcoming":
        return fail("This examination has not started yet. Check the scheduled start time.", "EXAM_NOT_STARTED")

    existing = find_result(student["student_id"], exam["exam_id"])
    if existing:
        return fail("You have already taken this examination.", "ALREADY_SUBMITTED",
                    {"result_id": existing["result_id"]})

    questions = questions_for_exam(exam["exam_id"])
    if len(questions) == 0:
        return fail("This examination has no questions yet.", "NO_QUESTIONS")

    attempt = get_active_attempt(student["student_id"], exam["exam_id"])
    resumed = attempt is not None
    if window == "expired" and not attempt:
        return fail("The scheduled examination period has ended.", "EXAM_EXPIRED")
    if not attempt:
        question_order, option_order = create_layout(questions)
        # INSERT IGNORE: if two start requests arrive together, only the first one is stored.
        run("INSERT IGNORE INTO exam_attempts (student_id, exam_id, started_at, question_order, option_order) "
            "VALUES (%s, %s, %s, %s, %s)",
            (student["student_id"], exam["exam_id"], now_utc(), json.dumps(question_order), json.dumps(option_order)))
        attempt = get_active_attempt(student["student_id"], exam["exam_id"])

    total_seconds = int(exam["duration_minutes"]) * 60
    elapsed = int(utc_now_seconds() - utc_timestamp(attempt["started_at"]))
    remaining = max(0, total_seconds - elapsed)
    if exam.get("scheduled_end"):
        seconds_until_close = int((exam["scheduled_end"] - datetime.now(timezone.utc).replace(tzinfo=None)).total_seconds())
        remaining = min(remaining, max(0, seconds_until_close))

    public_questions = [public_question(item["question"], item["order"])
                        for item in resolve_layout(attempt, questions)]
    return ok("Examination started.", {
        "exam": build_exam_info(exam),
        "questions": public_questions,
        "remaining_seconds": remaining,
        "resumed": resumed,
    })


# ---------- marking and submission ----------

def mark_answers(layout, answers):
    """Marks the answers. `answers` looks like {"Q001": "A", "Q002": "C"} where the letters
    are the ones the STUDENT SAW. Each letter is translated back to the real option first."""
    score = 0
    total_marks = 0
    for item in layout:
        question = item["question"]
        marks = int(question["marks"])
        total_marks += marks

        given = answers.get(question["question_id"], "")
        given = given.strip().upper() if isinstance(given, str) else ""
        if len(given) != 1 or given not in "ABCD":
            continue                       # unanswered or invalid: zero marks
        original = item["order"]["ABCD".index(given)]
        if original == question["correct_answer"]:
            score += marks
    return score, total_marks


def action_submitExam(data):
    """Marks the examination on the server and stores the result.
    Everything happens in one database transaction."""
    student = require_student(data)
    if not student:
        return auth_required()

    exam = find_exam(req(data, "exam_id"))
    if not exam:
        return fail("Examination not found.", "NOT_FOUND")
    answers = req(data, "answers")
    if not isinstance(answers, dict):
        answers = {}

    conn = get_conn()
    conn.begin()
    try:
        # FOR UPDATE locks this student's attempt, so a double click is handled one at a time.
        attempt = fetch_one("SELECT * FROM exam_attempts WHERE student_id = %s AND exam_id = %s FOR UPDATE",
                            (student["student_id"], exam["exam_id"]))

        previous = find_result(student["student_id"], exam["exam_id"])
        if previous:
            conn.rollback()
            return fail("This examination has already been submitted.", "ALREADY_SUBMITTED",
                        {"result_id": previous["result_id"]})
        if not attempt:
            conn.rollback()
            return fail("This examination was not started.", "NOT_STARTED")

        questions = questions_for_exam(exam["exam_id"])
        if len(questions) == 0:
            conn.rollback()
            return fail("This examination has no questions.", "NO_QUESTIONS")

        score, total_marks = mark_answers(resolve_layout(attempt, questions), answers)
        percentage = round_half_up(score / total_marks * 100, 2) if total_marks > 0 else 0
        status = "PASS" if percentage >= float(exam["pass_mark"]) else "FAIL"

        result_id = generate_id("result", "RES", 3)
        run("INSERT INTO results (result_id, student_id, exam_id, score, total_marks, percentage, status, start_time, submit_time) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (result_id, student["student_id"], exam["exam_id"], score, total_marks, percentage, status,
             attempt["started_at"], now_utc()))
        # The attempt is finished, so remove the "in progress" record.
        run("DELETE FROM exam_attempts WHERE attempt_id = %s", (attempt["attempt_id"],))
        conn.commit()
    except Exception as error:
        try:
            conn.rollback()
        except Exception:
            pass
        if is_duplicate_key(error):
            previous = find_result(student["student_id"], exam["exam_id"])
            return fail("This examination has already been submitted.", "ALREADY_SUBMITTED",
                        {"result_id": previous["result_id"] if previous else None})
        raise

    return ok("Examination submitted.",
              format_result(fetch_one(result_select_sql() + " WHERE r.result_id = %s", (result_id,))))

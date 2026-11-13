"""Student examination support requests and admin responses."""
from .auth import require_admin, require_student
from .db import fetch_all, fetch_one, generate_id, run
from .helpers import auth_required, clean_text, fail, now_utc, ok, req, to_iso, text_length


def _format(row):
    return {"ticket_id": row["ticket_id"], "student_id": row["student_id"],
            "student_name": row["student_name"], "matric_number": row["matric_number"],
            "exam_id": row["exam_id"], "exam_title": row["exam_title"],
            "category": row["category"], "subject": row["subject"],
            "message": row["message"], "status": row["status"],
            "admin_reply": row["admin_reply"], "created_at": to_iso(row["created_at"]),
            "updated_at": to_iso(row["updated_at"])}

_QUERY = ("SELECT t.*, s.full_name AS student_name, s.matric_number, "
          "COALESCE(e.title, 'General support') AS exam_title "
          "FROM support_tickets t JOIN students s ON s.student_id=t.student_id "
          "LEFT JOIN exams e ON e.exam_id=t.exam_id ")


def action_createSupportTicket(data):
    student = require_student(data)
    if not student:
        return auth_required()
    category = clean_text(req(data, "category"), 60)
    subject = clean_text(req(data, "subject"), 120)
    message = clean_text(req(data, "message"), 3000)
    exam_id = clean_text(req(data, "exam_id"), 10) or None
    if category not in ("Login problem", "Exam not loading", "Submission problem", "Timer issue", "Other"):
        return fail("Choose a valid support category.", "VALIDATION")
    if text_length(subject) < 4 or text_length(message) < 10:
        return fail("Enter a subject and describe the problem in at least 10 characters.", "VALIDATION")
    if exam_id and not fetch_one("SELECT exam_id FROM exams WHERE exam_id=%s", (exam_id,)):
        return fail("The selected examination was not found.", "VALIDATION")
    ticket_id = generate_id("support", "SUP", 4)
    now = now_utc()
    run("INSERT INTO support_tickets (ticket_id, student_id, exam_id, category, subject, message, status, admin_reply, created_at, updated_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,'Open','',%s,%s)",
        (ticket_id, student["student_id"], exam_id, category, subject, message, now, now))
    return ok("Your support request has been sent.", {"ticket_id": ticket_id})


def action_getMySupportTickets(data):
    student = require_student(data)
    if not student:
        return auth_required()
    rows = fetch_all(_QUERY + "WHERE t.student_id=%s ORDER BY t.created_at DESC", (student["student_id"],))
    return ok("Support requests loaded.", [_format(row) for row in rows])


def action_adminGetSupportTickets(data):
    if not require_admin(data):
        return auth_required()
    status = clean_text(req(data, "status"), 20)
    sql = _QUERY
    params = ()
    if status in ("Open", "In Progress", "Resolved"):
        sql += "WHERE t.status=%s "
        params = (status,)
    rows = fetch_all(sql + "ORDER BY FIELD(t.status,'Open','In Progress','Resolved'), t.created_at DESC", params)
    return ok("Support requests loaded.", [_format(row) for row in rows])


def action_adminUpdateSupportTicket(data):
    if not require_admin(data):
        return auth_required()
    ticket_id = clean_text(req(data, "ticket_id"), 12)
    status = req(data, "status")
    reply = clean_text(req(data, "admin_reply"), 3000)
    if status not in ("Open", "In Progress", "Resolved"):
        return fail("Choose a valid ticket status.", "VALIDATION")
    if not fetch_one("SELECT ticket_id FROM support_tickets WHERE ticket_id=%s", (ticket_id,)):
        return fail("Support request not found.", "NOT_FOUND")
    run("UPDATE support_tickets SET status=%s, admin_reply=%s, updated_at=%s WHERE ticket_id=%s",
        (status, reply, now_utc(), ticket_id))
    return ok("Support request updated.")

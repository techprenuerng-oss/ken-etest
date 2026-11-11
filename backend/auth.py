"""Ken E-Test - backend/auth.py
Registration, login, logout and login sessions.

How sessions work: after a correct login the server creates a random token and keeps
only its SHA-256 hash in the `sessions` table. The browser keeps the token in
sessionStorage and sends it with every request (see js/api.js). The server finds the
student or admin from the token, so the browser can never claim to be someone else."""
import hashlib
import secrets
from datetime import timedelta

import bcrypt

from . import config
from .db import fetch_one, generate_id, is_duplicate_key, run
from .helpers import (auth_required, clean_text, fail, is_active_status, is_valid_email,
                      now_utc, ok, req, text_length, to_iso)


# ---------- passwords (bcrypt) ----------

def _password_bytes(password):
    return password.encode("utf-8")[:72]        # bcrypt only uses the first 72 bytes


def hash_password(password):
    return bcrypt.hashpw(_password_bytes(password), bcrypt.gensalt()).decode("ascii")


def password_ok(password, stored_hash):
    try:
        return bcrypt.checkpw(_password_bytes(password), stored_hash.encode("ascii"))
    except ValueError:
        return False


# ---------- sessions ----------

def _hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(role, user_id):
    token = secrets.token_hex(32)
    now = now_utc()
    run("DELETE FROM sessions WHERE expires_at < %s", (now,))            # tidy old sessions
    run("INSERT INTO sessions (token_hash, role, user_id, expires_at) VALUES (%s, %s, %s, %s)",
        (_hash_token(token), role, user_id, now + timedelta(seconds=config.SESSION_SECONDS)))
    return token


def get_session(token):
    """Returns {role, user_id} for a valid token, or None."""
    if not isinstance(token, str) or token == "":
        return None
    return fetch_one("SELECT role, user_id FROM sessions WHERE token_hash = %s AND expires_at > %s",
                     (_hash_token(token), now_utc()))


def require_student(data):
    """Returns the logged-in (active) student row, or None."""
    session = get_session(req(data, "token"))
    if not session or session["role"] != "student":
        return None
    student = fetch_one("SELECT * FROM students WHERE student_id = %s", (session["user_id"],))
    if not student or not is_active_status(student["status"]):
        return None
    return student


def require_admin(data):
    """Returns the logged-in admin row, or None."""
    session = get_session(req(data, "token"))
    if not session or session["role"] != "admin":
        return None
    return fetch_one("SELECT * FROM admins WHERE admin_id = %s", (session["user_id"],))


def public_student(student):
    """Student data that is safe to send to the browser (never the password hash)."""
    return {
        "student_id": student["student_id"],
        "full_name": student["full_name"],
        "email": student["email"],
        "class": student["class"],
        "status": student["status"],
        "date_registered": to_iso(student["date_registered"]),
    }


# ---------- actions ----------

def action_loginStudent(data):
    email = clean_text(req(data, "email"), 120).lower()
    password = req(data, "password")
    password = password if isinstance(password, str) else ""
    if email == "" or password == "":
        return fail("Enter your email and password.", "VALIDATION")

    student = fetch_one("SELECT * FROM students WHERE email = %s", (email,))
    if not student or not password_ok(password, student["password_hash"]):
        return fail("Incorrect email or password.", "INVALID_LOGIN")
    if not is_active_status(student["status"]):
        return fail("Your account is inactive. Contact the administrator.", "ACCOUNT_INACTIVE")

    token = create_session("student", student["student_id"])
    return ok("Login successful.", {"token": token, "student": public_student(student)})


def action_loginAdmin(data):
    username = clean_text(req(data, "username"), 60).lower()
    password = req(data, "password")
    password = password if isinstance(password, str) else ""
    if username == "" or password == "":
        return fail("Enter your username and password.", "VALIDATION")

    admin = fetch_one("SELECT * FROM admins WHERE username = %s", (username,))
    if not admin or not password_ok(password, admin["password_hash"]):
        return fail("Incorrect username or password.", "INVALID_LOGIN")

    token = create_session("admin", admin["admin_id"])
    return ok("Login successful.", {
        "token": token,
        "admin": {"admin_id": admin["admin_id"], "username": admin["username"], "name": admin["name"]},
    })


def action_logout(data):
    token = req(data, "token")
    if isinstance(token, str) and token != "":
        run("DELETE FROM sessions WHERE token_hash = %s", (_hash_token(token),))
    return ok("Logged out.")


def action_registerStudent(data):
    full_name = clean_text(req(data, "full_name"), 80)
    email = clean_text(req(data, "email"), 120).lower()
    password = req(data, "password")
    password = password if isinstance(password, str) else ""
    class_name = clean_text(req(data, "class"), 60)

    if text_length(full_name) < 3:
        return fail("Enter your full name (at least 3 characters).", "VALIDATION")
    if not is_valid_email(email):
        return fail("Enter a valid email address.", "VALIDATION")
    if text_length(password) < 6 or text_length(password) > 64:
        return fail("Password must be between 6 and 64 characters.", "VALIDATION")
    if class_name == "":
        return fail("Enter your class.", "VALIDATION")
    if fetch_one("SELECT student_id FROM students WHERE email = %s", (email,)):
        return fail("An account with this email already exists.", "DUPLICATE_EMAIL")

    student_id = generate_id("student", "STU", 3)
    try:
        run("INSERT INTO students (student_id, full_name, email, password_hash, `class`, status, date_registered) "
            "VALUES (%s, %s, %s, %s, %s, 'Active', %s)",
            (student_id, full_name, email, hash_password(password), class_name, now_utc()))
    except Exception as error:
        if is_duplicate_key(error):     # two registrations with the same email at the same moment
            return fail("An account with this email already exists.", "DUPLICATE_EMAIL")
        raise
    return ok("Registration successful. You can now log in.", {"student_id": student_id})

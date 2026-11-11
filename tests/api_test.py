"""Ken E-Test - tests/api_test.py
Automated test of the Python + MySQL backend. It talks to the API over HTTP exactly like
the website does, so it tests the real system (not a copy).

Run from the project folder (with the app running):
    python tests/api_test.py http://127.0.0.1:5000/api

What it does: registers its own temporary students, creates its own temporary
examination with 10 questions whose correct answers it knows, runs the whole
examination flow, and deletes everything it created at the end. The demo data is not
changed (re-import database/ken_etest.sql if you ever want a completely fresh start).

Exit code 0 = every check passed, 1 = at least one check failed."""
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor

import pymysql

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from backend import config                      # noqa: E402
from backend.helpers import round_half_up       # noqa: E402

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5000/api"
RUN = uuid.uuid4().hex[:6]
LETTERS = ["A", "B", "C", "D"]

counts = {"passed": 0, "failed": 0, "skipped": 0}
last_raw = ""


def check(name, condition, detail=""):
    if condition:
        counts["passed"] += 1
        print("  [PASS] " + name)
    else:
        counts["failed"] += 1
        print("  [FAIL] " + name + ("  -> " + str(detail) if detail != "" else ""))


def skip(name, why):
    counts["skipped"] += 1
    print("  [SKIP] %s (%s)" % (name, why))


def section(title):
    print("\n== %s ==" % title)


def post_raw(body_bytes):
    request = urllib.request.Request(URL, data=body_bytes, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read().decode("utf-8")
    except urllib.error.HTTPError as error:          # 4xx / 5xx still carry a JSON body
        return error.read().decode("utf-8")


def call(action, data=None, token=None):
    """Sends one API request. Returns the decoded reply (or None)."""
    global last_raw
    body = dict(data or {})
    body["action"] = action
    if token is not None:
        body["token"] = token
    last_raw = post_raw(json.dumps(body).encode("utf-8"))
    try:
        return json.loads(last_raw)
    except ValueError:
        return None


def succeeded(reply):
    return isinstance(reply, dict) and reply.get("success") is True


def code_of(reply):
    return reply.get("code") if isinstance(reply, dict) else "NO_REPLY"


def displayed_letter_for(question, text):
    for letter, option_text in question["options"].items():
        if option_text == text:
            return letter
    return None


# ---------------------------------------------------------------- database ---
DB = pymysql.connect(host=config.DB_HOST, port=config.DB_PORT, user=config.DB_USER, password=config.DB_PASS,
                     database=config.DB_NAME, charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor, autocommit=True)


def db_one(sql, params=()):
    with DB.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def db_run(sql, params=()):
    with DB.cursor() as cur:
        cur.execute(sql, params)


def db_count(table):
    return int(db_one("SELECT COUNT(*) AS c FROM " + table)["c"])


created = {"students": [], "exam": None}

# ================================================================ 1. server ====
section("1. Server and database")
try:
    health = json.loads(urllib.request.urlopen(URL, timeout=10).read().decode("utf-8"))
except Exception as error:
    print("\nCannot continue: the API is not reachable at %s (%s)" % (URL, error))
    sys.exit(1)
check("GET /api answers", health.get("success") is True)
check("database is connected and tables exist",
      health["data"].get("database") == "connected" and health["data"].get("tables_ready") is True, json.dumps(health))
if health["data"].get("database") != "connected":
    print("\nCannot continue: the database is not reachable.")
    sys.exit(1)
before = {"students": db_count("students"), "exams": db_count("exams"), "results": db_count("results")}

check("malformed JSON is rejected cleanly", code_of(json.loads(post_raw(b"not json"))) == "BAD_REQUEST")
check("unknown action is rejected", code_of(call("dropEverything")) == "UNKNOWN_ACTION")
check("request without action is rejected", code_of(call("")) == "BAD_REQUEST")

# ========================================================= 2. authentication ===
section("2. Authentication")
r = call("loginAdmin", {"username": "admin", "password": "wrong"})
check("admin: wrong password refused", not succeeded(r) and code_of(r) == "INVALID_LOGIN")
check("admin: empty fields refused", code_of(call("loginAdmin", {"username": "", "password": ""})) == "VALIDATION")
r = call("loginAdmin", {"username": "admin", "password": "Admin@123"})
check("admin: correct login succeeds and returns a token", succeeded(r) and len(r["data"]["token"]) == 64, r)
admin = r["data"]["token"]
check("admin login reply has no password data", "password" not in last_raw)
check("admin: username is case-insensitive", succeeded(call("loginAdmin", {"username": "ADMIN", "password": "Admin@123"})))

base = {"full_name": "Test Student", "email": "t.%s@example.test" % RUN, "password": "secret1", "class": "X"}
check("register: short name refused", code_of(call("registerStudent", dict(base, full_name="Ab"))) == "VALIDATION")
check("register: invalid email refused", code_of(call("registerStudent", dict(base, email="not-an-email"))) == "VALIDATION")
check("register: short password refused", code_of(call("registerStudent", dict(base, password="123"))) == "VALIDATION")
check("register: missing class refused", code_of(call("registerStudent", dict(base, **{"class": ""}))) == "VALIDATION")

students = {}
for i, label in enumerate("ABCDE"):
    email = "t.%s.%s@example.test" % (RUN, label)
    r = call("registerStudent", {"full_name": "Test Student %s %s" % (label, RUN), "email": email,
                                 "password": "secret1", "class": "Test Class"})
    if i == 0:
        check("register: valid registration succeeds",
              succeeded(r) and re.match(r"^STU\d{3,}$", r["data"]["student_id"]) is not None, r)
    students[label] = {"id": r["data"]["student_id"], "email": email}
    created["students"].append(r["data"]["student_id"])
r = call("registerStudent", dict(base, email=students["A"]["email"].upper()))
check("register: duplicate email refused (case-insensitive)", code_of(r) == "DUPLICATE_EMAIL")
check("student passwords are stored hashed (bcrypt)",
      db_one("SELECT password_hash h FROM students WHERE student_id = %s", (students["A"]["id"],))["h"].startswith("$2"))

check("student: wrong password refused",
      code_of(call("loginStudent", {"email": students["A"]["email"], "password": "nope-nope"})) == "INVALID_LOGIN")
check("student: unknown email refused with the same message",
      code_of(call("loginStudent", {"email": "nobody@example.test", "password": "secret1"})) == "INVALID_LOGIN")
for label, s in students.items():
    s["token"] = call("loginStudent", {"email": s["email"], "password": "secret1"})["data"]["token"]
check("student: correct login succeeds", len(students["A"]["token"]) == 64)
check("student login reply has no password data", "password" not in last_raw)
check("demo student (fatima.bello@demo.edu / Student@123) can log in",
      succeeded(call("loginStudent", {"email": "fatima.bello@demo.edu", "password": "Student@123"})))
check("demo student (chidinma.okafor@demo.edu) can log in",
      succeeded(call("loginStudent", {"email": "chidinma.okafor@demo.edu", "password": "Student@123"})))

check("protected action without token -> AUTH_REQUIRED", code_of(call("getAvailableExams")) == "AUTH_REQUIRED")
check("protected action with a made-up token -> AUTH_REQUIRED",
      code_of(call("getAvailableExams", {}, "f" + "0" * 63)) == "AUTH_REQUIRED")
check("student token cannot use admin actions", code_of(call("adminGetStats", {}, students["A"]["token"])) == "AUTH_REQUIRED")
check("admin token cannot use student actions", code_of(call("getAvailableExams", {}, admin)) == "AUTH_REQUIRED")
tmp = call("loginStudent", {"email": students["E"]["email"], "password": "secret1"})
call("logout", {}, tmp["data"]["token"])
check("logout invalidates the token", code_of(call("getAvailableExams", {}, tmp["data"]["token"])) == "AUTH_REQUIRED")

# ================================================ 3. admin: exams & questions ===
section("3. Admin: examination and question management")
exam_base = {"title": "ZZ Test Exam " + RUN, "subject": "S", "duration_minutes": 1, "pass_mark": 50}
check("exam: short title refused", code_of(call("adminCreateExam", dict(exam_base, title="ab"), admin)) == "VALIDATION")
check("exam: missing subject refused", code_of(call("adminCreateExam", dict(exam_base, subject=""), admin)) == "VALIDATION")
for bad in (0, 301, 2.5, "abc"):
    check("exam: duration %s refused" % json.dumps(bad),
          code_of(call("adminCreateExam", dict(exam_base, duration_minutes=bad), admin)) == "VALIDATION")
check("exam: pass mark 101 refused", code_of(call("adminCreateExam", dict(exam_base, pass_mark=101), admin)) == "VALIDATION")

r = call("adminCreateExam", dict(exam_base, subject="Testing", description="Temporary test exam"), admin)
check("exam: create succeeds", succeeded(r) and re.match(r"^EX\d{3,}$", r["data"]["exam_id"]) is not None, r)
exam_id = r["data"]["exam_id"]
created["exam"] = exam_id

check("exam: cannot be activated while it has no questions",
      code_of(call("adminSetExamStatus", {"exam_id": exam_id, "status": "Active"}, admin)) == "NO_QUESTIONS")
check("exam: status change on unknown exam -> NOT_FOUND",
      code_of(call("adminSetExamStatus", {"exam_id": "EX999", "status": "Active"}, admin)) == "NOT_FOUND")

good = {"exam_id": exam_id, "question": "What is two plus two?", "option_a": "3", "option_b": "4",
        "option_c": "5", "option_d": "6", "correct_answer": "B", "marks": 2}
cases = {"unknown exam": {"exam_id": "EX999"}, "short question": {"question": "abc"}, "empty option C": {"option_c": "  "},
         "answer letter E": {"correct_answer": "E"}, "marks 0": {"marks": 0}, "marks 101": {"marks": 101},
         "marks 2.5": {"marks": 2.5}, "marks \"abc\"": {"marks": "abc"}}
for name, override in cases.items():
    check("question: %s refused" % name, code_of(call("adminAddQuestion", dict(good, **override), admin)) == "VALIDATION")

bank = {}            # question_id -> {text, opts, correct, marks}
total_marks = 0
for n in range(1, 11):
    correct = random.choice(LETTERS)
    marks = 1 + (n % 3)
    opts = {l: "Q%d-%s option %s" % (n, RUN, l) for l in LETTERS}
    r = call("adminAddQuestion", {"exam_id": exam_id, "question": "Test question %d (%s)?" % (n, RUN),
                                  "option_a": opts["A"], "option_b": opts["B"], "option_c": opts["C"], "option_d": opts["D"],
                                  "correct_answer": correct.lower(), "marks": marks}, admin)
    if not succeeded(r):
        check("question %d created" % n, False, r)
        continue
    bank[r["data"]["question_id"]] = {"opts": opts, "correct": correct, "marks": marks}
    total_marks += marks
check("question: 10 questions created (lower-case answer letter accepted)", len(bank) == 10)

r = call("adminGetQuestions", {"exam_id": exam_id}, admin)
check("question: admin list returns all 10 with correct answers",
      succeeded(r) and len(r["data"]) == 10 and "correct_answer" in r["data"][0])


def admin_exam_row():
    for e in call("adminGetExams", {}, admin)["data"]:
        if e["exam_id"] == exam_id:
            return e


row = admin_exam_row()
check("exam list: total_questions and total_marks are counted correctly",
      row["total_questions"] == 10 and row["total_marks"] == total_marks, row)

extra = call("adminAddQuestion", good, admin)
extra_id = extra["data"]["question_id"]
r = call("adminUpdateQuestion", dict(good, question_id=extra_id, question="What is three plus three?",
                                     option_b="4", option_d="6", correct_answer="D"), admin)
check("question: update succeeds", succeeded(r), r)
updated = [q for q in call("adminGetQuestions", {"exam_id": exam_id}, admin)["data"] if q["question_id"] == extra_id]
check("question: update is stored",
      len(updated) == 1 and updated[0]["question"] == "What is three plus three?" and updated[0]["correct_answer"] == "D")
check("question: update of unknown id -> NOT_FOUND",
      code_of(call("adminUpdateQuestion", dict(good, question_id="Q99999"), admin)) == "NOT_FOUND")
check("question: delete succeeds", succeeded(call("adminDeleteQuestion", {"question_id": extra_id}, admin)))
check("question: delete of unknown id -> NOT_FOUND",
      code_of(call("adminDeleteQuestion", {"question_id": extra_id}, admin)) == "NOT_FOUND")
check("exam list: question count back to 10 after delete", admin_exam_row()["total_questions"] == 10)

listed = [e["exam_id"] for e in call("getAvailableExams", {}, students["A"]["token"])["data"]]
check("student cannot see an inactive exam", exam_id not in listed)
check("student cannot open an inactive exam",
      code_of(call("getExam", {"exam_id": exam_id}, students["A"]["token"])) == "EXAM_INACTIVE")
check("exam: activation succeeds once it has questions",
      succeeded(call("adminSetExamStatus", {"exam_id": exam_id, "status": "Active"}, admin)))
r = call("adminUpdateExam", {"exam_id": exam_id, "title": "ZZ Test Exam %s (edited)" % RUN, "subject": "Testing",
                             "description": "Temporary test exam", "duration_minutes": 1, "pass_mark": 50, "status": "Active"}, admin)
check("exam: edit succeeds", succeeded(r), r)
visible = [e for e in call("getAvailableExams", {}, students["A"]["token"])["data"] if e["exam_id"] == exam_id]
check("student sees the active exam with correct counts and edited title",
      len(visible) == 1 and visible[0]["total_questions"] == 10 and visible[0]["total_marks"] == total_marks
      and "(edited)" in visible[0]["title"])
check("seeded exam EX003 (inactive) is hidden from students", "EX003" not in
      [e["exam_id"] for e in call("getAvailableExams", {}, students["A"]["token"])["data"]])

# ================================================ 4. start, randomisation =====
section("4. Starting an examination and randomisation")
r = call("getExam", {"exam_id": exam_id}, students["A"]["token"])
check("instructions: getExam works and in_progress is false",
      succeeded(r) and r["data"]["in_progress"] is False and r["data"]["attempt"] is None)
check("instructions: reply does not leak correct answers", "correct" not in last_raw.lower())
check("startExam: unknown exam -> NOT_FOUND",
      code_of(call("startExam", {"exam_id": "EX999"}, students["A"]["token"])) == "NOT_FOUND")
check("startExam: needs login", code_of(call("startExam", {"exam_id": exam_id})) == "AUTH_REQUIRED")

started = {}
for label in "ABCD":
    r = call("startExam", {"exam_id": exam_id}, students[label]["token"])
    check("startExam (%s): succeeds" % label, succeeded(r), r)
    started[label] = r["data"]
    if label == "A":
        check("startExam: reply does not leak correct answers", "correct" not in last_raw.lower())
        check("startExam: first start is not \"resumed\"", r["data"]["resumed"] is False)
        check("startExam: remaining time is about the full duration (60 s)",
              55 <= r["data"]["remaining_seconds"] <= 60, r["data"]["remaining_seconds"])
        check("startExam: exam info and 10 questions returned",
              r["data"]["exam"]["total_questions"] == 10 and len(r["data"]["questions"]) == 10)
        q0 = r["data"]["questions"][0]
        check("startExam: question has id, text, options A-D and marks",
              all(k in q0 for k in ("question_id", "question", "marks")) and list(q0["options"].keys()) == LETTERS)

orders = {}
for label, data in started.items():
    ids = [q["question_id"] for q in data["questions"]]
    check("randomisation (%s): every question appears exactly once" % label,
          sorted(ids) == sorted(bank.keys()) and len(ids) == 10)
    orders[label] = ",".join(ids)
check("randomisation: question order differs between students", len(set(orders.values())) > 1, " | ".join(orders.values()))

if config.SHUFFLE_OPTIONS:
    moved = sum(1 for q in started["A"]["questions"]
                if list(q["options"].values()) != list(bank[q["question_id"]]["opts"].values()))
    check("randomisation: option order is shuffled for the student", moved >= 1, "moved=%d of 10" % moved)
    check("randomisation: each question still shows its own four options",
          all(sorted(q["options"].values()) == sorted(bank[q["question_id"]]["opts"].values())
              for q in started["A"]["questions"]))
else:
    skip("option shuffling checks", "SHUFFLE_OPTIONS is False in backend/config.py")

first_remaining = started["A"]["remaining_seconds"]
time.sleep(3)
r = call("startExam", {"exam_id": exam_id}, students["A"]["token"])
check("resume: startExam again is \"resumed\"", succeeded(r) and r["data"]["resumed"] is True)
check("resume: identical question and option order after a refresh",
      json.dumps(r["data"]["questions"]) == json.dumps(started["A"]["questions"]))
drop = first_remaining - r["data"]["remaining_seconds"]
check("timing: the server timer kept running while the student was away (3 s wait)", 2 <= drop <= 6, "dropped by %s s" % drop)
check("instructions: in_progress is true while an attempt is open",
      call("getExam", {"exam_id": exam_id}, students["A"]["token"])["data"]["in_progress"] is True)

# ================================================================ 5. marking ===
section("5. Automatic marking (answers are chosen by what the student SEES)")
answers_a = {}
for q in started["A"]["questions"]:
    info = bank[q["question_id"]]
    answers_a[q["question_id"]] = displayed_letter_for(q, info["opts"][info["correct"]])
r = call("submitExam", {"exam_id": exam_id, "answers": answers_a}, students["A"]["token"])
check("marking A: all correct -> full marks",
      succeeded(r) and r["data"]["score"] == total_marks and r["data"]["total_marks"] == total_marks, r)
check("marking A: 100% and PASS", abs(r["data"]["percentage"] - 100) < 0.01 and r["data"]["status"] == "PASS")
result_a = r["data"]
check("result has ISO dates and a non-negative time spent",
      re.match(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$", result_a["submit_time"]) is not None
      and isinstance(result_a["time_spent_seconds"], int) and result_a["time_spent_seconds"] >= 3)
check("result carries exam title, subject and pass mark",
      result_a["exam_title"].startswith("ZZ Test Exam") and result_a["subject"] == "Testing" and result_a["pass_mark"] == 50)

answers_b = {}
for q in started["B"]["questions"]:
    info = bank[q["question_id"]]
    correct_text = info["opts"][info["correct"]]
    answers_b[q["question_id"]] = next(l for l, t in q["options"].items() if t != correct_text)
r = call("submitExam", {"exam_id": exam_id, "answers": answers_b}, students["B"]["token"])
check("marking B: all wrong -> 0 marks, 0%, FAIL",
      succeeded(r) and r["data"]["score"] == 0 and r["data"]["status"] == "FAIL" and r["data"]["percentage"] == 0, r)

answers_c, expected = {}, 0
for i, q in enumerate(started["C"]["questions"]):
    info = bank[q["question_id"]]
    correct_text = info["opts"][info["correct"]]
    if i < 5:
        answers_c[q["question_id"]] = displayed_letter_for(q, correct_text)
        expected += info["marks"]
    elif i < 7:
        answers_c[q["question_id"]] = next(l for l, t in q["options"].items() if t != correct_text)
    elif i == 7:
        answers_c[q["question_id"]] = "Z"
r = call("submitExam", {"exam_id": exam_id, "answers": answers_c}, students["C"]["token"])
expected_pct = round_half_up(expected / total_marks * 100, 2)
check("marking C: mixed answers -> %d/%d marks" % (expected, total_marks),
      succeeded(r) and r["data"]["score"] == expected, "%s expected=%s" % (r, expected))
check("marking C: percentage %s and status follow the pass mark" % expected_pct,
      abs(r["data"]["percentage"] - expected_pct) < 0.01 and r["data"]["status"] == ("PASS" if expected_pct >= 50 else "FAIL"))

r = call("submitExam", {"exam_id": exam_id, "answers": {}}, students["D"]["token"])
check("marking D: empty answers -> 0 marks (no error)",
      succeeded(r) and r["data"]["score"] == 0 and r["data"]["status"] == "FAIL", r)

stored = db_one("SELECT score, total_marks FROM results WHERE student_id = %s AND exam_id = %s", (students["A"]["id"], exam_id))
check("database holds the stored result for student A", stored is not None and int(stored["score"]) == total_marks)
check("finished attempts are removed from exam_attempts",
      db_one("SELECT COUNT(*) c FROM exam_attempts WHERE student_id = %s AND exam_id = %s", (students["A"]["id"], exam_id))["c"] == 0)

# ======================================================= 6. one attempt rule ===
section("6. One attempt per student, access control")
r = call("submitExam", {"exam_id": exam_id, "answers": answers_a}, students["A"]["token"])
check("second submit refused with ALREADY_SUBMITTED and the original result id",
      code_of(r) == "ALREADY_SUBMITTED" and r["data"]["result_id"] == result_a["result_id"])
r = call("startExam", {"exam_id": exam_id}, students["A"]["token"])
check("starting again after submitting -> ALREADY_SUBMITTED",
      code_of(r) == "ALREADY_SUBMITTED" and r["data"]["result_id"] == result_a["result_id"])
check("only one result row exists for the student",
      db_one("SELECT COUNT(*) c FROM results WHERE student_id = %s AND exam_id = %s", (students["A"]["id"], exam_id))["c"] == 1)
check("submitting an exam that was never started -> NOT_STARTED",
      code_of(call("submitExam", {"exam_id": exam_id, "answers": {}}, students["E"]["token"])) == "NOT_STARTED")

r = call("getStudentResults", {}, students["A"]["token"])
check("student results list contains the new result",
      succeeded(r) and len(r["data"]) == 1 and r["data"][0]["result_id"] == result_a["result_id"])
r = call("getResult", {"result_id": result_a["result_id"]}, students["A"]["token"])
check("student can open their own result",
      succeeded(r) and r["data"]["score"] == total_marks and r["data"]["student_name"] == "Test Student A " + RUN)
check("another student cannot open someone else's result",
      code_of(call("getResult", {"result_id": result_a["result_id"]}, students["B"]["token"])) == "NOT_FOUND")
mine = [e for e in call("getAvailableExams", {}, students["A"]["token"])["data"] if e["exam_id"] == exam_id][0]
check("dashboard data: exam shows the attempt (score, percentage, PASS)",
      mine["attempt"] is not None and mine["attempt"]["status"] == "PASS" and mine["attempt"]["result_id"] == result_a["result_id"])

# ====================================================== 7. timing and deadlines ==
section("7. Timing")
check("student E starts the exam", succeeded(call("startExam", {"exam_id": exam_id}, students["E"]["token"])))
db_run("UPDATE exam_attempts SET started_at = DATE_SUB(started_at, INTERVAL 10 MINUTE) WHERE student_id = %s AND exam_id = %s",
       (students["E"]["id"], exam_id))
r = call("startExam", {"exam_id": exam_id}, students["E"]["token"])
check("time already used up: remaining_seconds is 0 (website then auto-submits)",
      succeeded(r) and r["data"]["remaining_seconds"] == 0, r)
r = call("submitExam", {"exam_id": exam_id, "answers": {}}, students["E"]["token"])
check("late submit is still accepted and the real time spent (about 10 min) is recorded",
      succeeded(r) and 600 <= r["data"]["time_spent_seconds"] <= 620, r)

# ====================================================== 8. proctoring log =======
section("8. Monitoring (proctoring) log")
r = call("registerStudent", {"full_name": "Test Student F " + RUN, "email": "t.%s.F@example.test" % RUN,
                             "password": "secret1", "class": "Test Class"})
students["F"] = {"id": r["data"]["student_id"], "email": "t.%s.F@example.test" % RUN}
created["students"].append(r["data"]["student_id"])
token_f = call("loginStudent", {"email": students["F"]["email"], "password": "secret1"})["data"]["token"]

check("log: refused when no exam is in progress",
      code_of(call("logProctoringEvent", {"exam_id": exam_id, "event_type": "TAB_SWITCH", "event_description": "x"}, token_f)) == "NOT_STARTED")
call("startExam", {"exam_id": exam_id}, token_f)
check("log: unknown event type refused",
      code_of(call("logProctoringEvent", {"exam_id": exam_id, "event_type": "HACK", "event_description": "x"}, token_f)) == "VALIDATION")
check("log: unknown exam refused",
      code_of(call("logProctoringEvent", {"exam_id": "EX999", "event_type": "TAB_SWITCH"}, token_f)) == "NOT_FOUND")
for etype in ("TAB_SWITCH", "WINDOW_BLUR", "RIGHT_CLICK"):
    check("log: %s recorded" % etype,
          succeeded(call("logProctoringEvent", {"exam_id": exam_id, "event_type": etype, "event_description": "Test " + etype}, token_f)))
r = call("adminGetProctoringLogs", {"exam_id": exam_id}, admin)
by_severity = {l["event_type"]: l["severity"] for l in r["data"] if l["student_id"] == students["F"]["id"]}
check("admin log: severity is decided by the server (high / medium / low)",
      by_severity == {"TAB_SWITCH": "high", "WINDOW_BLUR": "medium", "RIGHT_CLICK": "low"}, by_severity)
check("admin log: newest event is listed first", r["data"][0]["event_type"] == "RIGHT_CLICK")
check("admin log: has student name, exam title and ISO timestamp",
      r["data"][0]["student_name"] == "Test Student F " + RUN and r["data"][0]["exam_title"].startswith("ZZ Test Exam")
      and r["data"][0]["timestamp"].endswith("Z"))
r = call("adminGetProctoringLogs", {"exam_id": exam_id, "event_type": "TAB_SWITCH"}, admin)
check("admin log: filter by exam and event type works",
      len(r["data"]) > 0 and all(l["event_type"] == "TAB_SWITCH" and l["exam_id"] == exam_id for l in r["data"]))
check("admin log: not available to students", code_of(call("adminGetProctoringLogs", {}, token_f)) == "AUTH_REQUIRED")

call("submitExam", {"exam_id": exam_id, "answers": {}}, token_f)
check("log: final event just after submission is still accepted (auto-submit at max warnings)",
      succeeded(call("logProctoringEvent", {"exam_id": exam_id, "event_type": "MAX_WARNINGS_REACHED", "event_description": "Test"}, token_f)))
db_run("UPDATE results SET submit_time = DATE_SUB(submit_time, INTERVAL 10 MINUTE) WHERE student_id = %s AND exam_id = %s",
       (students["F"]["id"], exam_id))
check("log: events long after submission are refused",
      code_of(call("logProctoringEvent", {"exam_id": exam_id, "event_type": "TAB_SWITCH"}, token_f)) == "NOT_STARTED")

# ========================================================= 9. admin reports =====
section("9. Admin dashboard, results and students")
r = call("adminGetStats", {}, admin)
s = r["data"]
check("stats: all totals are present and numeric",
      succeeded(r) and all(isinstance(s[k], int) for k in ("total_students", "total_exams", "total_submissions", "total_events"))
      and isinstance(s["average_score"], (int, float)))
check("stats: submission count equals the number of rows in results", s["total_submissions"] == db_count("results"))
db_avg = round_half_up(float(db_one("SELECT AVG(percentage) a FROM results")["a"]), 1)
check("stats: average score equals the database average", abs(s["average_score"] - db_avg) < 0.05, "%s vs %s" % (s["average_score"], db_avg))
check("stats: per-exam statistics include the test exam",
      len([e for e in s["exam_stats"] if e["exam_id"] == exam_id and e["submissions"] == 6]) == 1)
check("stats: at most 5 recent results, newest first",
      len(s["recent_results"]) <= 5 and s["recent_results"][0]["submit_time"] >= s["recent_results"][-1]["submit_time"])

r = call("adminGetResults", {"exam_id": exam_id}, admin)
check("results: filter by exam returns exactly the 6 test results (students A-F)", succeeded(r) and len(r["data"]) == 6)
check("results: API count equals the database count for the test exam",
      len(r["data"]) == db_one("SELECT COUNT(*) c FROM results WHERE exam_id = %s", (exam_id,))["c"])
check("results: rows carry student and exam names",
      r["data"][0]["student_name"] != "Unknown student" and r["data"][0]["exam_title"] != "Unknown examination")
check("results: no filter returns all results (demo 9 + test 6 at least)",
      len(call("adminGetResults", {"exam_id": ""}, admin)["data"]) >= 15)
check("results: not available to students", code_of(call("adminGetResults", {}, students["A"]["token"])) == "AUTH_REQUIRED")
r = call("adminGetStudents", {}, admin)
sa = [st for st in r["data"] if st["student_id"] == students["A"]["id"]][0]
check("students list: shows student, class, status and exams taken",
      sa["exams_taken"] == 1 and sa["status"] == "Active" and sa["class"] == "Test Class" and "password_hash" not in sa)

# ======================================================= 10. status switches ====
section("10. Deactivating accounts and examinations")
check("admin deactivates a student",
      succeeded(call("adminSetStudentStatus", {"student_id": students["B"]["id"], "status": "Inactive"}, admin)))
check("inactive student cannot log in",
      code_of(call("loginStudent", {"email": students["B"]["email"], "password": "secret1"})) == "ACCOUNT_INACTIVE")
check("existing session of a deactivated student stops working",
      code_of(call("getAvailableExams", {}, students["B"]["token"])) == "AUTH_REQUIRED")
check("admin reactivates the student",
      succeeded(call("adminSetStudentStatus", {"student_id": students["B"]["id"], "status": "Active"}, admin)))
check("reactivated student can log in again",
      succeeded(call("loginStudent", {"email": students["B"]["email"], "password": "secret1"})))
check("invalid student status refused",
      code_of(call("adminSetStudentStatus", {"student_id": students["B"]["id"], "status": "Banned"}, admin)) == "VALIDATION")
check("unknown student -> NOT_FOUND",
      code_of(call("adminSetStudentStatus", {"student_id": "STU99999", "status": "Active"}, admin)) == "NOT_FOUND")

check("admin deactivates the test exam", succeeded(call("adminSetExamStatus", {"exam_id": exam_id, "status": "Inactive"}, admin)))
check("deactivated exam disappears from the student list",
      exam_id not in [e["exam_id"] for e in call("getAvailableExams", {}, students["C"]["token"])["data"]])
a = succeeded(call("adminSetExamStatus", {"exam_id": "EX003", "status": "Active"}, admin))
b = succeeded(call("adminSetExamStatus", {"exam_id": "EX003", "status": "Inactive"}, admin))
check("admin can activate the seeded inactive exam EX003 and then restore it", a and b)

# ============================================================ 11. security =======
section("11. Basic security checks (SQL injection attempts)")
check("login with SQL text ' OR '1'='1 is refused",
      not succeeded(call("loginStudent", {"email": "' OR '1'='1' -- ", "password": "' OR '1'='1"})))
check("admin login with SQL comment trick is refused", not succeeded(call("loginAdmin", {"username": "admin' -- ", "password": "x"})))
check("exam id with SQL text -> NOT_FOUND (no error)",
      code_of(call("getExam", {"exam_id": "EX001' OR '1'='1"}, students["C"]["token"])) == "NOT_FOUND")
r = call("adminGetResults", {"exam_id": "x' OR 1=1 -- "}, admin)
check("result filter with SQL text returns nothing (not every row)", succeeded(r) and len(r["data"]) == 0)
r = call("registerStudent", {"full_name": "Robert'); DROP TABLE students;--", "email": "t.%s.inj@example.test" % RUN,
                             "password": "secret1", "class": "X"})
if succeeded(r):
    created["students"].append(r["data"]["student_id"])
check("SQL in a name is stored as plain text and the table still exists", succeeded(r) and db_count("students") > 0)
check("wrong data types (lists) are handled without a server error",
      code_of(call("loginStudent", {"email": {"a": "b"}, "password": ["x"]})) == "VALIDATION")
check("exam_id as a list -> NOT_FOUND, no server error",
      code_of(call("startExam", {"exam_id": ["x"]}, students["C"]["token"])) == "NOT_FOUND")
for blocked in ("backend/config.py", "database/ken_etest.sql", "app.py", "tests/api_test.py"):
    try:
        status = urllib.request.urlopen(URL.rsplit("/api", 1)[0] + "/" + blocked, timeout=10).status
    except urllib.error.HTTPError as error:
        status = error.code
    check("the file %s cannot be downloaded from the website (404)" % blocked, status == 404, status)

# ====================================================== 12. concurrency ==========
section("12. Double submit at the same instant")
check("admin reactivates the test exam", succeeded(call("adminSetExamStatus", {"exam_id": exam_id, "status": "Active"}, admin)))
r = call("registerStudent", {"full_name": "Test Student G " + RUN, "email": "t.%s.G@example.test" % RUN,
                             "password": "secret1", "class": "Test Class"})
created["students"].append(r["data"]["student_id"])
token_g = call("loginStudent", {"email": "t.%s.G@example.test" % RUN, "password": "secret1"})["data"]["token"]
call("startExam", {"exam_id": exam_id}, token_g)


def submit_once(_):
    body = json.dumps({"action": "submitExam", "exam_id": exam_id, "answers": {}, "token": token_g}).encode("utf-8")
    return json.loads(post_raw(body))


with ThreadPoolExecutor(max_workers=6) as pool:
    replies = list(pool.map(submit_once, range(6)))
success = sum(1 for x in replies if succeeded(x))
already = sum(1 for x in replies if code_of(x) == "ALREADY_SUBMITTED")
other = [x for x in replies if not succeeded(x) and code_of(x) != "ALREADY_SUBMITTED"]
check("6 simultaneous submits: exactly 1 accepted, 5 told ALREADY_SUBMITTED",
      success == 1 and already == 5 and not other, "success=%d already=%d other=%s" % (success, already, other))
sid_g = db_one("SELECT student_id FROM students WHERE email = %s", ("t.%s.G@example.test" % RUN,))["student_id"]
check("6 simultaneous submits: exactly 1 result row stored",
      db_one("SELECT COUNT(*) c FROM results WHERE student_id = %s", (sid_g,))["c"] == 1)

# ================================================================== cleanup =====
section("Cleanup")
ids = created["students"]
if ids:
    marks = ",".join(["%s"] * len(ids))
    for table in ("proctoring_logs", "results", "exam_attempts"):
        db_run("DELETE FROM %s WHERE student_id IN (%s)" % (table, marks), ids)
    db_run("DELETE FROM sessions WHERE user_id IN (%s)" % marks, ids)
    db_run("DELETE FROM students WHERE student_id IN (%s)" % marks, ids)
if created["exam"]:
    for table in ("proctoring_logs", "results", "exam_attempts", "questions"):
        db_run("DELETE FROM %s WHERE exam_id = %%s" % table, (created["exam"],))
    db_run("DELETE FROM exams WHERE exam_id = %s", (created["exam"],))
db_run("DELETE FROM sessions WHERE role = 'admin' AND expires_at > UTC_TIMESTAMP()")
# put the ID counters back to the highest existing ID, so new records continue the demo numbering
for name, table, column, start in (("student", "students", "student_id", 4), ("exam", "exams", "exam_id", 3),
                                   ("question", "questions", "question_id", 2), ("result", "results", "result_id", 4),
                                   ("log", "proctoring_logs", "log_id", 4)):
    db_run("UPDATE counters SET value = (SELECT COALESCE(MAX(CAST(SUBSTRING(%s, %d) AS UNSIGNED)), 0) FROM %s) WHERE name = %%s"
           % (column, start, table), (name,))
after = {"students": db_count("students"), "exams": db_count("exams"), "results": db_count("results")}
check("all test data removed; demo data untouched", after == before, "%s vs %s" % (before, after))

print("\n----------------------------------------")
print("Passed: %d   Failed: %d   Skipped: %d" % (counts["passed"], counts["failed"], counts["skipped"]))
sys.exit(0 if counts["failed"] == 0 else 1)

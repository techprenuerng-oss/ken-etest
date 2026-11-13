"""Ken E-Test - app.py
The Flask application. It does two things:

1. Serves the website (the HTML, CSS and JavaScript files of the project).
2. Provides the API at /api. Every request from js/api.js arrives here as JSON:
       { "action": "loginStudent", "email": "...", "password": "...", "token": "..." }
   and every reply has the same shape:  { success, message, code, data }

Run:   python app.py        then open http://127.0.0.1:5000
Open http://127.0.0.1:5000/api in a browser to check that Python and MySQL are working."""
import json
import os
import sys
import traceback
from datetime import datetime, timezone

import pymysql
from flask import Flask, Response, abort, request, send_from_directory

from backend import admin, auth, config, exams, proctoring, results, support
from backend.db import close_conn, fetch_one, get_conn
from backend.helpers import clean_text, fail, ok

ROOT = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder=None)
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
app.teardown_appcontext(close_conn)          # closes the database connection after each request

# The only actions the website may call. Anything else is rejected.
ACTIONS = {
    "ping": lambda data: ok("pong"),
    # authentication
    "registerStudent": auth.action_registerStudent,
    "loginStudent": auth.action_loginStudent,
    "changeStudentPassword": auth.action_changeStudentPassword,
    "loginAdmin": auth.action_loginAdmin,
    "createSupportTicket": support.action_createSupportTicket,
    "getMySupportTickets": support.action_getMySupportTickets,
    "logout": auth.action_logout,
    # student
    "getAvailableExams": exams.action_getAvailableExams,
    "getExam": exams.action_getExam,
    "startExam": exams.action_startExam,
    "submitExam": exams.action_submitExam,
    "getStudentResults": results.action_getStudentResults,
    "getResult": results.action_getResult,
    "logProctoringEvent": proctoring.action_logProctoringEvent,
    # admin
    "adminGetStats": admin.action_adminGetStats,
    "adminGetExams": admin.action_adminGetExams,
    "adminCreateExam": admin.action_adminCreateExam,
    "adminUpdateExam": admin.action_adminUpdateExam,
    "adminSetExamStatus": admin.action_adminSetExamStatus,
    "adminGetQuestions": admin.action_adminGetQuestions,
    "adminAddQuestion": admin.action_adminAddQuestion,
    "adminUpdateQuestion": admin.action_adminUpdateQuestion,
    "adminDeleteQuestion": admin.action_adminDeleteQuestion,
    "adminGetStudents": admin.action_adminGetStudents,
    "adminCreateStudent": admin.action_adminCreateStudent,
    "adminUpdateStudentMatric": admin.action_adminUpdateStudentMatric,
    "adminSetStudentStatus": admin.action_adminSetStudentStatus,
    "adminGetSupportTickets": support.action_adminGetSupportTickets,
    "adminUpdateSupportTicket": support.action_adminUpdateSupportTicket,
    "adminGetResults": admin.action_adminGetResults,
    "adminGetProctoringLogs": proctoring.action_adminGetProctoringLogs,
}


def send_json(response, http_status=200):
    body = json.dumps(response, ensure_ascii=False, default=str)
    return Response(body, status=http_status, mimetype="application/json",
                    headers={"Cache-Control": "no-store"})


# ----------------------------------------------------------------- the API ---

@app.route("/api", methods=["GET", "POST"])
@app.route("/api/", methods=["GET", "POST"])
def api():
    if request.method == "GET":
        return health_check()

    try:
        data = request.get_json(force=True, silent=True)
        if not isinstance(data, dict):
            return send_json(fail("The request body is not valid JSON.", "BAD_REQUEST"), 400)

        action = data.get("action")
        action = action if isinstance(action, str) else ""
        if action == "":
            return send_json(fail("No action was specified.", "BAD_REQUEST"), 400)
        if action not in ACTIONS:
            return send_json(fail("Unknown action: " + clean_text(action, 40), "UNKNOWN_ACTION"), 400)

        return send_json(ACTIONS[action](data))
    except (pymysql.err.OperationalError, pymysql.err.InterfaceError) as error:
        app.logger.error("Ken E-Test database error: %s", error)
        # 2002/2003 = cannot reach MySQL, 1045 = wrong user/password, 1049 = database missing
        if error.args and error.args[0] in (2002, 2003, 2006, 2013, 1045, 1049):
            return send_json(fail("Cannot connect to the database. Check that MySQL is running, that "
                                  "backend/config.py is correct, and that database/ken_etest.sql was imported.",
                                  "DB_UNAVAILABLE"), 500)
        return send_json(fail("Database error: " + str(error) if config.DEBUG else "A database error occurred.",
                              "SERVER_ERROR"), 500)
    except Exception as error:
        app.logger.error("Ken E-Test error:\n%s", traceback.format_exc())
        return send_json(fail("Server error: " + str(error) if config.DEBUG else "A server error occurred.",
                              "SERVER_ERROR"), 500)


def health_check():
    """GET /api shows whether Python and MySQL are working."""
    info = {"app": "Ken E-Test", "python": sys.version.split()[0],
            "time": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    try:
        get_conn()
        info["database"] = "connected"
        info["tables_ready"] = fetch_one("SHOW TABLES LIKE 'students'") is not None
        if not info["tables_ready"]:
            info["hint"] = "The database exists but the tables are missing. Import database/ken_etest.sql."
    except pymysql.err.Error as error:
        info["database"] = "NOT connected"
        info["hint"] = ("Check that MySQL is running and that backend/config.py has the right settings, "
                        "then import database/ken_etest.sql.")
        if config.DEBUG:
            info["error"] = str(error)
    return send_json(ok("Ken E-Test API is running.", info))


# ------------------------------------------------------------- the website ---

# Only these files may be downloaded: the page files and the css / js / assets folders.
# The backend code, the SQL file and the tests are never served.
PUBLIC_FOLDERS = {"css": {".css"}, "js": {".js"}, "admin": {".html"},
                  "assets": {".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico"}}


@app.route("/", defaults={"path": "index.html"})
@app.route("/<path:path>")
def website(path):
    parts = path.split("/")
    extension = os.path.splitext(path)[1].lower()
    if len(parts) == 1:
        allowed = extension == ".html"
    else:
        allowed = parts[0] in PUBLIC_FOLDERS and extension in PUBLIC_FOLDERS[parts[0]]
    if not allowed:
        abort(404)
    return send_from_directory(ROOT, path)


if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "5000")), threaded=True)

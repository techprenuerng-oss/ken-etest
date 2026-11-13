# Ken E-Test

**Design and Implementation of an Online Quiz and Examination System**
*Python (Flask) + MySQL edition*

Designed by: KENANAGHA DEINYEFA GODSPOWER (as shown in the landing page footer)

Administrators register students by matriculation number. Students log in, take timed multiple-choice examinations and see their marked result immediately. Administrators manage examinations, questions and students, and review results and monitoring events.

The frontend is plain HTML, CSS and JavaScript. The backend is written in **Python** (Flask) and the database is **MySQL / MariaDB**. This edition replaces the earlier Google Apps Script + Google Sheets backend; the pages, design and user experience are unchanged.

> This is an academic project, not an enterprise platform. See [Limitations](#limitations).

---

## Quick start

You need **Python 3.10 or newer** and a **MySQL or MariaDB** server. The MySQL that comes with XAMPP is fine: start only *MySQL* in the XAMPP Control Panel (Apache is not needed).

1. **Open a terminal in the project folder** and install the Python packages:
   ```bash
   pip install -r requirements.txt        # on Windows you can also use:  py -m pip install -r requirements.txt
   ```
2. **Create the database.** Open http://localhost/phpmyadmin → **Import** tab → choose `database/ken_etest.sql` → **Go**.
   Or from the command line: `mysql -u root -p < database/ken_etest.sql`
   (The file creates the database `ken_etest`, all tables and the demo data. You do not need to create anything first.)
3. **For an existing live deployment:** back up the database first, then import `database/upgrade_v2.sql` into the existing `ken_etest` database. This is a one-time, additive migration; it does not drop existing tables or results. Do NOT import `database/ken_etest.sql` over a live database because that file resets all data.
4. **Check the settings** in `backend/config.py`. The defaults (user `root`, empty password, host `127.0.0.1`, port `3306`) match XAMPP, so normally nothing needs to change.
5. **Start the application:**
   ```bash
   python app.py                           # on Windows you can also use:  py app.py
   ```
6. **Check the backend.** Open http://127.0.0.1:5000/api. You should see `"Ken E-Test API is running."`, `"database": "connected"` and `"tables_ready": true`.
7. **Open the website:** http://127.0.0.1:5000/
   Admin panel: http://127.0.0.1:5000/admin/login.html

Keep the terminal open while you use the site; press `Ctrl+C` to stop it. Do not double-click the HTML files (`file://`): the pages must be opened through the running application so they can reach the API.

## Demo login credentials

These are demonstration accounts created by the SQL file. Change or delete them before any real use.

| Role | Login | Password |
|---|---|---|
| Admin | username `admin` | `Admin@123` |
| Student STU001 | `STU001` | `Student@123` |
| Student STU002 | `STU002` | `Student@123` |
| Student STU003 | `STU003` | `Student@123` |
| Student STU004 | `STU004` | `Student@123` |
| Student STU005 | `STU005` | `Student@123` |
| Demo student 1 (after v2 migration) | `DEMO/2026/001` | `Student@123` |
| Demo student 2 (after v2 migration) | `DEMO/2026/002` | `Student@123` |
| Demo student 3 (after v2 migration) | `DEMO/2026/003` | `Student@123` |

STU001–STU004 have already taken both active examinations. **To demonstrate taking an exam**, ask the administrator to register a new student, or log in as **STU005** (`STU005`), who has only taken *ICT Fundamentals* and can take *Computer Applications*.

Demo data: 3 examinations (`EX001` ICT Fundamentals, 15 min; `EX002` Computer Applications, 20 min; `EX003` Introduction to Programming, **inactive**, so you can demonstrate activating it), 25 questions (2 marks each), 9 results and 8 monitoring events.

**Resetting the demo:** importing `database/ken_etest.sql` again drops and re-creates every table and restores the demo data. It also deletes everything else, so only do this when you want a fresh start.

## Configuration

Everything is in `backend/config.py`.

| Setting | Meaning |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS` | MySQL connection. Edit if your MySQL uses another port/user/password. |
| `SESSION_SECONDS` | How long a login lasts (default 6 hours). |
| `SHUFFLE_QUESTIONS` | Give every student the questions in a different random order (default `True`). |
| `SHUFFLE_OPTIONS` | Also shuffle the four options A–D per student (default `True`). Set to `False` if questions use "All of the above" or "Both A and B". |
| `DEBUG` | `True` shows technical error details in API replies. Use only while developing. |

Every database setting can also be given as an environment variable (`ETEST_DB_HOST`, `ETEST_DB_PORT`, `ETEST_DB_NAME`, `ETEST_DB_USER`, `ETEST_DB_PASS`), which is the safe way to supply a real password without writing it in a file that may be shared. `HOST` and `PORT` environment variables change the address the application listens on (default `127.0.0.1:5000`).

### Troubleshooting

| Problem | Fix |
|---|---|
| The pages say "Could not reach the server" | `python app.py` is not running, or you opened the page with `file://`. |
| "The server sent an unexpected reply" | Open http://127.0.0.1:5000/api in the browser and read the message. |
| `"database": "NOT connected"` | MySQL is not running, or `backend/config.py` has the wrong user, password or port. |
| `"tables_ready": false` | You have not imported `database/ken_etest.sql` yet. |
| `ModuleNotFoundError: No module named 'flask'` | Run `pip install -r requirements.txt` first. |
| MySQL will not start in XAMPP | Another MySQL is using port 3306. Stop it, or change the port and set `DB_PORT`. |
| "Address already in use" when starting | Something else uses port 5000. Start with another port: `PORT=5001 python app.py` (Windows: `set PORT=5001` then `python app.py`). |
| Login says "Incorrect email or password" for a demo account | The SQL file was not imported (or an old version was). Import it again. |

## Features

**Student**: landing page, matriculation-number login, logout, support requests and password change · dashboard with statistics and open examinations · instructions page with the monitoring notice · timed multiple-choice examination (countdown, previous/next, question navigator, answered indicators, progress bar) · submit confirmation and automatic submission when the timer reaches zero · automatic marking on the server · result page and examination history.

**Administrator**: dashboard (students, examinations, submissions, average score, pass rate, per-exam chart) · register students from the official student database (initial password = matriculation number) · review/respond to student support tickets · create/edit/schedule/activate/deactivate examinations · add/edit/delete questions · view students and activate/deactivate accounts · view and filter results · monitoring log.

**Randomisation**: questions and options are shuffled for every student (see below).

## Randomisation

When a student starts an examination the server shuffles the order of the questions and (optionally) the order of the options A–D of every question. The shuffle is saved in the table `exam_attempts`, so:

- a student who refreshes the page or comes back later gets **exactly the same order**;
- the server translates the letters the student chose back to the real options before marking, so marking is always correct;
- two students sitting next to each other see different orders, which makes copying harder.

The correct answers are never sent to the browser.

## How it works

```
 Browser (HTML / CSS / JavaScript)       HTTP, JSON         Python / Flask (backend/)        MySQL
 ───────────────────────────────  ───────────────────────►  ───────────────────────  ───────────────────►  students, exams,
  js/api.js  → API.submitExam()    { action, ...data, token }  app.py  (router)         parameterised queries   questions, results,
                                  ◄───────────────────────  auth / exams / admin / ...                       exam_attempts, ...
                                   { success, message, code, data }
```

A page calls a method of the `API` object in `js/api.js`, for example `API.submitExam(examId, answers)`. That sends `{ "action": "submitExam", ... }` to `/api`, which checks the session token, runs the matching Python function and returns JSON. The method names, request fields and the reply format are identical to the earlier Google Apps Script version, which is why the frontend needed almost no changes.

**Key design decisions** (useful for the project defence)

- **Marking happens on the server.** Correct answers are never sent to the browser.
- **The server remembers when the exam started** (`exam_attempts.started_at`). Refreshing cannot reset the timer.
- **One attempt per student per examination**, enforced twice: in the code, and by a `UNIQUE (student_id, exam_id)` rule in the database, so a double click cannot create two results (tested with six simultaneous submissions).
- **Submission is one database transaction**: check, mark, store the result and close the attempt together.
- **Session tokens.** After login the server returns a random token (only its SHA-256 hash is stored). The browser keeps it in `sessionStorage` and sends it with every request; the student ID is read from the token on the server, never trusted from the browser.
- **Passwords are hashed with bcrypt.** Newly registered students receive their matriculation number as their initial password and can change it after login. Existing accounts retain their existing password through the v2 migration.
- **Scheduling is enforced by the backend.** Active future/expired exams remain visible to students, but the API rejects attempts outside the configured time window. Deactivated exams are not returned to student listings.
- **Support requests are private to their student and the administrator.** Students can see their own tickets and admin responses; only admins can view the support inbox.
- **Every SQL query uses placeholders (parameterised queries)**, so user input cannot change a query (no SQL injection).
- **Only the website files are served.** `app.py` serves the pages, `css/`, `js/` and `assets/` and nothing else; the Python code, the SQL file and the tests cannot be downloaded from a browser.

## Folder structure

```
ken-etest/
├── index.html, login.html, register.html, dashboard.html,
│   instructions.html, exam.html, result.html, history.html     Student pages (unchanged)
├── admin/                                                      Admin pages (unchanged)
├── css/   js/   assets/                                        Frontend (see "What changed")
│
├── app.py                        Flask application: serves the website and the /api endpoint
├── requirements.txt              Python packages (Flask, PyMySQL, bcrypt)
├── backend/                      THE BACKEND (Python)
│   ├── config.py                 Database and application settings
│   ├── db.py                     MySQL connection, query helpers, ID generator
│   ├── helpers.py                Response format, text cleaning, dates, shuffling
│   ├── auth.py                   Registration, login, logout, sessions
│   ├── exams.py                  Examination list, start, randomisation, marking, submit
│   ├── results.py                Reading results
│   ├── proctoring.py             Monitoring events
│   └── admin.py                  All administrator actions
│
├── database/ken_etest.sql        Tables + demo data (import this)
├── tests/
│   ├── api_test.py               Automated backend test (155 checks)
│   └── ui/                       Optional: runs the real pages in jsdom (62 checks)
└── README.md
```

## Database

Created by `database/ken_etest.sql` (InnoDB, utf8mb4; written for MySQL 5.7+ / MariaDB 10.4+ and tested on MariaDB 10.11).

| Table | Purpose | Main columns |
|---|---|---|
| `admins` | Administrator accounts | `admin_id`, `username`, `password_hash`, `name` |
| `students` | Student accounts | `student_id`, `matric_number` (unique), `full_name`, `email` (unique), `password_hash`, `class`, `status`, `date_registered` |
| `exams` | Examinations | `exam_id`, `title`, `subject`, `description`, `duration_minutes`, `pass_mark` (%), `status`, `date_created` |
| `questions` | Multiple-choice questions | `question_id`, `exam_id`, `question`, `option_a`–`option_d`, `correct_answer` (A–D), `marks` |
| `results` | Marked submissions | `result_id`, `student_id`, `exam_id`, `score`, `total_marks`, `percentage`, `status` (PASS/FAIL), `start_time`, `submit_time` · **unique** (`student_id`, `exam_id`) |
| `exam_attempts` | Examinations in progress | `student_id`, `exam_id`, `started_at`, `question_order`, `option_order` (the student's random order) · deleted on submission |
| `proctoring_logs` | Monitoring events | `log_id`, `student_id`, `exam_id`, `event_type`, `event_description`, `logged_at`, `severity` |
| `sessions` | Login sessions | `token_hash`, `role`, `user_id`, `expires_at` |
| `counters` | Creates readable IDs (`STU006`, `EX004`, `Q026`, `RES010`, `LOG0009`) atomically | `name`, `value` |

`pass_mark` is a percentage; a result is `PASS` when `percentage >= pass_mark`. The number of questions is counted from `questions` (not stored), so it cannot go out of date. All dates are stored in UTC and shown in the browser's local time.

If you add rows to `students`, `exams`, `questions`, `results` or `proctoring_logs` by hand with explicit IDs, also raise the matching number in `counters`, otherwise the next record created by the website could get an ID that already exists. Creating records through the website needs no care.

## Monitoring (proctoring)

The system provides **basic browser-based examination monitoring**. It is not AI proctoring. `js/proctoring.js` uses only standard browser features:

| What it does | Browser feature |
|---|---|
| Requests fullscreen when the exam begins and detects leaving it | Fullscreen API |
| Detects switching tabs or minimising | Page Visibility API |
| Detects the window losing focus | `blur` event |
| Blocks copy, cut and paste | `copy`, `cut`, `paste` events |
| Disables the right-click menu | `contextmenu` event |
| Blocks Ctrl+C/X/V/U/S/P, F12, Ctrl+Shift+I/J/C | `keydown` event |

Every violation is a warning ("Warning 1 of 3"). After the third, the examination is submitted automatically. Warnings survive a page refresh. Every event is sent to the server and stored with the student, examination, type, time and a severity decided by the server. Administrators see them under **Results → Monitoring log**. Devices without fullscreen support (for example Safari on iPhone) skip only the fullscreen rule.

## Testing

Two automated tests are included. Both create their own temporary data and remove it afterwards.

**Backend test (Python only):** with the application running,
```bash
python tests/api_test.py http://127.0.0.1:5000/api
```
It checks authentication, validation, examination and question management, randomisation, marking, the one-attempt rule, timing, the monitoring log, admin reports, deactivation, SQL-injection attempts, blocked file downloads and six simultaneous submissions.

**Optional frontend test (needs Node.js):** runs the real pages in jsdom and clicks through registration, login, dashboard, the full exam (including the 3-warning and timer-expiry automatic submissions), result, history and every admin page.
```bash
cd tests/ui && npm install && node ui_test.js http://127.0.0.1:5000
```
(jsdom is not a real browser: it does not test how pages look. Also click through the site in a normal browser.)

Run the tests on a scratch import. Importing `database/ken_etest.sql` afterwards gives you a clean demo database.

## What changed from the Google Sheets version

| Area | Change |
|---|---|
| Backend | `backend/Code.gs` (Apps Script) replaced by the Python modules in `backend/` and `app.py`. Same action names and same reply format. |
| Database | Google Sheets replaced by MySQL tables (see above). |
| `js/config.js` | The Apps Script URL is replaced by an automatic path to `/api`. |
| `js/api.js` | Requests are sent as `application/json`; clearer messages when the server is unreachable or replies with something that is not JSON. Everything else is unchanged. |
| `index.html`, `js/auth.js`, `js/exam.js`, `js/proctoring.js` | Only a sentence / comments that mentioned Google Sheets. |
| New | Randomised questions and options; bcrypt passwords; database-level one-attempt rule; database sessions. |

All other HTML, CSS and JavaScript files are untouched.

## Limitations

- **Browser-based monitoring cannot completely prevent cheating.** It cannot see a second device, another person or notes, and a determined student can bypass browser checks. A logged event is a reason for the examiner to look closer, not proof of cheating.
- **Simple academic authentication**, not enterprise-grade: no email verification, no password reset and no limit on login attempts. Use HTTPS if the system is ever put online.
- **The timer is enforced in the browser.** The server stores the start time and gives the correct remaining time after a refresh, and it records the real time spent, but it still accepts a late submission rather than discarding the student's answers. An examiner can see the time spent in the results.
- **Answers are held in the browser (`sessionStorage`) until submission.** If a student closes the tab, the timer keeps running but chosen answers are lost.
- Only multiple-choice questions with four options and one correct answer are supported.
- Each student can take each examination once; there is no admin button to allow a retake (delete the student's row in `results` to allow one).
- `python app.py` starts Flask's built-in development server, which is meant for demonstration and a small class, not for many simultaneous users.
- Tested with Python 3.12 and MariaDB 10.11. It was not tested on Windows or with other Python versions.

## Future improvements

Question banks and random selection of N questions per student · image-based and other question types · password reset by email · admin option to allow retakes and to export results to CSV/PDF · saving answers on the server as the student works · server-side rejection of late submissions · stronger proctoring with the student's consent.

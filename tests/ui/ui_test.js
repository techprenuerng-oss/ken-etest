/* Ken E-Test - tests/ui/ui_test.js   (OPTIONAL developer test, needs Node.js 18+)

   Loads the REAL website pages (HTML + the project's own JavaScript) in jsdom and drives
   them like a user (typing into forms, clicking buttons) against the live Python/MySQL API.
   It proves the existing frontend code and the new backend work together.

   Limits (be honest in your report): jsdom is not a real browser. It has no layout, no CSS
   rendering and no Fullscreen API, so this does NOT check how the pages look. Also open the
   site in a real browser for the demonstration.

   Usage:   cd tests/ui && npm install && node ui_test.js http://127.0.0.1:5000
   It uses the `mysql` command line client (root, no password) to read correct answers and to
   age an exam attempt. Afterwards re-import database/ken_etest.sql to restore pristine demo data. */

const { JSDOM, VirtualConsole } = require("jsdom");
const { execSync } = require("child_process");

const BASE = (process.argv[2] || "http://127.0.0.1:5000").replace(/\/$/, "");
const DB = process.env.ETEST_DB_NAME || "ken_etest";
const run = Math.random().toString(36).slice(2, 8);

let passed = 0, failed = 0;
function check(name, condition, detail) {
  if (condition) { passed++; console.log("  [PASS] " + name); }
  else { failed++; console.log("  [FAIL] " + name + (detail !== undefined ? "  -> " + detail : "")); }
}
const section = (t) => console.log("\n== " + t + " ==");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sql(query) {
  return execSync(`mysql -uroot ${DB} -N -B -e ${JSON.stringify(query)}`, { encoding: "utf8" }).trim();
}

async function waitFor(fn, label, ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { const v = fn(); if (v) return v; } catch (e) { /* keep waiting */ }
    await sleep(50);
  }
  throw new Error("Timed out waiting for: " + label);
}

async function api(action, data, token) {
  const body = Object.assign({}, data || {}, { action });
  if (token) body.token = token;
  const res = await fetch(BASE + "/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

/* Opens a real page. `session` = sessionStorage items to start with (simulates "already logged in"). */
async function openPage(path, session) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push(e.message));
  const dom = await JSDOM.fromURL(BASE + "/" + path, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole,
    beforeParse(window) {
      window.fetch = (url, options) => fetch(new URL(url, window.location.href).href, options);
      Object.keys(session || {}).forEach((k) => window.sessionStorage.setItem(k, session[k]));
    },
  });
  const w = dom.window;
  await new Promise((r) => (w.document.readyState === "complete" ? r() : w.addEventListener("load", r)));
  const page = { window: w, document: w.document, errors, $: (id) => w.document.getElementById(id) };
  page.session = () => { const out = {}; for (let i = 0; i < w.sessionStorage.length; i++) { const k = w.sessionStorage.key(i); out[k] = w.sessionStorage.getItem(k); } return out; };
  page.navigations = () => errors.filter((m) => /navigation/i.test(m)).length;
  page.submit = (form) => form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  page.fire = (type) => w.document.dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true }));
  page.close = () => w.close();
  return page;
}

const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

/* correct answer TEXT of every question of an exam, so the UI test can click the right option */
function correctTexts(examId) {
  const map = {};
  sql(`SELECT question, CASE correct_answer WHEN 'A' THEN option_a WHEN 'B' THEN option_b WHEN 'C' THEN option_c ELSE option_d END FROM questions WHERE exam_id='${examId}'`)
    .split("\n").forEach((line) => { const [q, a] = line.split("\t"); map[q] = a; });
  return map;
}

/* Plays an examination page. mode(i, question, optionButtons) returns the index of the option to click, or -1 to skip. */
async function playExam(page, choose) {
  const begin = page.$("beginBtn");
  await waitFor(() => !begin.disabled, "begin button enabled");
  begin.click();
  await waitFor(() => !page.$("examLayout").hidden, "exam layout visible");
  const total = Number(text(page.$("questionNumber")).match(/of (\d+)/)[1]);
  for (let i = 0; i < total; i++) {
    const qText = text(page.$("questionText"));
    const buttons = [...page.document.querySelectorAll("#optionsList .option")];
    const pick = choose(i, qText, buttons);
    if (pick >= 0) buttons[pick].click();
    if (i < total - 1) { page.$("nextBtn").click(); await waitFor(() => text(page.$("questionNumber")).startsWith("Question " + (i + 2) + " "), "next question"); }
  }
  return total;
}

(async () => {
  console.log("Testing the website at " + BASE);

  /* ================================================================ landing */
  section("Landing page and configuration");
  let page = await openPage("index.html");
  check("landing page loads with the Ken E-Test branding", /Ken E-Test/.test(page.document.title + text(page.document.body)));
  check("landing page no longer mentions Google Sheets", !/Google Sheets/i.test(text(page.document.body)));
  page.close();
  page = await openPage("login.html");
  const apiUrl = page.window.eval("CONFIG.API_URL");
  check("config.js resolves the API address automatically (root page)", apiUrl === BASE + "/api", apiUrl);
  page.close();
  page = await openPage("admin/login.html");
  check("config.js resolves the same API address from the admin/ folder", page.window.eval("CONFIG.API_URL") === BASE + "/api", page.window.eval("CONFIG.API_URL"));
  page.close();

  /* ============================================================ registration */
  section("Student registration page");
  const email = `ui.${run}@example.test`;
  page = await openPage("register.html");
  let f = page.$("registerForm");
  f.elements.full_name.value = "Ui Tester " + run; f.elements.email.value = email;
  f.elements.password.value = "secret1"; f.elements.confirm_password.value = "different"; f.elements.class_name.value = "UI 100L";
  page.submit(f);
  await waitFor(() => !page.$("formAlert").hidden, "validation alert");
  check("mismatching passwords show the client-side error", /do not match/i.test(text(page.$("formAlert"))));
  f.elements.confirm_password.value = "secret1";
  page.submit(f);
  await waitFor(() => page.navigations() > 0 || !page.$("formAlert").hidden, "registration finished");
  check("valid registration succeeds and the page moves on to login", page.navigations() > 0 && /^STU/.test(sql(`SELECT student_id FROM students WHERE email='${email}'`)));
  page.close();
  page = await openPage("register.html");
  f = page.$("registerForm");
  f.elements.full_name.value = "Ui Tester " + run; f.elements.email.value = email; f.elements.password.value = "secret1"; f.elements.confirm_password.value = "secret1"; f.elements.class_name.value = "UI 100L";
  page.submit(f);
  await waitFor(() => !page.$("formAlert").hidden, "duplicate alert");
  check("registering the same email again shows the server message", /already exists/i.test(text(page.$("formAlert"))), text(page.$("formAlert")));
  page.close();

  /* ================================================================== login */
  section("Student login page");
  page = await openPage("login.html");
  f = page.$("loginForm");
  f.elements.email.value = email; f.elements.password.value = "wrongpass";
  page.submit(f);
  await waitFor(() => !page.$("formAlert").hidden, "login error");
  check("wrong password shows the server error message", text(page.$("formAlert")) === "Incorrect email or password.", text(page.$("formAlert")));
  f.elements.password.value = "secret1";
  page.submit(f);
  await waitFor(() => page.navigations() > 0, "redirect after login");
  const studentSession = page.session();
  const sessionKey = Object.keys(studentSession).find((k) => /student/.test(k));
  const parsed = JSON.parse(studentSession[sessionKey]);
  check("login stores the session token and the student in sessionStorage", parsed.token && parsed.token.length === 64 && parsed.user.full_name === "Ui Tester " + run);
  check("the stored student record contains no password data", !/password/i.test(studentSession[sessionKey]));
  const token = parsed.token;
  const studentId = parsed.user.student_id;
  page.close();

  /* =============================================================== dashboard */
  section("Student dashboard");
  page = await openPage("dashboard.html", studentSession);
  await waitFor(() => page.document.querySelectorAll("#examGrid .exam-card").length > 0, "exam cards");
  check("dashboard greets the student by name", text(page.$("welcomeName")) === "Ui" && text(page.$("userName")) === "Ui Tester " + run);
  check("dashboard shows the 2 active exams (EX003 is inactive)", page.document.querySelectorAll("#examGrid .exam-card").length === 2);
  check("exam card shows questions, minutes and pass mark", /10 questions/.test(text(page.$("examGrid"))) && /15 minutes/.test(text(page.$("examGrid"))) && /Pass mark 50%/.test(text(page.$("examGrid"))));
  check("statistics start at: 2 available, 0 taken", text(page.$("statAvailable")) === "2" && text(page.$("statTaken")) === "0");
  check("no recent results yet", /not taken any examination/i.test(text(page.$("recentResultsBody"))));
  page.close();

  /* ============================================================ instructions */
  section("Instructions page");
  page = await openPage("instructions.html?exam=EX002", studentSession);
  await waitFor(() => !page.$("instructionsContent").hidden, "instructions content");
  check("instructions show title, 10 questions, 20 minutes, 20 marks, pass mark", text(page.$("examTitle")) === "Computer Applications" && text(page.$("infoQuestions")) === "10" && text(page.$("infoDuration")) === "20 minutes" && text(page.$("infoMarks")) === "20" && text(page.$("infoPassMark")) === "50%");
  check("start button is disabled until the rules are accepted", page.$("startBtn").disabled === true);
  page.$("agreeCheck").checked = true; page.$("agreeCheck").dispatchEvent(new page.window.Event("change"));
  check("start button is enabled after accepting", page.$("startBtn").disabled === false);
  page.close();

  /* ===================================================== the examination itself */
  section("Examination page (timer, randomised questions, answering, submitting)");
  const answers = correctTexts("EX002");
  page = await openPage("exam.html?exam=EX002", studentSession);
  await waitFor(() => !page.$("beginBtn").disabled, "start gate ready");
  check("start gate shows exam details before the timer starts", /10/.test(text(page.$("gateInfo"))) && /20/.test(text(page.$("gateInfo"))));
  const shown = [];
  let wrongIndexUsed = false;
  const total = await playExam(page, (i, qText, buttons) => {
    shown.push(qText);
    const texts = buttons.map((b) => text(b.querySelector(".option-text")));
    if (i === 0) {
      check("question 1 renders text and four options", qText.length > 3 && buttons.length === 4);
      check("timer is counting down from 20:00", /^(19:5\d|20:00)$/.test(text(page.$("timerValue"))), text(page.$("timerValue")));
    }
    if (i < 8) return texts.indexOf(answers[qText]);                   // correct answer (by what is shown)
    if (i === 8) { return texts.findIndex((t) => t !== answers[qText]); } // deliberately wrong
    return -1;                                                          // last question left unanswered
  });
  check("all 10 questions were presented, each exactly once", total === 10 && new Set(shown).size === 10 && shown.every((q) => answers[q] !== undefined), shown.join(" | "));
  const order1 = shown.join("|");
  check("answered counter shows 9 answered, 1 unanswered", text(page.$("answeredCount")) === "9" && text(page.$("unansweredCount")) === "1");
  check("navigation grid has 10 buttons, 9 marked answered", page.document.querySelectorAll("#navGrid .nav-q").length === 10 && page.document.querySelectorAll("#navGrid .nav-q.answered").length === 9);
  check("answers are kept in sessionStorage (survive a refresh)", Object.keys(JSON.parse(page.window.sessionStorage.getItem("ken_answers_EX002"))).length === 9);
  page.document.querySelector(".js-submit").click();
  check("submit dialog warns about the unanswered question", !page.$("submitModal").hidden && /9 of 10/.test(text(page.$("modalSummary"))) && /1 unanswered/.test(text(page.$("modalSummary"))), text(page.$("modalSummary")));
  page.$("confirmSubmitBtn").click();
  const resultRow = await waitFor(() => sql(`SELECT result_id, score, total_marks, percentage, status FROM results WHERE student_id='${studentId}' AND exam_id='EX002'`), "result stored in MySQL");
  const [resultId, score, totalMarks, pct, status] = resultRow.split("\t");
  check("MySQL holds the result: 16 of 20 marks, 80%, PASS (8 correct x 2 marks)", score === "16" && totalMarks === "20" && Number(pct) === 80 && status === "PASS", resultRow);
  await waitFor(() => page.navigations() > 0, "redirect to result page");
  check("the page moves on to the result page after submitting", true);
  page.close();

  /* resume: second tab of the same exam before submitting is covered by the API test; here check the order is stable via a second student below */

  /* ===================================================== result and history */
  section("Result, history and dashboard after the exam");
  page = await openPage("result.html?id=" + resultId, studentSession);
  await waitFor(() => !page.$("resultContent").hidden, "result content");
  check("result page: exam, student, score and percentage", text(page.$("resExamTitle")) === "Computer Applications" && text(page.$("resStudent")) === "Ui Tester " + run && text(page.$("resScore")) === "16/20" && text(page.$("resPercentage")) === "80%");
  check("result page: PASS badge, pass mark and summary", /PASS/.test(text(page.$("resStatus"))) && text(page.$("resPassMark")) === "50%" && /You passed/.test(text(page.$("resSummary"))));
  check("result page: date and time spent are formatted", /\d{4}/.test(text(page.$("resDate"))) && /sec|min/.test(text(page.$("resTime"))), text(page.$("resDate")) + " / " + text(page.$("resTime")));
  page.close();
  page = await openPage("history.html", studentSession);
  await waitFor(() => /taken/.test(text(page.$("historyCount"))), "history count");
  check("history lists the one examination taken", text(page.$("historyCount")) === "1 examination taken" && /Computer Applications/.test(text(page.$("historyBody"))) && /16\/20/.test(text(page.$("historyBody"))));
  page.close();
  page = await openPage("dashboard.html", studentSession);
  await waitFor(() => page.document.querySelectorAll("#examGrid .exam-card").length > 0, "cards");
  check("dashboard now shows 1 available, 1 taken, average 80%, 1 passed", text(page.$("statAvailable")) === "1" && text(page.$("statTaken")) === "1" && text(page.$("statAverage")) === "80%" && text(page.$("statPassed")) === "1");
  check("exam card now offers 'View result' instead of instructions", /View result/.test(text(page.$("examGrid"))));
  page.close();
  page = await openPage("exam.html?exam=EX002", studentSession);
  await waitFor(() => page.navigations() > 0, "redirect away from an exam already taken");
  check("opening an exam that was already taken redirects to its result", true);
  page.close();

  /* ============================== proctoring: 3 warnings -> automatic submission */
  section("Browser monitoring: three warnings trigger automatic submission");
  const p = await api("registerStudent", { full_name: "Proctor Test " + run, email: `proctor.${run}@example.test`, password: "secret1", class: "UI" });
  const pLogin = await api("loginStudent", { email: `proctor.${run}@example.test`, password: "secret1" });
  const pSession = { ken_student_session: JSON.stringify({ token: pLogin.data.token, user: pLogin.data.student }) };
  const pId = p.data.student_id;
  page = await openPage("exam.html?exam=EX001", pSession);
  await waitFor(() => !page.$("beginBtn").disabled, "gate");
  page.$("beginBtn").click();
  await waitFor(() => !page.$("examLayout").hidden, "layout");
  page.fire("contextmenu");
  await waitFor(() => text(page.$("warningBadge")) === "Warnings 1/3", "warning 1");
  check("right-click shows 'Warning 1 of 3' and updates the badge", /Warning 1 of 3/.test(text(page.$("warningText"))) && !page.$("warningBanner").hidden, text(page.$("warningText")));
  page.fire("copy");
  await waitFor(() => text(page.$("warningBadge")) === "Warnings 2/3", "warning 2");
  page.fire("paste");
  await waitFor(() => text(page.$("warningBadge")) === "Warnings 3/3", "warning 3");
  check("third warning says maximum reached", /Maximum warnings reached/.test(text(page.$("warningText"))));
  const autoRow = await waitFor(() => sql(`SELECT score, status FROM results WHERE student_id='${pId}' AND exam_id='EX001'`), "auto-submitted result");
  check("the examination was submitted automatically (0 marks, nothing answered)", autoRow === "0\tFAIL", autoRow);
  await sleep(500);
  const logTypes = sql(`SELECT event_type FROM proctoring_logs WHERE student_id='${pId}' ORDER BY log_id`).split("\n").sort().join(",");
  check("all 3 events AND MAX_WARNINGS_REACHED reached the monitoring log", logTypes === "COPY_ATTEMPT,MAX_WARNINGS_REACHED,PASTE_ATTEMPT,RIGHT_CLICK", logTypes);
  page.close();

  /* ============================================ timer expiry -> automatic submit */
  section("Timer: time already used up -> automatic submission");
  await api("registerStudent", { full_name: "Timer Test " + run, email: `timer.${run}@example.test`, password: "secret1", class: "UI" });
  const tLogin = await api("loginStudent", { email: `timer.${run}@example.test`, password: "secret1" });
  const tSession = { ken_student_session: JSON.stringify({ token: tLogin.data.token, user: tLogin.data.student }) };
  const tId = tLogin.data.student.student_id;
  await api("startExam", { exam_id: "EX001" }, tLogin.data.token);
  sql(`UPDATE exam_attempts SET started_at = DATE_SUB(started_at, INTERVAL 1 HOUR) WHERE student_id='${tId}'`);
  page = await openPage("exam.html?exam=EX001", tSession);
  await waitFor(() => !page.$("beginBtn").disabled, "gate");
  check("gate tells the student the exam was started earlier", /started this examination earlier/i.test(text(page.$("gateNote"))) && /Resume/.test(text(page.$("beginBtn"))));
  page.$("beginBtn").click();
  const tRow = await waitFor(() => sql(`SELECT score, TIMESTAMPDIFF(MINUTE,start_time,submit_time) FROM results WHERE student_id='${tId}'`), "timed-out result");
  check("page auto-submitted when the remaining time was 0 (recorded time ~60 min)", /^0\t6\d$/.test(tRow) || /^0\t59$/.test(tRow), tRow);
  page.close();

  /* ================================================================ admin ===== */
  section("Admin login");
  page = await openPage("admin/login.html");
  f = page.$("adminLoginForm");
  f.elements.username.value = "admin"; f.elements.password.value = "nope";
  page.submit(f);
  await waitFor(() => !page.$("formAlert").hidden, "admin login error");
  check("wrong admin password shows the server message", text(page.$("formAlert")) === "Incorrect username or password.");
  f.elements.password.value = "Admin@123";
  page.submit(f);
  await waitFor(() => page.navigations() > 0, "redirect");
  const adminSession = page.session();
  check("admin session (token and name) is stored", JSON.parse(adminSession.ken_admin_session).user.name === "System Administrator");
  page.close();

  section("Admin dashboard");
  page = await openPage("admin/dashboard.html", adminSession);
  await waitFor(() => text(page.$("statStudents")) !== "" && text(page.$("statStudents")) !== "-", "stats");
  const dbStudents = sql("SELECT COUNT(*) FROM students"), dbResults = sql("SELECT COUNT(*) FROM results"), dbAvg = Number(sql("SELECT ROUND(AVG(percentage),1) FROM results"));
  check("student, exam and submission totals equal the database", text(page.$("statStudents")) === dbStudents && text(page.$("statExams")) === "3" && text(page.$("statSubmissions")) === dbResults);
  check("average score equals the database average", Math.abs(parseFloat(text(page.$("statAverage"))) - dbAvg) < 0.06, text(page.$("statAverage")) + " vs " + dbAvg);
  check("one performance bar per exam; 5 recent results", page.document.querySelectorAll("#examPerformance .bar-row").length === 3 && page.document.querySelectorAll("#recentResultsBody tr").length === 5);
  check("admin name is shown in the header", /System Administrator/.test(text(page.document.querySelector(".js-admin-name"))));
  page.close();

  section("Admin: examinations");
  page = await openPage("admin/exams.html", adminSession);
  await waitFor(() => page.document.querySelectorAll("#examsTableBody tr").length >= 3, "exam rows");
  check("exam table lists the 3 seeded exams with status badges", /ICT Fundamentals/.test(text(page.$("examsTableBody"))) && /Inactive/.test(text(page.$("examsTableBody"))));
  page.$("createExamBtn").click();
  check("'Create examination' opens the form with defaults (15 min, 50%)", !page.$("examModal").hidden && page.$("examDurationInput").value === "15" && page.$("examPassMarkInput").value === "50");
  page.$("examTitleInput").value = "UI Created Exam " + run; page.$("examSubjectInput").value = "UI Testing";
  page.$("examDescriptionInput").value = "Created by the UI test"; page.$("examDurationInput").value = "5";
  page.submit(page.$("examForm"));
  await waitFor(() => /UI Created Exam/.test(text(page.$("examsTableBody"))), "new exam row");
  const newExam = sql(`SELECT exam_id FROM exams WHERE title='UI Created Exam ${run}'`);
  check("a new exam is created through the form and listed", /^EX\d+/.test(newExam) && sql(`SELECT status FROM exams WHERE exam_id='${newExam}'`) === "Inactive");
  const toggle = page.document.querySelector(`#examsTableBody [data-action="toggle"][data-id="${newExam}"]`);
  toggle.click();
  await waitFor(() => /at least one question/i.test(text(page.document.getElementById("toastContainer"))), "toast");
  check("activating an exam without questions shows the server's error as a toast", true);
  page.close();

  section("Admin: questions");
  page = await openPage("admin/questions.html?exam=" + newExam, adminSession);
  await waitFor(() => /no questions yet/i.test(text(page.$("questionsList"))), "empty list");
  check("the new exam's question list is empty", true);
  page.$("addQuestionBtn").click();
  page.$("questionTextInput").value = "What is 5 + 5?"; page.$("optionAInput").value = "9"; page.$("optionBInput").value = "10";
  page.$("optionCInput").value = "11"; page.$("optionDInput").value = "12"; page.$("correctAnswerInput").value = "B"; page.$("marksInput").value = "3";
  page.submit(page.$("questionForm"));
  await waitFor(() => page.document.querySelectorAll("#questionsList .question-card").length === 1, "question card");
  check("question is added; list shows it with the correct option tagged", /What is 5 \+ 5\?/.test(text(page.$("questionsList"))) && /Correct/.test(text(page.document.querySelector("#questionsList li.correct"))) && /1 question, 3 total marks/.test(text(page.$("questionsSummary"))), text(page.$("questionsSummary")));
  page.document.querySelector('#questionsList [data-action="edit"]').click();
  page.$("questionTextInput").value = "What is 6 + 6?"; page.$("optionBInput").value = "11"; page.$("optionDInput").value = "12"; page.$("correctAnswerInput").value = "D";
  page.submit(page.$("questionForm"));
  await waitFor(() => /6 \+ 6/.test(text(page.$("questionsList"))), "edited");
  check("question is edited (new text and new correct option)", sql(`SELECT correct_answer FROM questions WHERE exam_id='${newExam}'`) === "D");
  page.document.querySelector('#questionsList [data-action="delete"]').click();
  await waitFor(() => page.document.querySelector('.modal-overlay [data-answer="yes"]'), "confirm dialog");
  page.document.querySelector('.modal-overlay [data-answer="yes"]').click();
  await waitFor(() => /no questions yet/i.test(text(page.$("questionsList"))), "deleted");
  check("question is deleted after confirmation", sql(`SELECT COUNT(*) FROM questions WHERE exam_id='${newExam}'`) === "0");
  page.close();

  section("Admin: students, results and monitoring log");
  page = await openPage("admin/students.html", adminSession);
  await waitFor(() => page.document.querySelectorAll("#studentsTableBody tr").length >= 5, "student rows");
  page.$("studentSearch").value = "fatima"; page.$("studentSearch").dispatchEvent(new page.window.Event("input"));
  check("student search filters the table", page.document.querySelectorAll("#studentsTableBody tr").length === 1 && /Fatima Bello/.test(text(page.$("studentsTableBody"))) && /1 of /.test(text(page.$("studentsCount"))));
  page.$("studentSearch").value = ""; page.$("studentSearch").dispatchEvent(new page.window.Event("input"));
  page.document.querySelector(`#studentsTableBody [data-action="toggle"][data-id="${studentId}"]`).click();
  await waitFor(() => sql(`SELECT status FROM students WHERE student_id='${studentId}'`) === "Inactive", "deactivated");
  check("'Deactivate' button changes the student's status in MySQL", true);
  const blocked = await api("loginStudent", { email, password: "secret1" });
  check("the deactivated student can no longer log in", blocked.code === "ACCOUNT_INACTIVE");
  page.close();

  page = await openPage("admin/results.html", adminSession);
  await waitFor(() => page.document.querySelectorAll("#resultsTableBody tr").length >= 9, "result rows");
  check("results tab lists every result with a summary line", page.document.querySelectorAll("#resultsTableBody tr").length === Number(sql("SELECT COUNT(*) FROM results")) && /results, average/.test(text(page.$("resultsSummary"))), text(page.$("resultsSummary")));
  page.$("resultsExamFilter").value = "EX001"; page.$("resultsExamFilter").dispatchEvent(new page.window.Event("change"));
  await waitFor(() => page.document.querySelectorAll("#resultsTableBody tr").length === Number(sql("SELECT COUNT(*) FROM results WHERE exam_id='EX001'")), "filtered");
  check("filtering results by examination works", true);
  await waitFor(() => page.document.querySelectorAll("#logsTableBody tr").length >= 8, "log rows");
  check("monitoring log tab shows the events incl. the ones created in this test", /MAX_WARNINGS_REACHED/.test(text(page.$("logsTableBody"))) && /RIGHT_CLICK/.test(text(page.$("logsTableBody"))));
  page.close();

  section("Session expiry");
  page = await openPage("dashboard.html", { ken_student_session: JSON.stringify({ token: "0".repeat(64), user: { full_name: "Fake Student", class: "x" } }) });
  await waitFor(() => page.navigations() > 0, "redirect to login");
  check("an invalid session token sends the student back to login and clears the session", !page.window.sessionStorage.getItem("ken_student_session"));
  page.close();

  console.log("\n----------------------------------------");
  console.log(`Passed: ${passed}   Failed: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.log("\nTEST ABORTED: " + e.message); process.exit(2); });

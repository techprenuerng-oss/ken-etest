/* Ken E-Test - admin.js
   Logic for all admin pages. Each page has data-page="admin-..." on the <body>
   and the matching init function below runs. */

document.addEventListener("DOMContentLoaded", function () {
  const page = document.body.dataset.page;
  if (!page || page.indexOf("admin-") !== 0 || page === "admin-login") return;

  const admin = Auth.requireLogin("admin");
  if (!admin) return;
  document.querySelectorAll(".js-admin-name").forEach(function (element) {
    element.textContent = admin.name;
  });

  if (page === "admin-dashboard") initAdminDashboard();
  if (page === "admin-exams") initAdminExams();
  if (page === "admin-questions") initAdminQuestions();
  if (page === "admin-students") initAdminStudents();
  if (page === "admin-support") initAdminSupport();
  if (page === "admin-results") initAdminResults();
});

/* ---------- Shared helpers ---------- */

function emptyRow(columns, text) {
  return '<tr><td colspan="' + columns + '" class="empty-cell">' + escapeHtml(text) + "</td></tr>";
}

function openModal(id) {
  const modal = document.getElementById(id);
  modal.hidden = false;
  const field = modal.querySelector("input:not([type=hidden]), select, textarea");
  if (field) field.focus();
}

function closeModal(id) {
  document.getElementById(id).hidden = true;
}

/* Closes a modal with the Cancel button, a click on the dark background, or the Escape key. */
function wireModalClose(modalId, cancelButtonId) {
  const modal = document.getElementById(modalId);
  document.getElementById(cancelButtonId).addEventListener("click", function () { closeModal(modalId); });
  modal.addEventListener("click", function (event) {
    if (event.target === modal) closeModal(modalId);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !modal.hidden) closeModal(modalId);
  });
}

function toLocalDateTimeInput(iso) {
  const date = new Date(iso); if (isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fillExamSelect(select, exams, includeAll) {
  const options = exams.map(function (exam) {
    return '<option value="' + escapeHtml(exam.exam_id) + '">' + escapeHtml(exam.exam_id + " - " + exam.title) + "</option>";
  });
  select.innerHTML = (includeAll ? '<option value="">All examinations</option>' : "") + options.join("");
}

/* ---------- Dashboard ---------- */

async function initAdminDashboard() {
  const alertBox = document.getElementById("pageAlert");
  const response = await API.adminGetStats();
  if (!response.success) return showAlert(alertBox, response.message);
  const stats = response.data;

  document.getElementById("statStudents").textContent = stats.total_students;
  document.getElementById("statExams").textContent = stats.total_exams;
  document.getElementById("statSubmissions").textContent = stats.total_submissions;
  document.getElementById("statAverage").textContent = stats.total_submissions ? formatPercent(stats.average_score) : "-";
  document.getElementById("statPassRate").textContent = stats.total_submissions ? stats.pass_rate + "%" : "-";
  document.getElementById("statEvents").textContent = stats.total_events;

  const performance = document.getElementById("examPerformance");
  performance.innerHTML = stats.exam_stats.length === 0
    ? '<p class="muted">No examinations yet.</p>'
    : stats.exam_stats.map(function (exam) {
        return '<div class="bar-row"><div class="bar-label"><strong>' + escapeHtml(exam.title) + "</strong>" +
          "<span>" + (exam.submissions ? formatPercent(exam.average) + " average, " + exam.submissions + " submissions, " + exam.pass_rate + "% passed" : "No submissions yet") + "</span></div>" +
          '<div class="bar-track"><div class="bar-fill" style="width:' + Math.min(100, exam.average) + '%"></div></div></div>';
      }).join("");

  const body = document.getElementById("recentResultsBody");
  body.innerHTML = stats.recent_results.length === 0
    ? emptyRow(5, "No submissions yet.")
    : stats.recent_results.map(function (result) {
        return "<tr><td>" + escapeHtml(result.student_name) + "</td><td>" + escapeHtml(result.exam_title) + "</td>" +
          "<td>" + escapeHtml(result.score) + "/" + escapeHtml(result.total_marks) + " (" + formatPercent(result.percentage) + ")</td>" +
          "<td>" + resultBadge(result.status) + "</td><td>" + escapeHtml(formatDate(result.submit_time)) + "</td></tr>";
      }).join("");
}

/* ---------- Examinations ---------- */

let adminExams = [];

async function initAdminExams() {
  wireModalClose("examModal", "cancelExamBtn");
  document.getElementById("createExamBtn").addEventListener("click", function () { openExamForm(null); });
  document.getElementById("examForm").addEventListener("submit", saveExam);

  document.getElementById("examsTableBody").addEventListener("click", async function (event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const examId = button.getAttribute("data-id");
    if (button.getAttribute("data-action") === "edit") {
      openExamForm(adminExams.find(function (exam) { return exam.exam_id === examId; }));
    }
    if (button.getAttribute("data-action") === "toggle") {
      const newStatus = button.getAttribute("data-status");
      const result = await API.adminSetExamStatus(examId, newStatus);
      showToast(result.message, result.success ? "success" : "error");
      if (result.success) loadExams();
    }
  });

  loadExams();
}

async function loadExams() {
  const body = document.getElementById("examsTableBody");
  const response = await API.adminGetExams();
  if (!response.success) return showAlert(document.getElementById("pageAlert"), response.message);

  adminExams = response.data;
  body.innerHTML = adminExams.length === 0 ? emptyRow(9, "No examinations yet. Create the first one.") :
    adminExams.map(function (exam) {
      const isActive = String(exam.status).toLowerCase() === "active";
      return "<tr><td>" + escapeHtml(exam.exam_id) + "</td>" +
        "<td><strong>" + escapeHtml(exam.title) + '</strong><br><span class="muted">' + escapeHtml(exam.subject) + "</span></td>" +
        "<td>" + escapeHtml(exam.duration_minutes) + " min</td>" +
        '<td><a href="questions.html?exam=' + encodeURIComponent(exam.exam_id) + '">' + escapeHtml(exam.total_questions) + " questions</a></td>" +
        "<td>" + escapeHtml(exam.pass_mark) + "%</td>" +
        "<td>" + (exam.scheduled_start ? escapeHtml(formatDateTime(exam.scheduled_start)) + (exam.scheduled_end ? " – " + escapeHtml(formatDateTime(exam.scheduled_end)) : "") : "Not scheduled") + "</td>" +
        "<td>" + escapeHtml(exam.submissions) + "</td>" +
        "<td>" + statusBadge(exam.status) + "</td>" +
        '<td class="actions"><button type="button" class="btn btn-secondary btn-sm" data-action="edit" data-id="' + escapeHtml(exam.exam_id) + '">Edit</button> ' +
        '<button type="button" class="btn btn-secondary btn-sm" data-action="toggle" data-id="' + escapeHtml(exam.exam_id) + '" data-status="' + (isActive ? "Inactive" : "Active") + '">' +
        (isActive ? "Deactivate" : "Activate") + "</button></td></tr>";
    }).join("");
}

function openExamForm(exam) {
  const form = document.getElementById("examForm");
  hideAlert(document.getElementById("examFormAlert"));
  form.reset();
  document.getElementById("examModalTitle").textContent = exam ? "Edit examination" : "Create examination";
  document.getElementById("examIdInput").value = exam ? exam.exam_id : "";
  if (exam) {
    document.getElementById("examTitleInput").value = exam.title;
    document.getElementById("examSubjectInput").value = exam.subject;
    document.getElementById("examDescriptionInput").value = exam.description;
    document.getElementById("examDurationInput").value = exam.duration_minutes;
    document.getElementById("examPassMarkInput").value = exam.pass_mark;
    document.getElementById("examStatusInput").value = exam.status;
    document.getElementById("examStartInput").value = exam.scheduled_start ? toLocalDateTimeInput(exam.scheduled_start) : "";
    document.getElementById("examEndInput").value = exam.scheduled_end ? toLocalDateTimeInput(exam.scheduled_end) : "";
  } else {
    document.getElementById("examDurationInput").value = 15;
    document.getElementById("examPassMarkInput").value = 50;
    document.getElementById("examStatusInput").value = "Inactive";
    document.getElementById("examStartInput").value = "";
    document.getElementById("examEndInput").value = "";
  }
  openModal("examModal");
}

async function saveExam(event) {
  event.preventDefault();
  const alertBox = document.getElementById("examFormAlert");
  const button = document.getElementById("saveExamBtn");
  hideAlert(alertBox);

  const exam = {
    exam_id: document.getElementById("examIdInput").value,
    title: document.getElementById("examTitleInput").value.trim(),
    subject: document.getElementById("examSubjectInput").value.trim(),
    description: document.getElementById("examDescriptionInput").value.trim(),
    duration_minutes: Number(document.getElementById("examDurationInput").value),
    pass_mark: Number(document.getElementById("examPassMarkInput").value),
    status: document.getElementById("examStatusInput").value,
    scheduled_start: document.getElementById("examStartInput").value ? new Date(document.getElementById("examStartInput").value).toISOString() : "",
    scheduled_end: document.getElementById("examEndInput").value ? new Date(document.getElementById("examEndInput").value).toISOString() : ""
  };

  if (exam.title.length < 3) return showAlert(alertBox, "Enter an examination title (at least 3 characters).");
  if (!exam.subject) return showAlert(alertBox, "Enter the subject.");
  if (!Number.isInteger(exam.duration_minutes) || exam.duration_minutes < 1 || exam.duration_minutes > 300) {
    return showAlert(alertBox, "Duration must be a whole number of minutes from 1 to 300.");
  }
  if (isNaN(exam.pass_mark) || exam.pass_mark < 0 || exam.pass_mark > 100) {
    return showAlert(alertBox, "Pass mark must be a percentage from 0 to 100.");
  }

  setButtonLoading(button, true, "Saving...");
  const result = exam.exam_id ? await API.adminUpdateExam(exam) : await API.adminCreateExam(exam);
  setButtonLoading(button, false);

  if (!result.success) return showAlert(alertBox, result.message);
  closeModal("examModal");
  showToast(result.message, "success");
  loadExams();
}

/* ---------- Questions ---------- */

let adminQuestions = [];
let questionExams = [];

async function initAdminQuestions() {
  const alertBox = document.getElementById("pageAlert");
  const filter = document.getElementById("examFilter");

  wireModalClose("questionModal", "cancelQuestionBtn");
  document.getElementById("addQuestionBtn").addEventListener("click", function () { openQuestionForm(null); });
  document.getElementById("questionForm").addEventListener("submit", saveQuestion);
  filter.addEventListener("change", loadQuestions);

  document.getElementById("questionsList").addEventListener("click", async function (event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const questionId = button.getAttribute("data-id");
    if (button.getAttribute("data-action") === "edit") {
      openQuestionForm(adminQuestions.find(function (question) { return question.question_id === questionId; }));
    }
    if (button.getAttribute("data-action") === "delete") {
      const confirmed = await confirmDialog({
        title: "Delete question " + questionId + "?",
        message: "This cannot be undone. Results that were already stored keep their scores.",
        confirmText: "Delete question",
        danger: true
      });
      if (!confirmed) return;
      const result = await API.adminDeleteQuestion(questionId);
      showToast(result.message, result.success ? "success" : "error");
      if (result.success) loadQuestions();
    }
  });

  const response = await API.adminGetExams();
  if (!response.success) return showAlert(alertBox, response.message);
  questionExams = response.data;
  if (questionExams.length === 0) {
    document.getElementById("questionsList").innerHTML = '<div class="empty-state">Create an examination first, then add questions to it.</div>';
    document.getElementById("addQuestionBtn").disabled = true;
    return;
  }

  fillExamSelect(filter, questionExams, false);
  const requested = getQueryParam("exam");
  if (requested && questionExams.some(function (exam) { return exam.exam_id === requested; })) {
    filter.value = requested;
  }
  loadQuestions();
}

async function loadQuestions() {
  const examId = document.getElementById("examFilter").value;
  const list = document.getElementById("questionsList");
  const response = await API.adminGetQuestions(examId);
  if (!response.success) return showAlert(document.getElementById("pageAlert"), response.message);

  adminQuestions = response.data;
  const totalMarks = adminQuestions.reduce(function (sum, question) { return sum + question.marks; }, 0);
  document.getElementById("questionsSummary").textContent =
    adminQuestions.length + (adminQuestions.length === 1 ? " question" : " questions") + ", " + totalMarks + " total marks";

  if (adminQuestions.length === 0) {
    list.innerHTML = '<div class="empty-state">This examination has no questions yet. Use "Add question" to create the first one.</div>';
    return;
  }

  list.innerHTML = adminQuestions.map(function (question, index) {
    const options = ["A", "B", "C", "D"].map(function (letter) {
      const isCorrect = question.correct_answer === letter;
      return '<li class="' + (isCorrect ? "correct" : "") + '"><span class="bubble">' + letter + "</span>" +
        escapeHtml(question["option_" + letter.toLowerCase()]) + (isCorrect ? ' <span class="correct-tag">Correct</span>' : "") + "</li>";
    }).join("");
    return '<article class="question-card"><header><span class="q-index">Question ' + (index + 1) +
      ' <span class="muted">(' + escapeHtml(question.question_id) + ", " + escapeHtml(question.marks) + (question.marks === 1 ? " mark" : " marks") + ")</span></span>" +
      '<span class="actions"><button type="button" class="btn btn-secondary btn-sm" data-action="edit" data-id="' + escapeHtml(question.question_id) + '">Edit</button> ' +
      '<button type="button" class="btn btn-danger btn-sm" data-action="delete" data-id="' + escapeHtml(question.question_id) + '">Delete</button></span></header>' +
      "<p>" + escapeHtml(question.question) + "</p><ul class=\"q-options\">" + options + "</ul></article>";
  }).join("");
}

function openQuestionForm(question) {
  const form = document.getElementById("questionForm");
  hideAlert(document.getElementById("questionFormAlert"));
  form.reset();
  fillExamSelect(document.getElementById("questionExamInput"), questionExams, false);

  document.getElementById("questionModalTitle").textContent = question ? "Edit question" : "Add question";
  document.getElementById("questionIdInput").value = question ? question.question_id : "";
  document.getElementById("questionExamInput").value = question ? question.exam_id : document.getElementById("examFilter").value;

  if (question) {
    document.getElementById("questionTextInput").value = question.question;
    document.getElementById("optionAInput").value = question.option_a;
    document.getElementById("optionBInput").value = question.option_b;
    document.getElementById("optionCInput").value = question.option_c;
    document.getElementById("optionDInput").value = question.option_d;
    document.getElementById("correctAnswerInput").value = question.correct_answer;
    document.getElementById("marksInput").value = question.marks;
  } else {
    document.getElementById("marksInput").value = 2;
  }
  openModal("questionModal");
}

async function saveQuestion(event) {
  event.preventDefault();
  const alertBox = document.getElementById("questionFormAlert");
  const button = document.getElementById("saveQuestionBtn");
  hideAlert(alertBox);

  const question = {
    question_id: document.getElementById("questionIdInput").value,
    exam_id: document.getElementById("questionExamInput").value,
    question: document.getElementById("questionTextInput").value.trim(),
    option_a: document.getElementById("optionAInput").value.trim(),
    option_b: document.getElementById("optionBInput").value.trim(),
    option_c: document.getElementById("optionCInput").value.trim(),
    option_d: document.getElementById("optionDInput").value.trim(),
    correct_answer: document.getElementById("correctAnswerInput").value,
    marks: Number(document.getElementById("marksInput").value)
  };

  if (question.question.length < 5) return showAlert(alertBox, "Enter the question text (at least 5 characters).");
  if (!question.option_a || !question.option_b || !question.option_c || !question.option_d) {
    return showAlert(alertBox, "All four options are required.");
  }
  if (!question.correct_answer) return showAlert(alertBox, "Choose the correct answer.");
  if (!Number.isInteger(question.marks) || question.marks < 1 || question.marks > 100) {
    return showAlert(alertBox, "Marks must be a whole number from 1 to 100.");
  }

  setButtonLoading(button, true, "Saving...");
  const result = question.question_id ? await API.adminUpdateQuestion(question) : await API.adminAddQuestion(question);
  setButtonLoading(button, false);

  if (!result.success) return showAlert(alertBox, result.message);
  closeModal("questionModal");
  showToast(result.message, "success");
  document.getElementById("examFilter").value = question.exam_id;
  loadQuestions();
}

/* ---------- Students ---------- */

let adminStudents = [];

async function initAdminStudents() {
  wireModalClose("studentModal", "cancelStudentBtn");
  wireModalClose("matricModal", "cancelMatricBtn");
  document.getElementById("matricForm").addEventListener("submit", saveStudentMatric);
  document.getElementById("createStudentBtn").addEventListener("click", function () {
    document.getElementById("studentForm").reset(); hideAlert(document.getElementById("studentFormAlert")); openModal("studentModal");
  });
  document.getElementById("studentForm").addEventListener("submit", saveAdminStudent);
  const response = await API.adminGetStudents();
  if (!response.success) return showAlert(document.getElementById("pageAlert"), response.message);
  adminStudents = response.data;
  renderStudents();

  document.getElementById("studentSearch").addEventListener("input", renderStudents);
  document.getElementById("studentsTableBody").addEventListener("click", async function (event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    if (button.getAttribute("data-action") === "edit-matric") {
      document.getElementById("editStudentId").value = button.getAttribute("data-id");
      document.getElementById("editStudentMatric").value = button.getAttribute("data-matric");
      hideAlert(document.getElementById("matricFormAlert")); openModal("matricModal"); return;
    }
    if (button.getAttribute("data-action") !== "toggle") return;
    const result = await API.adminSetStudentStatus(button.getAttribute("data-id"), button.getAttribute("data-status"));
    showToast(result.message, result.success ? "success" : "error");
    if (result.success) {
      const refreshed = await API.adminGetStudents();
      if (refreshed.success) {
        adminStudents = refreshed.data;
        renderStudents();
      }
    }
  });
}

async function saveAdminStudent(event) {
  event.preventDefault();
  const data = { full_name: document.getElementById("newStudentName").value.trim(),
    matric_number: document.getElementById("newStudentMatric").value.trim(),
    class: document.getElementById("newStudentClass").value.trim(), email: document.getElementById("newStudentEmail").value.trim() };
  const button = document.getElementById("saveStudentBtn"); setButtonLoading(button, true, "Registering...");
  const result = await API.adminCreateStudent(data); setButtonLoading(button, false);
  if (!result.success) return showAlert(document.getElementById("studentFormAlert"), result.message);
  closeModal("studentModal"); showToast(result.message + " Matric: " + result.data.matric_number + " | Initial password: matric number.", "success");
  const refreshed = await API.adminGetStudents(); if (refreshed.success) { adminStudents = refreshed.data; renderStudents(); }
}

async function saveStudentMatric(event) {
  event.preventDefault(); const button = document.getElementById("saveMatricBtn");
  setButtonLoading(button, true, "Saving...");
  const result = await API.adminUpdateStudentMatric(document.getElementById("editStudentId").value, document.getElementById("editStudentMatric").value.trim());
  setButtonLoading(button, false);
  if (!result.success) return showAlert(document.getElementById("matricFormAlert"), result.message);
  closeModal("matricModal"); showToast(result.message, "success");
  const refreshed = await API.adminGetStudents(); if (refreshed.success) { adminStudents = refreshed.data; renderStudents(); }
}

function renderStudents() {
  const term = document.getElementById("studentSearch").value.trim().toLowerCase();
  const rows = adminStudents.filter(function (student) {
    return !term || (student.student_id + " " + student.matric_number + " " + student.full_name + " " + student.email + " " + student["class"]).toLowerCase().indexOf(term) !== -1;
  });
  document.getElementById("studentsCount").textContent = rows.length + " of " + adminStudents.length + " students";

  document.getElementById("studentsTableBody").innerHTML = rows.length === 0 ? emptyRow(8, "No students found.") :
    rows.map(function (student) {
      const isActive = String(student.status).toLowerCase() === "active";
      return "<tr><td>" + escapeHtml(student.matric_number || student.student_id) + "</td><td><strong>" + escapeHtml(student.full_name) + "</strong><br><span class=\"muted\">" + escapeHtml(student.student_id) + "</span></td>" +
        "<td>" + escapeHtml(student.email) + "</td><td>" + escapeHtml(student["class"]) + "</td>" +
        "<td>" + escapeHtml(student.exams_taken) + "</td><td>" + escapeHtml(formatDate(student.date_registered)) + "</td>" +
        "<td>" + statusBadge(student.status) + "</td>" +
        '<td class="actions"><button type="button" class="btn btn-secondary btn-sm" data-action="edit-matric" data-id="' + escapeHtml(student.student_id) + '" data-matric="' + escapeHtml(student.matric_number || "") + '">Edit matric</button> ' +
        '<button type="button" class="btn btn-secondary btn-sm" data-action="toggle" data-id="' + escapeHtml(student.student_id) +
        '" data-status="' + (isActive ? "Inactive" : "Active") + '">' + (isActive ? "Deactivate" : "Activate") + "</button></td></tr>";
    }).join("");
}

/* ---------- Student support ---------- */
let adminSupportTickets = [];
async function initAdminSupport() {
  wireModalClose("ticketModal", "cancelTicketBtn");
  document.getElementById("supportStatusFilter").addEventListener("change", loadAdminSupport);
  document.getElementById("ticketReplyForm").addEventListener("submit", saveSupportReply);
  document.getElementById("adminTickets").addEventListener("click", function (event) {
    const button = event.target.closest("[data-ticket]"); if (!button) return;
    const ticket = adminSupportTickets.find(function (item) { return item.ticket_id === button.dataset.ticket; });
    if (!ticket) return;
    document.getElementById("ticketTitle").textContent = ticket.subject;
    document.getElementById("ticketId").value = ticket.ticket_id;
    document.getElementById("ticketStatus").value = ticket.status;
    document.getElementById("ticketReply").value = ticket.admin_reply || "";
    document.getElementById("ticketDetails").innerHTML = '<p><strong>' + escapeHtml(ticket.student_name) + '</strong> · ' + escapeHtml(ticket.matric_number) + '</p><p>' + escapeHtml(ticket.category) + ' · ' + escapeHtml(ticket.exam_title) + '</p><p>' + escapeHtml(formatDateTime(ticket.created_at)) + '</p><div class="card"><p>' + escapeHtml(ticket.message) + '</p></div>';
    openModal("ticketModal");
  });
  loadAdminSupport();
}
async function loadAdminSupport() {
  const response = await API.adminGetSupportTickets(document.getElementById("supportStatusFilter").value);
  if (!response.success) return showAlert(document.getElementById("pageAlert"), response.message);
  adminSupportTickets = response.data; const target = document.getElementById("adminTickets");
  target.innerHTML = adminSupportTickets.length ? adminSupportTickets.map(function (ticket) {
    return '<article class="card ticket-card"><div><h3>' + escapeHtml(ticket.subject) + '</h3><p class="muted">' + escapeHtml(ticket.ticket_id) + ' · ' + escapeHtml(ticket.student_name) + ' (' + escapeHtml(ticket.matric_number) + ')</p><p>' + escapeHtml(ticket.category) + ' · ' + escapeHtml(ticket.exam_title) + '</p><p>' + escapeHtml(ticket.message) + '</p><p><strong>' + escapeHtml(ticket.status) + '</strong> · ' + escapeHtml(formatDateTime(ticket.created_at)) + '</p>' + (ticket.admin_reply ? '<p><strong>Last response:</strong> ' + escapeHtml(ticket.admin_reply) + '</p>' : '') + '</div><button class="btn btn-primary" data-ticket="' + escapeHtml(ticket.ticket_id) + '">Review / respond</button></article>';
  }).join("") : '<div class="empty-state">No support requests in this filter.</div>';
}
async function saveSupportReply(event) {
  event.preventDefault(); const ticket = { ticket_id: document.getElementById("ticketId").value,
    status: document.getElementById("ticketStatus").value, admin_reply: document.getElementById("ticketReply").value.trim() };
  const result = await API.adminUpdateSupportTicket(ticket); showToast(result.message, result.success ? "success" : "error");
  if (result.success) { closeModal("ticketModal"); loadAdminSupport(); }
}

/* ---------- Results and monitoring log ---------- */

async function initAdminResults() {
  const alertBox = document.getElementById("pageAlert");
  const resultsFilter = document.getElementById("resultsExamFilter");
  const logsFilter = document.getElementById("logsExamFilter");

  const examsResponse = await API.adminGetExams();
  if (!examsResponse.success) return showAlert(alertBox, examsResponse.message);
  fillExamSelect(resultsFilter, examsResponse.data, true);
  fillExamSelect(logsFilter, examsResponse.data, true);

  resultsFilter.addEventListener("change", loadResults);
  logsFilter.addEventListener("change", loadLogs);
  document.getElementById("logsTypeFilter").addEventListener("change", loadLogs);
  document.getElementById("tabResultsBtn").addEventListener("click", function () { showResultsTab("results"); });
  document.getElementById("tabLogsBtn").addEventListener("click", function () { showResultsTab("logs"); });

  showResultsTab(getQueryParam("tab") === "logs" ? "logs" : "results");
  loadResults();
  loadLogs();
}

function showResultsTab(tab) {
  document.getElementById("resultsPanel").hidden = tab !== "results";
  document.getElementById("logsPanel").hidden = tab !== "logs";
  document.getElementById("tabResultsBtn").classList.toggle("active", tab === "results");
  document.getElementById("tabLogsBtn").classList.toggle("active", tab === "logs");
  document.getElementById("tabResultsBtn").setAttribute("aria-selected", String(tab === "results"));
  document.getElementById("tabLogsBtn").setAttribute("aria-selected", String(tab === "logs"));
  document.querySelectorAll("[data-nav]").forEach(function (link) {
    link.classList.toggle("active", link.getAttribute("data-nav") === tab);
  });
}

async function loadResults() {
  const examId = document.getElementById("resultsExamFilter").value;
  const response = await API.adminGetResults(examId);
  if (!response.success) return showAlert(document.getElementById("pageAlert"), response.message);

  const results = response.data;
  const average = results.length ? results.reduce(function (sum, result) { return sum + result.percentage; }, 0) / results.length : 0;
  const passed = results.filter(function (result) { return result.status === "PASS"; }).length;
  document.getElementById("resultsSummary").textContent = results.length === 0 ? "No results" :
    results.length + " results, average " + formatPercent(average) + ", " + passed + " passed, " + (results.length - passed) + " failed";

  document.getElementById("resultsTableBody").innerHTML = results.length === 0 ? emptyRow(8, "No results for this selection.") :
    results.map(function (result) {
      return "<tr><td>" + escapeHtml(result.result_id) + "</td>" +
        "<td><strong>" + escapeHtml(result.student_name) + '</strong><br><span class="muted">' + escapeHtml(result.student_id) + "</span></td>" +
        "<td>" + escapeHtml(result.exam_title) + "</td>" +
        "<td>" + escapeHtml(result.score) + "/" + escapeHtml(result.total_marks) + "</td>" +
        "<td>" + formatPercent(result.percentage) + "</td><td>" + resultBadge(result.status) + "</td>" +
        "<td>" + escapeHtml(formatDateTime(result.submit_time)) + "</td>" +
        "<td>" + escapeHtml(formatDuration(result.time_spent_seconds)) + "</td></tr>";
    }).join("");
}

async function loadLogs() {
  const examId = document.getElementById("logsExamFilter").value;
  const eventType = document.getElementById("logsTypeFilter").value;
  const response = await API.adminGetProctoringLogs(examId, eventType);
  if (!response.success) return showAlert(document.getElementById("pageAlert"), response.message);

  const logs = response.data;
  document.getElementById("logsSummary").textContent = logs.length === 0 ? "No events" :
    logs.length + (logs.length === 1 ? " event" : " events") + " (newest first)";

  document.getElementById("logsTableBody").innerHTML = logs.length === 0 ? emptyRow(7, "No monitoring events for this selection.") :
    logs.map(function (log) {
      return "<tr><td>" + escapeHtml(log.log_id) + "</td>" +
        "<td><strong>" + escapeHtml(log.student_name) + '</strong><br><span class="muted">' + escapeHtml(log.student_id) + "</span></td>" +
        "<td>" + escapeHtml(log.exam_title) + "</td>" +
        "<td>" + badge(log.event_type, log.severity) + "</td>" +
        "<td>" + escapeHtml(log.event_description) + "</td>" +
        "<td>" + escapeHtml(formatDateTime(log.timestamp)) + "</td>" +
        "<td>" + escapeHtml(log.severity) + "</td></tr>";
    }).join("");
}

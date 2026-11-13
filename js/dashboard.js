/* Ken E-Test - dashboard.js
   Student dashboard: statistics, available examinations, recent results. */

document.addEventListener("DOMContentLoaded", function () {
  if (document.body.dataset.page === "dashboard") initDashboard();
});

async function initDashboard() {
  const user = Auth.requireLogin("student");
  if (!user) return;

  document.getElementById("userName").textContent = user.full_name;
  document.getElementById("welcomeName").textContent = firstName(user.full_name);
  document.getElementById("studentClass").textContent = user["class"] || "";

  const alertBox = document.getElementById("pageAlert");
  const responses = await Promise.all([API.getAvailableExams(), API.getStudentResults()]);
  const examsResponse = responses[0];
  const resultsResponse = responses[1];

  if (!examsResponse.success) return showAlert(alertBox, examsResponse.message);
  if (!resultsResponse.success) return showAlert(alertBox, resultsResponse.message);

  const exams = examsResponse.data;
  const results = resultsResponse.data;

  renderStats(exams, results);
  renderExams(exams);
  renderRecentResults(results);
}

function renderStats(exams, results) {
  const notTaken = exams.filter(function (exam) { return !exam.attempt; }).length;
  const passed = results.filter(function (result) { return result.status === "PASS"; }).length;
  let average = 0;
  if (results.length) {
    average = results.reduce(function (sum, result) { return sum + result.percentage; }, 0) / results.length;
  }
  document.getElementById("statAvailable").textContent = notTaken;
  document.getElementById("statTaken").textContent = results.length;
  document.getElementById("statAverage").textContent = results.length ? formatPercent(average) : "-";
  document.getElementById("statPassed").textContent = passed;
}

function renderExams(exams) {
  const grid = document.getElementById("examGrid");
  if (exams.length === 0) {
    grid.innerHTML = '<div class="empty-state">No examinations are available right now. Check again later.</div>';
    return;
  }

  grid.innerHTML = exams.map(function (exam) {
    let action;
    if (exam.attempt) {
      action =
        '<div class="exam-done">' + resultBadge(exam.attempt.status) +
        "<span>" + escapeHtml(exam.attempt.score) + "/" + escapeHtml(exam.attempt.total_marks) +
        " (" + formatPercent(exam.attempt.percentage) + ")</span></div>" +
        '<a class="btn btn-secondary btn-block" href="result.html?id=' + encodeURIComponent(exam.attempt.result_id) + '">View result</a>';
    } else if (exam.window_status === "upcoming") {
      action = '<p class="muted">Scheduled to open: ' + escapeHtml(formatDateTime(exam.scheduled_start)) + '</p><button class="btn btn-secondary btn-block" disabled>Not yet available</button>';
    } else if (exam.window_status === "expired") {
      action = '<p class="muted">The scheduled examination period has ended.</p><button class="btn btn-secondary btn-block" disabled>Exam closed</button>';
    } else {
      action = '<a class="btn btn-primary btn-block" href="instructions.html?exam=' + encodeURIComponent(exam.exam_id) + '">View instructions</a>';
    }
    return '<article class="exam-card">' +
      '<div class="exam-card-body">' +
      "<h3>" + escapeHtml(exam.title) + "</h3>" +
      '<p class="exam-subject">' + escapeHtml(exam.subject) + "</p>" +
      '<p class="exam-desc">' + escapeHtml(exam.description) + "</p>" +
      '<ul class="chips"><li>' + escapeHtml(exam.total_questions) + " questions</li><li>" +
      escapeHtml(exam.duration_minutes) + " minutes</li><li>Pass mark " + escapeHtml(exam.pass_mark) + "%</li></ul>" +
      (exam.scheduled_start ? '<p class="muted">Starts: ' + escapeHtml(formatDateTime(exam.scheduled_start)) + '</p>' : '') +
      "</div>" + '<div class="exam-card-action">' + action + "</div></article>";
  }).join("");
}

function renderRecentResults(results) {
  const body = document.getElementById("recentResultsBody");
  if (results.length === 0) {
    body.innerHTML = '<tr><td colspan="5" class="empty-cell">You have not taken any examination yet.</td></tr>';
    return;
  }
  body.innerHTML = results.slice(0, 3).map(function (result) {
    return "<tr><td>" + escapeHtml(result.exam_title) + "</td>" +
      "<td>" + escapeHtml(result.score) + "/" + escapeHtml(result.total_marks) + "</td>" +
      "<td>" + formatPercent(result.percentage) + "</td>" +
      "<td>" + resultBadge(result.status) + "</td>" +
      "<td>" + escapeHtml(formatDate(result.submit_time)) + "</td></tr>";
  }).join("");
}

/* Ken E-Test - history.js
   Lists every examination the student has taken. */

document.addEventListener("DOMContentLoaded", function () {
  if (document.body.dataset.page === "history") initHistory();
});

async function initHistory() {
  const user = Auth.requireLogin("student");
  if (!user) return;
  document.getElementById("userName").textContent = user.full_name;

  const alertBox = document.getElementById("pageAlert");
  const response = await API.getStudentResults();
  if (!response.success) return showAlert(alertBox, response.message);

  const results = response.data;
  const body = document.getElementById("historyBody");
  document.getElementById("historyCount").textContent =
    results.length + (results.length === 1 ? " examination taken" : " examinations taken");

  if (results.length === 0) {
    body.innerHTML = '<tr><td colspan="7" class="empty-cell">You have not taken any examination yet.</td></tr>';
    return;
  }

  body.innerHTML = results.map(function (result) {
    return "<tr>" +
      "<td><strong>" + escapeHtml(result.exam_title) + "</strong><br><span class=\"muted\">" + escapeHtml(result.subject) + "</span></td>" +
      "<td>" + escapeHtml(result.score) + "/" + escapeHtml(result.total_marks) + "</td>" +
      "<td>" + formatPercent(result.percentage) + "</td>" +
      "<td>" + resultBadge(result.status) + "</td>" +
      "<td>" + escapeHtml(formatDateTime(result.submit_time)) + "</td>" +
      "<td>" + escapeHtml(formatDuration(result.time_spent_seconds)) + "</td>" +
      '<td><a class="btn btn-secondary btn-sm" href="result.html?id=' + encodeURIComponent(result.result_id) + '">View</a></td>' +
      "</tr>";
  }).join("");
}

/* Ken E-Test - result.js
   Displays one examination result. */

document.addEventListener("DOMContentLoaded", function () {
  if (document.body.dataset.page === "result") initResult();
});

async function initResult() {
  const user = Auth.requireLogin("student");
  if (!user) return;
  document.getElementById("userName").textContent = user.full_name;

  const resultId = getQueryParam("id");
  const alertBox = document.getElementById("pageAlert");
  if (!resultId) {
    window.location.replace("history.html");
    return;
  }

  const response = await API.getResult(resultId);
  document.getElementById("loadingState").hidden = true;
  if (!response.success) return showAlert(alertBox, response.message);

  const result = response.data;
  const passed = result.status === "PASS";

  document.getElementById("resultContent").hidden = false;
  document.getElementById("resExamTitle").textContent = result.exam_title;
  document.getElementById("resStudent").textContent = result.student_name;
  document.getElementById("resScore").textContent = result.score + "/" + result.total_marks;
  document.getElementById("resPercentage").textContent = formatPercent(result.percentage);
  document.getElementById("resStatus").innerHTML = resultBadge(result.status);
  document.getElementById("resDate").textContent = formatDateTime(result.submit_time);
  document.getElementById("resTime").textContent = formatDuration(result.time_spent_seconds);
  document.getElementById("resPassMark").textContent = result.pass_mark + "%";

  const summary = document.getElementById("resSummary");
  summary.textContent = passed
    ? "You passed. Your score is above the pass mark of " + result.pass_mark + "%."
    : "You did not reach the pass mark of " + result.pass_mark + "%.";
  document.getElementById("resultHero").classList.add(passed ? "is-pass" : "is-fail");

  // Draw the percentage ring (circumference of a circle with radius 54).
  const circumference = 2 * Math.PI * 54;
  const ring = document.getElementById("ringValue");
  ring.setAttribute("stroke-dasharray", String(circumference));
  ring.setAttribute("stroke-dashoffset", String(circumference));
  document.getElementById("ringText").textContent = formatPercent(result.percentage);
  requestAnimationFrame(function () {
    ring.setAttribute("stroke-dashoffset", String(circumference * (1 - Math.min(result.percentage, 100) / 100)));
  });
}

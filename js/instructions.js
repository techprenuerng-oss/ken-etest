/* Ken E-Test - instructions.js
   Shows the examination details and rules before the student starts. */

document.addEventListener("DOMContentLoaded", function () {
  if (document.body.dataset.page === "instructions") initInstructions();
});

async function initInstructions() {
  const user = Auth.requireLogin("student");
  if (!user) return;
  document.getElementById("userName").textContent = user.full_name;

  const examId = getQueryParam("exam");
  const alertBox = document.getElementById("pageAlert");
  if (!examId) {
    window.location.replace("dashboard.html");
    return;
  }

  const result = await API.getExam(examId);
  if (!result.success) {
    document.getElementById("loadingState").hidden = true;
    return showAlert(alertBox, result.message);
  }

  const exam = result.data;
  document.getElementById("loadingState").hidden = true;
  document.getElementById("instructionsContent").hidden = false;

  document.getElementById("examTitle").textContent = exam.title;
  document.getElementById("examSubject").textContent = exam.subject;
  document.getElementById("examDescription").textContent = exam.description;
  document.getElementById("infoQuestions").textContent = exam.total_questions;
  document.getElementById("infoDuration").textContent = exam.duration_minutes + " minutes";
  document.getElementById("infoMarks").textContent = exam.total_marks;
  document.getElementById("infoPassMark").textContent = exam.pass_mark + "%";

  if (exam.attempt) {
    document.getElementById("startPanel").hidden = true;
    document.getElementById("alreadyTaken").hidden = false;
    document.getElementById("viewResultLink").href = "result.html?id=" + encodeURIComponent(exam.attempt.result_id);
    return;
  }

  if (exam.in_progress) {
    document.getElementById("inProgressNote").hidden = false;
    document.getElementById("startBtn").textContent = "Resume examination";
  }

  const agree = document.getElementById("agreeCheck");
  const startBtn = document.getElementById("startBtn");
  if (exam.window_status === "upcoming") {
    startBtn.disabled = true;
    startBtn.textContent = "Opens " + formatDateTime(exam.scheduled_start);
    showAlert(alertBox, "This examination is scheduled for a later time. You can return when it opens.", "info");
  } else if (exam.window_status === "expired" && !exam.in_progress) {
    startBtn.disabled = true;
    startBtn.textContent = "Examination closed";
    showAlert(alertBox, "The scheduled examination period has ended.", "info");
  } else if (exam.window_status === "expired" && exam.in_progress) {
    startBtn.textContent = "Resume to submit saved attempt";
    showAlert(alertBox, "The scheduled period has ended. Resuming will submit the saved attempt immediately.", "info");
  }
  agree.addEventListener("change", function () { startBtn.disabled = !agree.checked || (exam.window_status !== "open" && !(exam.window_status === "expired" && exam.in_progress)); });
  startBtn.addEventListener("click", function () {
    window.location.href = "exam.html?exam=" + encodeURIComponent(examId);
  });
}

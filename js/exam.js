/* Ken E-Test - exam.js
   Runs the examination page: loads questions, timer, navigation, submission.
   Questions come from the MySQL database through the Python API; none are stored in exam.html. */

const state = {
  examId: null,
  exam: null,
  questions: [],
  answers: {},        // { Q001: "A", Q002: "C" }
  current: 0,
  endTime: 0,         // milliseconds timestamp when time runs out
  timerId: null,
  started: false,
  timeUpTriggered: false,
  submitting: false,
  submitted: false,
  lastSubmitReason: "manual"
};

const el = {};        // cached page elements

function byId(id) {
  return document.getElementById(id);
}

function answersKey() {
  return "ken_answers_" + state.examId;
}

/* ---------- Page start-up ---------- */

document.addEventListener("DOMContentLoaded", function () {
  if (document.body.dataset.page === "exam") initExamPage();
});

async function initExamPage() {
  const user = Auth.requireLogin("student");
  if (!user) return;

  state.examId = getQueryParam("exam");
  if (!state.examId) {
    window.location.replace("dashboard.html");
    return;
  }

  [
    "studentName", "examTitle", "timer", "timerValue", "warningBadge", "warningBanner", "warningText",
    "startGate", "gateTitle", "gateInfo", "gateNote", "gateMessage", "beginBtn",
    "examLayout", "questionNumber", "questionText", "optionsList", "prevBtn", "nextBtn",
    "progressText", "progressFill", "navGrid", "answeredCount", "unansweredCount",
    "submitModal", "modalSummary", "confirmSubmitBtn", "cancelSubmitBtn",
    "fullscreenOverlay", "fsMessage", "fsReturnBtn",
    "submittingOverlay", "submittingText", "submitError", "retrySubmitBtn", "backToExamBtn"
  ].forEach(function (id) { el[id] = byId(id); });

  el.studentName.textContent = user.full_name;

  Proctor.init({
    examId: state.examId,
    onWarning: handleWarning,
    onNotice: function (message) { showToast(message, "info"); },
    onMaxWarnings: function () { submitExam("max_warnings"); },
    onFullscreenLost: function () { showFullscreenOverlay("You left fullscreen mode. Return to fullscreen to continue the examination."); },
    onFullscreenRestored: hideFullscreenOverlay
  });

  bindEvents();
  updateWarningBadge();

  const result = await API.getExam(state.examId);
  if (!result.success) {
    showAlert(el.gateMessage, result.message);
    el.beginBtn.hidden = true;
    return;
  }
  if (result.data.attempt) {
    window.location.replace("result.html?id=" + encodeURIComponent(result.data.attempt.result_id));
    return;
  }
  fillGate(result.data);
}

function bindEvents() {
  el.beginBtn.addEventListener("click", beginExam);
  el.prevBtn.addEventListener("click", function () { goToQuestion(state.current - 1); });
  el.nextBtn.addEventListener("click", function () { goToQuestion(state.current + 1); });
  document.querySelectorAll(".js-submit").forEach(function (button) {
    button.addEventListener("click", openSubmitModal);
  });
  el.cancelSubmitBtn.addEventListener("click", closeSubmitModal);
  el.confirmSubmitBtn.addEventListener("click", function () { submitExam("manual"); });
  el.fsReturnBtn.addEventListener("click", function () { Proctor.requestFullscreen(); });
  el.retrySubmitBtn.addEventListener("click", function () { submitExam(state.lastSubmitReason); });
  el.backToExamBtn.addEventListener("click", function () {
    el.submittingOverlay.hidden = true;
    Proctor.start();
  });

  el.optionsList.addEventListener("click", function (event) {
    const button = event.target.closest("[data-letter]");
    if (button) selectAnswer(button.getAttribute("data-letter"));
  });
  el.navGrid.addEventListener("click", function (event) {
    const button = event.target.closest("[data-index]");
    if (button) goToQuestion(Number(button.getAttribute("data-index")));
  });

  // Keyboard shortcuts: A-D select an answer, arrow keys move between questions.
  document.addEventListener("keydown", function (event) {
    if (!state.started || state.submitting || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!el.submitModal.hidden) return;
    const key = event.key.toLowerCase();
    if (["a", "b", "c", "d"].indexOf(key) !== -1) selectAnswer(key.toUpperCase());
    if (event.key === "ArrowRight") goToQuestion(state.current + 1);
    if (event.key === "ArrowLeft") goToQuestion(state.current - 1);
  });

  // Ask the browser to warn before the page is closed or refreshed during the exam.
  window.addEventListener("beforeunload", function (event) {
    if (state.started && !state.submitted) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

/* ---------- Start gate ---------- */

function fillGate(exam) {
  el.examTitle.textContent = exam.title;
  el.gateTitle.textContent = exam.title;
  el.gateInfo.innerHTML =
    "<li><strong>" + escapeHtml(exam.total_questions) + "</strong> questions</li>" +
    "<li><strong>" + escapeHtml(exam.duration_minutes) + "</strong> minutes</li>" +
    "<li>Pass mark <strong>" + escapeHtml(exam.pass_mark) + "%</strong></li>";

  if (exam.in_progress) {
    el.beginBtn.textContent = "Resume examination";
    el.gateNote.textContent = "You started this examination earlier. The timer kept running, so your remaining time is shorter.";
  } else if (!Proctor.fullscreenSupported) {
    el.gateNote.textContent = "Fullscreen is not supported on this device. Other monitoring still applies.";
  } else {
    el.gateNote.textContent = "The examination opens in fullscreen mode and the timer starts when you click the button.";
  }
  el.beginBtn.disabled = false;
}

/* The click on the button is what allows the browser to enter fullscreen. */
async function beginExam() {
  hideAlert(el.gateMessage);
  setButtonLoading(el.beginBtn, true, "Starting...");
  const fullscreenPromise = Proctor.requestFullscreen();   // must be called directly from the click
  const result = await API.startExam(state.examId);
  await fullscreenPromise;

  if (!result.success) {
    setButtonLoading(el.beginBtn, false);
    Proctor.exitFullscreen();
    if (result.code === "ALREADY_SUBMITTED" && result.data) {
      window.location.replace("result.html?id=" + encodeURIComponent(result.data.result_id));
      return;
    }
    showAlert(el.gateMessage, result.message);
    return;
  }

  const data = result.data;
  state.exam = data.exam;
  state.questions = data.questions;
  state.current = 0;
  state.answers = loadSavedAnswers();
  state.endTime = Date.now() + data.remaining_seconds * 1000;
  state.started = true;

  el.examTitle.textContent = state.exam.title;
  el.startGate.hidden = true;
  el.examLayout.hidden = false;
  render();
  startTimer();
  Proctor.start();

  if (Proctor.getWarnings() >= MAX_WARNINGS) {
    submitExam("max_warnings");
  } else if (data.remaining_seconds <= 0) {
    submitExam("time");
  } else if (Proctor.fullscreenSupported && !Proctor.isFullscreen()) {
    showFullscreenOverlay("Fullscreen is required for this examination. Click the button to enter fullscreen.");
  }
}

function loadSavedAnswers() {
  const saved = {};
  try {
    const stored = JSON.parse(sessionStorage.getItem(answersKey()) || "{}");
    state.questions.forEach(function (question) {
      if (["A", "B", "C", "D"].indexOf(stored[question.question_id]) !== -1) {
        saved[question.question_id] = stored[question.question_id];
      }
    });
  } catch (error) { /* ignore broken saved data */ }
  return saved;
}

/* ---------- Rendering ---------- */

function render() {
  const question = state.questions[state.current];
  const total = state.questions.length;
  const chosen = state.answers[question.question_id];

  el.questionNumber.textContent = "Question " + (state.current + 1) + " of " + total;
  el.questionText.textContent = question.question;

  el.optionsList.innerHTML = ["A", "B", "C", "D"].map(function (letter) {
    const selected = chosen === letter;
    return '<button type="button" class="option' + (selected ? " selected" : "") + '" role="radio" ' +
      'aria-checked="' + selected + '" data-letter="' + letter + '">' +
      '<span class="bubble">' + letter + "</span>" +
      '<span class="option-text">' + escapeHtml(question.options[letter]) + "</span></button>";
  }).join("");

  el.prevBtn.disabled = state.current === 0;
  el.nextBtn.disabled = state.current === total - 1;
  renderProgress();
}

function renderProgress() {
  const total = state.questions.length;
  const answered = Object.keys(state.answers).length;

  el.progressText.textContent = answered + " of " + total + " answered";
  el.progressFill.style.width = (total ? (answered / total) * 100 : 0) + "%";
  el.answeredCount.textContent = answered;
  el.unansweredCount.textContent = total - answered;

  el.navGrid.innerHTML = state.questions.map(function (question, index) {
    const isAnswered = !!state.answers[question.question_id];
    const classes = "nav-q" + (isAnswered ? " answered" : "") + (index === state.current ? " current" : "");
    return '<button type="button" class="' + classes + '" data-index="' + index + '" ' +
      'aria-label="Question ' + (index + 1) + (isAnswered ? ", answered" : ", not answered") + '"' +
      (index === state.current ? ' aria-current="true"' : "") + ">" + (index + 1) + "</button>";
  }).join("");
}

function goToQuestion(index) {
  if (index < 0 || index >= state.questions.length || state.submitting) return;
  state.current = index;
  render();
}

function selectAnswer(letter) {
  if (state.submitting) return;
  const question = state.questions[state.current];
  state.answers[question.question_id] = letter;
  sessionStorage.setItem(answersKey(), JSON.stringify(state.answers));
  render();
}

/* ---------- Timer ---------- */

function startTimer() {
  updateTimer();
  state.timerId = setInterval(updateTimer, 500);
}

/* The remaining time is calculated from the end time (not by counting down),
   so the timer stays correct even if the browser slows down a background tab. */
function updateTimer() {
  const remaining = Math.max(0, Math.ceil((state.endTime - Date.now()) / 1000));
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  const text = (hours ? hours + ":" + String(minutes).padStart(2, "0") : String(minutes).padStart(2, "0")) +
    ":" + String(seconds).padStart(2, "0");

  el.timerValue.textContent = text;
  el.timer.classList.toggle("timer-warning", remaining <= 300 && remaining > 60);
  el.timer.classList.toggle("timer-danger", remaining <= 60);

  // Only trigger the automatic submission once (a failed attempt can be retried by the student).
  if (remaining === 0 && !state.timeUpTriggered && !state.submitting && !state.submitted) {
    state.timeUpTriggered = true;
    submitExam("time");
  }
}

/* ---------- Warnings ---------- */

function updateWarningBadge() {
  const count = Proctor.getWarnings();
  el.warningBadge.textContent = "Warnings " + count + "/" + MAX_WARNINGS;
  el.warningBadge.classList.toggle("has-warnings", count > 0);
}

function handleWarning(info) {
  updateWarningBadge();
  el.warningText.textContent = "Warning " + info.count + " of " + info.max + ": " + info.message +
    (info.count >= info.max ? " Maximum warnings reached." : "");
  el.warningBanner.hidden = false;
  clearTimeout(handleWarning.timeoutId);
  if (info.count < info.max) {
    handleWarning.timeoutId = setTimeout(function () { el.warningBanner.hidden = true; }, 8000);
  }
}

function showFullscreenOverlay(message) {
  if (state.submitting || state.submitted) return;
  el.fsMessage.textContent = message;
  el.fullscreenOverlay.hidden = false;
}

function hideFullscreenOverlay() {
  el.fullscreenOverlay.hidden = true;
}

/* ---------- Submission ---------- */

function openSubmitModal() {
  if (!state.started || state.submitting) return;
  const total = state.questions.length;
  const answered = Object.keys(state.answers).length;
  const unanswered = total - answered;
  el.modalSummary.textContent = "You have answered " + answered + " of " + total + " questions." +
    (unanswered > 0 ? " " + unanswered + " unanswered " + (unanswered === 1 ? "question" : "questions") + " will score zero." : "") +
    " You cannot change your answers after submitting.";
  el.submitModal.hidden = false;
  el.cancelSubmitBtn.focus();
}

function closeSubmitModal() {
  el.submitModal.hidden = true;
}

/* reason is "manual", "time" or "max_warnings".
   The state.submitting flag makes sure the answers are only sent once at a time. */
async function submitExam(reason) {
  if (state.submitting || state.submitted) return;
  state.submitting = true;
  state.lastSubmitReason = reason;

  closeSubmitModal();
  hideFullscreenOverlay();
  Proctor.stop();                       // stop monitoring while submitting

  const messages = {
    manual: "Submitting your answers...",
    time: "Time is up. Submitting your answers...",
    max_warnings: "Maximum warnings reached. Submitting your answers..."
  };
  el.submittingText.textContent = messages[reason] || messages.manual;
  el.submitError.hidden = true;
  el.retrySubmitBtn.hidden = true;
  el.backToExamBtn.hidden = true;
  el.submittingOverlay.hidden = false;

  const result = await API.submitExam(state.examId, state.answers);

  if (result.success || result.code === "ALREADY_SUBMITTED") {
    finishExam(result.data.result_id);
    return;
  }

  // Submission failed (for example no Internet). Keep the answers and let the student retry.
  state.submitting = false;
  showAlert(el.submitError, result.message + " Your answers are saved on this page.");
  el.retrySubmitBtn.hidden = false;
  el.backToExamBtn.hidden = reason !== "manual";
}

function finishExam(resultId) {
  state.submitted = true;
  clearInterval(state.timerId);
  sessionStorage.removeItem(answersKey());
  Proctor.clearSavedState();
  Proctor.exitFullscreen();
  window.location.replace("result.html?id=" + encodeURIComponent(resultId));
}

/* Ken E-Test - api.js
   1. The API client: every request to the Python backend (/api) goes through apiRequest().
   2. Small shared helpers used by many pages (formatting, toast messages, dialogs).
   Each method of API has the same name as the action handled in app.py. */

/* ---------- 1. API client ---------- */

function isApiConfigured() {
  return CONFIG.API_URL && CONFIG.API_URL.indexOf("PASTE_YOUR") === -1;
}

function getStoredToken(role) {
  if (!role) return null;
  try {
    const raw = sessionStorage.getItem(CONFIG.SESSION_KEYS[role]);
    return raw ? JSON.parse(raw).token : null;
  } catch (error) {
    return null;
  }
}

function handleExpiredSession(role) {
  sessionStorage.removeItem(CONFIG.SESSION_KEYS[role]);
  window.location.replace("login.html?expired=1");
}

/* Sends one request. It never throws: it always returns { success, message, code, data }. */
async function apiRequest(action, data, role) {
  if (!isApiConfigured()) {
    return {
      success: false,
      code: "NOT_CONFIGURED",
      message: "The backend URL is not set. Check js/config.js."
    };
  }

  const body = Object.assign({}, data || {}, { action: action });
  const token = getStoredToken(role);
  if (token) body.token = token;

  let response;
  try {
    response = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (error) {
    return {
      success: false,
      code: "NETWORK",
      message: "Could not reach the server. Check that Apache and MySQL are running and try again."
    };
  }

  let result;
  try {
    result = await response.json();
  } catch (error) {
    // The server answered, but not with JSON (for example an error page).
    return {
      success: false,
      code: "BAD_RESPONSE",
      message: "The server sent an unexpected reply. Open /api in the browser to check the setup."
    };
  }
  if (!result.success && result.code === "AUTH_REQUIRED" && role) {
    handleExpiredSession(role);
  }
  return result;
}

const API = {
  // Authentication
  registerStudent: (data) => apiRequest("registerStudent", data),
  loginStudent: (email, password) => apiRequest("loginStudent", { email, password }),
  loginAdmin: (username, password) => apiRequest("loginAdmin", { username, password }),
  logout: (role) => apiRequest("logout", {}, role),

  // Student
  getAvailableExams: () => apiRequest("getAvailableExams", {}, "student"),
  getExam: (examId) => apiRequest("getExam", { exam_id: examId }, "student"),
  startExam: (examId) => apiRequest("startExam", { exam_id: examId }, "student"),
  submitExam: (examId, answers) => apiRequest("submitExam", { exam_id: examId, answers: answers }, "student"),
  getStudentResults: () => apiRequest("getStudentResults", {}, "student"),
  getResult: (resultId) => apiRequest("getResult", { result_id: resultId }, "student"),
  logProctoringEvent: (examId, eventType, description) =>
    apiRequest("logProctoringEvent", { exam_id: examId, event_type: eventType, event_description: description }, "student"),

  // Admin
  adminGetStats: () => apiRequest("adminGetStats", {}, "admin"),
  adminGetExams: () => apiRequest("adminGetExams", {}, "admin"),
  adminCreateExam: (exam) => apiRequest("adminCreateExam", exam, "admin"),
  adminUpdateExam: (exam) => apiRequest("adminUpdateExam", exam, "admin"),
  adminSetExamStatus: (examId, status) => apiRequest("adminSetExamStatus", { exam_id: examId, status: status }, "admin"),
  adminGetQuestions: (examId) => apiRequest("adminGetQuestions", { exam_id: examId || "" }, "admin"),
  adminAddQuestion: (question) => apiRequest("adminAddQuestion", question, "admin"),
  adminUpdateQuestion: (question) => apiRequest("adminUpdateQuestion", question, "admin"),
  adminDeleteQuestion: (questionId) => apiRequest("adminDeleteQuestion", { question_id: questionId }, "admin"),
  adminGetStudents: () => apiRequest("adminGetStudents", {}, "admin"),
  adminSetStudentStatus: (studentId, status) => apiRequest("adminSetStudentStatus", { student_id: studentId, status: status }, "admin"),
  adminGetResults: (examId) => apiRequest("adminGetResults", { exam_id: examId || "" }, "admin"),
  adminGetProctoringLogs: (examId, eventType) =>
    apiRequest("adminGetProctoringLogs", { exam_id: examId || "", event_type: eventType || "" }, "admin")
};

/* ---------- 2. Shared helpers ---------- */

/* Escapes text before it is placed inside HTML (prevents injected markup). */
function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function formatDate(isoText) {
  const date = new Date(isoText);
  if (isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(isoText) {
  const date = new Date(isoText);
  if (isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) +
    ", " + date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || isNaN(totalSeconds)) return "Not available";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return seconds + " sec";
  return minutes + " min" + (seconds ? " " + seconds + " sec" : "");
}

function formatPercent(value) {
  const number = Number(value);
  if (isNaN(number)) return "0%";
  return (Math.round(number * 10) / 10) + "%";
}

function firstName(fullName) {
  return String(fullName || "").trim().split(/\s+/)[0] || "student";
}

/* Returns a small coloured label, e.g. PASS / FAIL / Active / high. */
function badge(text, kind) {
  return '<span class="badge badge-' + escapeHtml(kind) + '">' + escapeHtml(text) + "</span>";
}

function resultBadge(status) {
  return badge(status, String(status).toUpperCase() === "PASS" ? "pass" : "fail");
}

function statusBadge(status) {
  return badge(status, String(status).toLowerCase() === "active" ? "active" : "inactive");
}

/* Shows a message inside a form (element with class "alert"). */
function showAlert(element, message, type) {
  if (!element) return;
  element.textContent = message;
  element.className = "alert alert-" + (type || "error");
  element.hidden = false;
}

function hideAlert(element) {
  if (element) element.hidden = true;
}

/* Disables a button and shows a waiting label while a request is running. */
function setButtonLoading(button, isLoading, loadingText) {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText || "Please wait...";
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

/* Small pop-up message in the corner of the screen. */
function showToast(message, type) {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = "toast toast-" + (type || "info");
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(function () {
    toast.classList.add("toast-hide");
    setTimeout(function () { toast.remove(); }, 300);
  }, 4000);
}

/* Confirmation dialog. Returns a Promise that resolves to true (confirmed) or false. */
function confirmDialog(options) {
  return new Promise(function (resolve) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML =
      '<div class="modal modal-small" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">' +
      '<h2 id="confirmTitle">' + escapeHtml(options.title || "Are you sure?") + "</h2>" +
      "<p>" + escapeHtml(options.message || "") + "</p>" +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-secondary" data-answer="no">Cancel</button>' +
      '<button type="button" class="btn ' + (options.danger ? "btn-danger" : "btn-primary") + '" data-answer="yes">' +
      escapeHtml(options.confirmText || "Confirm") + "</button>" +
      "</div></div>";
    function close(answer) {
      overlay.remove();
      resolve(answer);
    }
    overlay.addEventListener("click", function (event) {
      const answer = event.target.getAttribute("data-answer");
      if (answer) close(answer === "yes");
      else if (event.target === overlay) close(false);
    });
    document.body.appendChild(overlay);
    overlay.querySelector('[data-answer="no"]').focus();
  });
}

document.addEventListener("DOMContentLoaded", function () {
  const page = document.body.dataset.page;
  if (page === "student-support") initStudentSupport();
  if (page === "change-password") initChangePassword();
});

async function initStudentSupport() {
  const user = Auth.requireLogin("student"); if (!user) return;
  document.getElementById("userName").textContent = user.full_name;
  const exams = await API.getAvailableExams();
  if (exams.success) exams.data.forEach(function (exam) {
    const option = document.createElement("option"); option.value = exam.exam_id; option.textContent = exam.title;
    document.getElementById("examId").appendChild(option);
  });
  document.getElementById("supportForm").addEventListener("submit", async function (event) {
    event.preventDefault(); const button = document.getElementById("sendSupportBtn");
    const ticket = { category: document.getElementById("category").value, exam_id: document.getElementById("examId").value,
      subject: document.getElementById("subject").value.trim(), message: document.getElementById("message").value.trim() };
    setButtonLoading(button, true, "Sending..."); const result = await API.createSupportTicket(ticket); setButtonLoading(button, false);
    if (!result.success) return showAlert(document.getElementById("pageAlert"), result.message);
    showAlert(document.getElementById("pageAlert"), result.message + " Reference: " + result.data.ticket_id, "success");
    this.reset(); loadMyTickets();
  });
  loadMyTickets();
}

async function loadMyTickets() {
  const target = document.getElementById("ticketList"); const response = await API.getMySupportTickets();
  if (!response.success) { target.textContent = response.message; return; }
  target.innerHTML = response.data.length ? response.data.map(function (ticket) {
    return '<article class="exam-card"><div class="exam-card-body"><h3>' + escapeHtml(ticket.subject) + '</h3><p class="muted">' + escapeHtml(ticket.ticket_id) + ' · ' + escapeHtml(ticket.category) + '</p><p>' + escapeHtml(ticket.message) + '</p><p>' + escapeHtml(ticket.exam_title) + ' · ' + escapeHtml(formatDateTime(ticket.created_at)) + '</p>' +
      '<p><strong>Status:</strong> ' + escapeHtml(ticket.status) + '</p>' + (ticket.admin_reply ? '<div class="notice-box"><strong>Administrator response</strong><p>' + escapeHtml(ticket.admin_reply) + '</p></div>' : '<p class="muted">Awaiting administrator response.</p>') + '</div></article>';
  }).join("") : '<div class="empty-state">You have not submitted any support requests.</div>';
}

function initChangePassword() {
  const user = Auth.requireLogin("student"); if (!user) return;
  document.getElementById("passwordForm").addEventListener("submit", async function (event) {
    event.preventDefault(); const alertBox = document.getElementById("formAlert");
    const current = document.getElementById("currentPassword").value;
    const next = document.getElementById("newPassword").value;
    if (next.length < 8) return showAlert(alertBox, "New password must be at least 8 characters.");
    if (next !== document.getElementById("confirmPassword").value) return showAlert(alertBox, "The new passwords do not match.");
    const button = document.getElementById("changePasswordBtn"); setButtonLoading(button, true, "Updating...");
    const result = await API.changeStudentPassword(current, next); setButtonLoading(button, false);
    if (!result.success) return showAlert(alertBox, result.message);
    showAlert(alertBox, result.message, "success"); this.reset();
  });
}

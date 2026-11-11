/* Ken E-Test - auth.js
   Frontend session handling plus the login and registration forms.
   Note: this is simple academic-project authentication. The browser only keeps a
   session token; the real data and checks stay on the server (Python and MySQL). */

const Auth = {
  saveSession(role, token, user) {
    sessionStorage.setItem(CONFIG.SESSION_KEYS[role], JSON.stringify({ token: token, user: user }));
  },

  getSession(role) {
    try {
      const raw = sessionStorage.getItem(CONFIG.SESSION_KEYS[role]);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  },

  /* Call at the top of every protected page. Returns the user, or sends the visitor to login. */
  requireLogin(role) {
    const session = Auth.getSession(role);
    if (!session || !session.token) {
      window.location.replace("login.html");
      return null;
    }
    return session.user;
  },

  async logout(role) {
    await API.logout(role);
    sessionStorage.removeItem(CONFIG.SESSION_KEYS[role]);
    window.location.href = role === "admin" ? "login.html" : "index.html";
  }
};

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* ---------- Student login ---------- */
function initStudentLogin() {
  const form = document.getElementById("loginForm");
  const alertBox = document.getElementById("formAlert");
  const button = document.getElementById("loginButton");

  if (Auth.getSession("student")) {
    window.location.replace("dashboard.html");
    return;
  }
  if (getQueryParam("expired")) showAlert(alertBox, "Your session has expired. Please log in again.", "info");
  if (getQueryParam("registered")) showAlert(alertBox, "Account created. Log in to continue.", "success");

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    hideAlert(alertBox);
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;

    if (!email || !password) return showAlert(alertBox, "Enter your email and password.");
    if (!isValidEmail(email)) return showAlert(alertBox, "Enter a valid email address.");

    setButtonLoading(button, true, "Logging in...");
    const result = await API.loginStudent(email, password);
    setButtonLoading(button, false);

    if (!result.success) return showAlert(alertBox, result.message);
    Auth.saveSession("student", result.data.token, result.data.student);
    window.location.href = "dashboard.html";
  });
}

/* ---------- Student registration ---------- */
function initRegister() {
  const form = document.getElementById("registerForm");
  const alertBox = document.getElementById("formAlert");
  const button = document.getElementById("registerButton");

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    hideAlert(alertBox);

    const data = {
      full_name: form.elements.full_name.value.trim(),
      email: form.elements.email.value.trim(),
      password: form.elements.password.value,
      class: form.elements.class_name.value.trim()
    };

    if (data.full_name.length < 3) return showAlert(alertBox, "Enter your full name (at least 3 characters).");
    if (!isValidEmail(data.email)) return showAlert(alertBox, "Enter a valid email address.");
    if (data.password.length < 6) return showAlert(alertBox, "Password must be at least 6 characters.");
    if (data.password !== form.elements.confirm_password.value) return showAlert(alertBox, "The two passwords do not match.");
    if (!data.class) return showAlert(alertBox, "Enter your class.");

    setButtonLoading(button, true, "Creating account...");
    const result = await API.registerStudent(data);
    setButtonLoading(button, false);

    if (!result.success) return showAlert(alertBox, result.message);
    window.location.href = "login.html?registered=1";
  });
}

/* ---------- Admin login ---------- */
function initAdminLogin() {
  const form = document.getElementById("adminLoginForm");
  const alertBox = document.getElementById("formAlert");
  const button = document.getElementById("loginButton");

  if (Auth.getSession("admin")) {
    window.location.replace("dashboard.html");
    return;
  }
  if (getQueryParam("expired")) showAlert(alertBox, "Your session has expired. Please log in again.", "info");

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    hideAlert(alertBox);
    const username = form.elements.username.value.trim();
    const password = form.elements.password.value;

    if (!username || !password) return showAlert(alertBox, "Enter your username and password.");

    setButtonLoading(button, true, "Logging in...");
    const result = await API.loginAdmin(username, password);
    setButtonLoading(button, false);

    if (!result.success) return showAlert(alertBox, result.message);
    Auth.saveSession("admin", result.data.token, result.data.admin);
    window.location.href = "dashboard.html";
  });
}

/* ---------- Page start-up ---------- */
document.addEventListener("DOMContentLoaded", function () {
  const page = document.body.dataset.page;
  if (page === "login") initStudentLogin();
  if (page === "register") initRegister();
  if (page === "admin-login") initAdminLogin();

  // Any element with data-logout="student" or data-logout="admin" logs the user out.
  document.querySelectorAll("[data-logout]").forEach(function (element) {
    element.addEventListener("click", function () {
      Auth.logout(element.getAttribute("data-logout"));
    });
  });
});

/* Ken E-Test - config.js
   The only place that contains the backend URL.
   The backend is the Python (Flask) API at /api. Its address is worked out from the
   location of this file (js/config.js), so it is correct from every page (including the
   admin/ pages). Nothing needs to be edited here. */

function resolveApiUrl() {
  const script = document.currentScript;
  return script && script.src ? new URL("../api", script.src).href : "api";
}

const CONFIG = {
  API_URL: resolveApiUrl(),
  APP_NAME: "Ken E-Test",
  SESSION_KEYS: {
    student: "ken_student_session",
    admin: "ken_admin_session"
  }
};

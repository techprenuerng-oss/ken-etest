/* Ken E-Test - proctoring.js
   Basic Browser-Based Examination Monitoring.

   This is NOT AI proctoring and it cannot detect cheating with certainty.
   A determined person can bypass browser-based checks (for example with a second
   device). The goal is to discourage common shortcuts and keep a record for the
   examiner to review. */

const MAX_WARNINGS = 3;

/* When true, every recorded event counts as a warning.
   When false, only tab switches, fullscreen exits and window blur count;
   copy/paste/right-click/keyboard attempts are logged and shown as notices. */
const COUNT_MINOR_EVENTS = true;

/* The severity of each event is decided on the server (backend/proctoring.py). */
const EVENT_RULES = {
  TAB_SWITCH:           { minor: false, message: "You switched to another browser tab." },
  FULLSCREEN_EXIT:      { minor: false, message: "You exited fullscreen mode." },
  WINDOW_BLUR:          { minor: false, message: "The examination window lost focus." },
  COPY_ATTEMPT:         { minor: true,  message: "Copying is not allowed during the examination." },
  CUT_ATTEMPT:          { minor: true,  message: "Cutting is not allowed during the examination." },
  PASTE_ATTEMPT:        { minor: true,  message: "Pasting is not allowed during the examination." },
  RIGHT_CLICK:          { minor: true,  message: "Right-click is disabled during the examination." },
  KEYBOARD_RESTRICTION: { minor: true,  message: "That keyboard shortcut is not allowed during the examination." }
};

const Proctor = (function () {
  let examId = null;
  let active = false;          // true while an examination is running
  let maxReached = false;
  let warnings = 0;
  let callbacks = {};
  let lastCountedAt = 0;       // time of the last event that counted as a warning
  const lastEventAt = {};      // used to ignore the same event repeated within a moment

  const root = document.documentElement;
  const fullscreenSupported = !!(root.requestFullscreen || root.webkitRequestFullscreen) &&
    document.fullscreenEnabled !== false;

  function storageKey() {
    return "ken_warnings_" + examId;
  }

  function saveWarnings() {
    sessionStorage.setItem(storageKey(), String(warnings));
  }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function requestFullscreen() {
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!request) return Promise.resolve(false);
    try {
      return Promise.resolve(request.call(root)).then(function () { return true; }, function () { return false; });
    } catch (error) {
      return Promise.resolve(false);
    }
  }

  function exitFullscreen() {
    if (!isFullscreen()) return;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    try {
      if (exit) Promise.resolve(exit.call(document)).catch(function () {});
    } catch (error) { /* ignore */ }
  }

  /* Records one violation: send it to the backend, update the warning counter,
     and tell the exam page what to display. */
  function record(type, description) {
    if (!active || maxReached) return;
    const now = Date.now();
    if (lastEventAt[type] && now - lastEventAt[type] < 800) return;
    lastEventAt[type] = now;

    API.logProctoringEvent(examId, type, description);   // result is not needed

    const rule = EVENT_RULES[type];
    if (rule.minor && !COUNT_MINOR_EVENTS) {
      if (callbacks.onNotice) callbacks.onNotice(rule.message);
      return;
    }

    warnings++;
    lastCountedAt = now;
    saveWarnings();
    if (callbacks.onWarning) callbacks.onWarning({ count: warnings, max: MAX_WARNINGS, type: type, message: rule.message });

    if (warnings >= MAX_WARNINGS) {
      maxReached = true;
      API.logProctoringEvent(examId, "MAX_WARNINGS_REACHED", "Maximum number of warnings reached. The examination was submitted automatically.");
      if (callbacks.onMaxWarnings) callbacks.onMaxWarnings();
    }
  }

  /* ---------- Event listeners (added once, they only act while active) ---------- */

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      record("TAB_SWITCH", "The student switched to another browser tab or minimised the window.");
    }
  });

  window.addEventListener("blur", function () {
    // Wait a moment: a tab switch fires blur AND visibilitychange, but it should count once.
    setTimeout(function () {
      if (!active || document.visibilityState === "hidden") return;
      if (Date.now() - lastCountedAt < 1500) return;
      if (document.hasFocus()) return;
      record("WINDOW_BLUR", "The examination window lost focus.");
    }, 250);
  });

  function onFullscreenChange() {
    if (!active || !fullscreenSupported) return;
    if (isFullscreen()) {
      if (callbacks.onFullscreenRestored) callbacks.onFullscreenRestored();
    } else {
      record("FULLSCREEN_EXIT", "The student exited fullscreen mode.");
      if (callbacks.onFullscreenLost) callbacks.onFullscreenLost();
    }
  }
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);

  document.addEventListener("copy", function (event) {
    if (!active) return;
    event.preventDefault();
    record("COPY_ATTEMPT", "The student tried to copy examination content.");
  });

  document.addEventListener("cut", function (event) {
    if (!active) return;
    event.preventDefault();
    record("CUT_ATTEMPT", "The student tried to cut examination content.");
  });

  document.addEventListener("paste", function (event) {
    if (!active) return;
    event.preventDefault();
    record("PASTE_ATTEMPT", "The student tried to paste into the examination.");
  });

  document.addEventListener("contextmenu", function (event) {
    if (!active) return;
    event.preventDefault();
    record("RIGHT_CLICK", "Right-click was attempted during the examination.");
  });

  document.addEventListener("keydown", function (event) {
    if (!active) return;
    const key = String(event.key).toLowerCase();
    const withControl = event.ctrlKey || event.metaKey;
    let label = "";

    if (withControl && ["c", "x", "v", "u", "s", "p"].indexOf(key) !== -1) {
      label = (event.metaKey ? "Cmd+" : "Ctrl+") + key.toUpperCase();
    } else if (key === "f12") {
      label = "F12";
    } else if (withControl && event.shiftKey && ["i", "j", "c"].indexOf(key) !== -1) {
      label = "Ctrl+Shift+" + key.toUpperCase();
    }

    if (label) {
      event.preventDefault();
      event.stopPropagation();
      record("KEYBOARD_RESTRICTION", "Restricted keyboard shortcut used: " + label + ".");
    }
  }, true);

  /* ---------- Public methods ---------- */
  return {
    fullscreenSupported: fullscreenSupported,

    init: function (options) {
      examId = options.examId;
      callbacks = options;
      warnings = parseInt(sessionStorage.getItem(storageKey()) || "0", 10) || 0;
      maxReached = warnings >= MAX_WARNINGS;
    },
    start: function () { active = true; },
    stop: function () { active = false; },
    getWarnings: function () { return warnings; },
    clearSavedState: function () { sessionStorage.removeItem(storageKey()); },
    isFullscreen: isFullscreen,
    requestFullscreen: requestFullscreen,
    exitFullscreen: exitFullscreen
  };
})();

// Centralized API base for frontend calls.
// Default: same-origin (prevents localhost vs 127.0.0.1 token mismatch).

(function initApiConfig() {
  const FALLBACK_DEV_BASE = "http://127.0.0.1:5001";

  function computeDefaultBase() {
    try {
      // When served by Flask, always prefer same-origin.
      if (
        window.location &&
        (window.location.protocol === "http:" ||
          window.location.protocol === "https:")
      ) {
        return window.location.origin;
      }
    } catch {
      // ignore
    }
    // If opened as a local file (file://) or location is unavailable, fall back.
    return FALLBACK_DEV_BASE;
  }

  // Optional override (set before other scripts run):
  //   window.API_BASE = "http://127.0.0.1:5000";
  const defaultBase = computeDefaultBase();
  if (typeof window.API_BASE !== "string" || window.API_BASE.trim() === "") {
    // Bỏ qua computeDefaultBase, luôn dùng origin nếu có, không thì fallback 5001
    window.API_BASE = window.location.origin || "http://127.0.0.1:5001";
  }

  window.apiUrl = function apiUrl(path) {
    const base = String(window.API_BASE || defaultBase).replace(/\/+$/, "");
    const p = String(path || "");
    const normalized = p.startsWith("/") ? p : `/${p}`;
    return `${base}${normalized}`;
  };
})();

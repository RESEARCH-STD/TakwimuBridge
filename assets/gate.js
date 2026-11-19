/*
 * Opening gate. When accounts are switched on (assets/config.js), the
 * portal opens on the sign-in page (welcome.html): a visitor who is not
 * signed in, and hasn't chosen "Continue without an account" in this
 * browser session, is sent there before an app page draws. Signed-in
 * visitors who land on welcome.html go straight on to the app.
 *
 * Loaded synchronously in <head>, right after config.js, so the redirect
 * happens before anything paints. The check is a local one (is a Supabase
 * session stored in this browser?); assets/cloud.js does the real
 * verification once the page has loaded and calls TB_GATE.recheck() if
 * the stored session turns out to be gone.
 */
(function () {
  "use strict";

  var cfg = window.TB_CONFIG || {};
  var enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  var GUEST_COOKIE = "tb_guest";
  // Pages anyone may open without signing in or choosing to continue as a
  // guest. Every other page is an app page and goes through the gate.
  var PUBLIC = { welcome: true, account: true, guide: true, about: true, "404": true };

  function pageName() {
    var path = window.location.pathname.replace(/\/+$/, "/index");
    return (path.split("/").pop() || "index").replace(/\.html$/, "") || "index";
  }

  // supabase-js keeps the session in localStorage as "sb-<project>-auth-token".
  function hasSession() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!/^sb-.+-auth-token$/.test(key)) continue;
        var s = null;
        try { s = JSON.parse(localStorage.getItem(key)); } catch (e) { return true; }
        if (s && (s.refresh_token || s.access_token || (s.currentSession && s.currentSession.refresh_token))) return true;
      }
    } catch (e) { /* storage unavailable */ }
    return false;
  }

  function isGuest() {
    return document.cookie.split(/;\s*/).indexOf(GUEST_COOKIE + "=1") !== -1;
  }

  // Lasts until the browser is closed, across tabs, so the next visit
  // opens on the sign-in page again.
  function setGuest(on) {
    document.cookie = GUEST_COOKIE + "=" + (on ? "1" : "; max-age=0") + "; path=/; SameSite=Lax" +
      (window.location.protocol === "https:" ? "; Secure" : "");
  }

  // Links from Supabase emails (confirm account, reset password) come back
  // to the app with the result in the address. Successful ones are left
  // for cloud.js to finish; failed ones are shown on the sign-in page.
  function authLink() {
    var h = window.location.hash, q = window.location.search;
    if (/(^#|&)(error_description|error_code|error)=/.test(h) || /[?&](error_description|error_code)=/.test(q)) return "error";
    if (/(^#|&)access_token=/.test(h) || /[?&](code|token_hash)=/.test(q)) return "ok";
    return "";
  }

  // Only same-site paths, never back to the sign-in page itself.
  function safeNext(raw) {
    if (!raw || raw.charAt(0) !== "/" || /^\/[\/\\]/.test(raw) || /welcome(\.html)?([?#]|$)/.test(raw)) return "index.html";
    return raw;
  }

  function nextFromQuery() {
    return safeNext(new URLSearchParams(window.location.search).get("next"));
  }

  function go(url) {
    document.documentElement.style.visibility = "hidden";
    window.location.replace(url);
  }

  function signInUrl() {
    var page = pageName();
    var here = window.location.pathname + window.location.search + window.location.hash;
    return "welcome.html" + (page === "index" && !window.location.search ? "" : "?next=" + encodeURIComponent(here));
  }

  // True when this page should not be shown to the current visitor.
  function blocked() {
    return enabled && !PUBLIC[pageName()] && !hasSession() && !isGuest() && authLink() !== "ok";
  }

  function recheck() {
    if (blocked()) go(signInUrl());
  }

  window.TB_GATE = {
    enabled: enabled, hasSession: hasSession, isGuest: isGuest, setGuest: setGuest,
    authLink: authLink, next: nextFromQuery, recheck: recheck
  };

  if (!enabled) return;
  var page = pageName();
  if (page === "welcome") {
    if (hasSession() && authLink() !== "error") go(nextFromQuery());
    return;
  }
  if (PUBLIC[page]) return;
  if (authLink() === "error" && !hasSession()) { go("welcome.html" + window.location.search + window.location.hash); return; }
  recheck();
})();

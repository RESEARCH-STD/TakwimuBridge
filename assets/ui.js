/*
 * Shared UI pieces: the dashboard shell (sidebar active state, mobile
 * toggle, active-project card, account box), the sign-in dialog and sync
 * notices, the evidence drill-down modal, theme chips and the Themes /
 * Sub-themes / Codes level switch used on every analysis view. Depends on
 * assets/app.js (window.TB), assets/cloud.js and Bootstrap's JS bundle.
 */
(function () {
  "use strict";

  function esc(s) { return window.TB.escapeHtml(s); }

  // ------------------------------------------------------------- app shell
  // Compare resolved paths: hosts and preview servers may rewrite or drop
  // "index.html" / ".html" in links and URLs.
  function normalizePath(pathname) {
    return pathname.replace(/index\.html$/, "").replace(/\.html$/, "").replace(/\/+$/, "") || "/";
  }

  function refreshShell() {
    var TB = window.TB;
    var nameEl = document.getElementById("tb-sidebar-project-name");
    var metaEl = document.getElementById("tb-sidebar-project-meta");
    if (!nameEl) return;
    var p = TB.getActiveProject();
    nameEl.textContent = p ? p.title : "No project selected";
    nameEl.title = p ? p.title : "";
    if (metaEl) {
      metaEl.textContent = p
        ? p.sources.length + " sources · " + p.codings.length + " coded references"
        : "Open or create a project";
    }
  }

  // ------------------------------------------------------- cloud account
  function accountHtml(s) {
    if (!s.user) {
      var note = s.state === "connecting" ? "Connecting to your account…"
        : s.state === "unavailable" ? "Cloud sync can't be reached right now — working in this browser only."
        : "Saved in this browser only.";
      return '<i class="bi bi-cloud-slash"></i><span class="min-w-0">' + note +
        (s.state === "signed-out" ? '<button type="button" class="btn btn-sm btn-accent w-100 mt-2" id="tb-signin-btn"><i class="bi bi-person-circle me-1"></i>Sign in to sync</button>' +
          '<span class="d-block mt-1">Sign in to continue your projects on any computer.</span>' : "") +
        "</span>";
    }
    var line = {
      connecting: '<i class="bi bi-arrow-repeat tb-spin"></i> Connecting…',
      syncing: '<i class="bi bi-arrow-repeat tb-spin"></i> Saving to your account…',
      synced: '<i class="bi bi-cloud-check"></i> All changes saved to your account',
      pending: '<i class="bi bi-cloud-upload"></i> ' + s.pending + " change(s) waiting to sync",
      offline: '<i class="bi bi-wifi-off"></i> Offline — ' + s.pending + " change(s) will sync when you're back online",
      error: '<i class="bi bi-exclamation-triangle"></i> Sync problem — retrying shortly'
    }[s.state] || "";
    return '<i class="bi bi-person-circle"></i><span class="min-w-0">' +
      '<span class="tb-account-email" title="' + esc(s.user.email) + '">' + esc(s.user.email) + "</span>" +
      '<span class="tb-account-state" title="' + esc(s.state === "error" ? s.error : "") + '">' + line + "</span>" +
      '<button type="button" class="btn btn-link btn-sm p-0 tb-account-signout" id="tb-signout-btn">Sign out</button>' +
      "</span>";
  }

  function renderAccount(s) {
    var box = document.getElementById("tb-account");
    if (!box || !s.enabled) return;
    box.innerHTML = accountHtml(s);
    var signIn = document.getElementById("tb-signin-btn");
    if (signIn) signIn.addEventListener("click", function () { openAuth("signin"); });
    var signOut = document.getElementById("tb-signout-btn");
    if (signOut) signOut.addEventListener("click", function () {
      signOut.disabled = true;
      window.TB.cloud.signOut().then(function (done) {
        if (done) window.location.href = "index.html";
        else signOut.disabled = false;
      });
    });
  }

  var authEl = null;
  var authMode = "signin";
  var AUTH_TEXT = {
    signin: { title: "Sign in", submit: "Sign in", intro: "Sign in to keep your projects in your TakwimuBridge account and continue on any computer." },
    signup: { title: "Create your account", submit: "Create account", intro: "Your projects will be saved to this account and follow you to any computer you sign in on." },
    reset: { title: "Reset your password", submit: "Email me a reset link", intro: "Enter your account's email and we'll send a link to choose a new password." },
    recovery: { title: "Choose a new password", submit: "Save new password", intro: "Enter a new password for your account." }
  };

  function setAuthMode(mode) {
    authMode = mode;
    var t = AUTH_TEXT[mode];
    authEl.querySelector("#tb-auth-title").textContent = t.title;
    authEl.querySelector("#tb-auth-intro").textContent = t.intro;
    authEl.querySelector("#tb-auth-submit").textContent = t.submit;
    authEl.querySelector("#tb-auth-tabs").classList.toggle("d-none", mode === "reset" || mode === "recovery");
    authEl.querySelector('[data-field="email"]').classList.toggle("d-none", mode === "recovery");
    authEl.querySelector('[data-field="password"]').classList.toggle("d-none", mode === "reset");
    authEl.querySelector('[data-field="confirm"]').classList.toggle("d-none", mode !== "signup" && mode !== "recovery");
    authEl.querySelector("#tb-auth-forgot").classList.toggle("d-none", mode !== "signin");
    authEl.querySelector("#tb-auth-back").classList.toggle("d-none", mode !== "reset");
    authEl.querySelector("#tb-auth-password").setAttribute("autocomplete", mode === "signin" ? "current-password" : "new-password");
    var radio = authEl.querySelector('input[name="tbAuthMode"][value="' + mode + '"]');
    if (radio) radio.checked = true;
    showAuthMessage("", "");
  }

  function showAuthMessage(kind, text) {
    var msg = authEl.querySelector("#tb-auth-msg");
    msg.className = "alert small py-2" + (text ? " alert-" + kind : " d-none");
    msg.textContent = text;
  }

  function ensureAuthModal() {
    if (authEl) return authEl;
    authEl = document.createElement("div");
    authEl.className = "modal fade";
    authEl.id = "tb-modal-auth";
    authEl.tabIndex = -1;
    authEl.innerHTML =
      '<div class="modal-dialog modal-dialog-centered"><div class="modal-content">' +
      '<div class="modal-header"><h5 class="modal-title" id="tb-auth-title">Sign in</h5>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>' +
      '<form class="modal-body" id="tb-auth-form" novalidate>' +
      '<p class="small text-muted" id="tb-auth-intro"></p>' +
      '<div class="btn-group w-100 mb-3 tb-segmented" role="group" id="tb-auth-tabs" aria-label="Sign in or create an account">' +
      '<input type="radio" class="btn-check" name="tbAuthMode" id="tb-auth-mode-signin" value="signin" checked>' +
      '<label class="btn btn-outline-primary" for="tb-auth-mode-signin">Sign in</label>' +
      '<input type="radio" class="btn-check" name="tbAuthMode" id="tb-auth-mode-signup" value="signup">' +
      '<label class="btn btn-outline-primary" for="tb-auth-mode-signup">Create account</label></div>' +
      '<div class="mb-2" data-field="email"><label class="form-label small mb-1" for="tb-auth-email">Email</label>' +
      '<input type="email" class="form-control" id="tb-auth-email" autocomplete="email"></div>' +
      '<div class="mb-2" data-field="password"><label class="form-label small mb-1" for="tb-auth-password">Password</label>' +
      '<input type="password" class="form-control" id="tb-auth-password" autocomplete="current-password"></div>' +
      '<div class="mb-2 d-none" data-field="confirm"><label class="form-label small mb-1" for="tb-auth-confirm">Repeat password</label>' +
      '<input type="password" class="form-control" id="tb-auth-confirm" autocomplete="new-password"></div>' +
      '<div class="alert small py-2 d-none" id="tb-auth-msg" role="alert"></div>' +
      '<button type="submit" class="btn btn-primary w-100 mt-1" id="tb-auth-submit">Sign in</button>' +
      '<div class="text-center mt-2"><button type="button" class="btn btn-link btn-sm" id="tb-auth-forgot">Forgot password?</button>' +
      '<button type="button" class="btn btn-link btn-sm d-none" id="tb-auth-back">Back to sign in</button></div>' +
      "</form></div></div>";
    document.body.appendChild(authEl);

    Array.prototype.forEach.call(authEl.querySelectorAll('input[name="tbAuthMode"]'), function (r) {
      r.addEventListener("change", function () { setAuthMode(r.value); });
    });
    authEl.querySelector("#tb-auth-forgot").addEventListener("click", function () { setAuthMode("reset"); });
    authEl.querySelector("#tb-auth-back").addEventListener("click", function () { setAuthMode("signin"); });
    authEl.querySelector("#tb-auth-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = authEl.querySelector("#tb-auth-email").value.trim();
      var pw = authEl.querySelector("#tb-auth-password").value;
      var pw2 = authEl.querySelector("#tb-auth-confirm").value;
      var mode = authMode;
      if (mode !== "recovery" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAuthMessage("danger", "Enter a valid email address."); return; }
      if (mode !== "reset" && pw.length < 8) { showAuthMessage("danger", "Passwords need at least 8 characters."); return; }
      if ((mode === "signup" || mode === "recovery") && pw !== pw2) { showAuthMessage("danger", "The two passwords don't match."); return; }
      var submit = authEl.querySelector("#tb-auth-submit");
      submit.disabled = true;
      showAuthMessage("secondary", mode === "signin" || mode === "signup" ? "Connecting and syncing your projects…" : "Working…");
      var cloud = window.TB.cloud;
      var op = mode === "signin" ? cloud.signIn(email, pw)
        : mode === "signup" ? cloud.signUp(email, pw)
        : mode === "reset" ? cloud.sendReset(email)
        : cloud.updatePassword(pw);
      op.then(function (res) {
        submit.disabled = false;
        if (mode === "signup" && res && res.needsConfirmation) {
          showAuthMessage("success", "Almost done — we've emailed a confirmation link to " + email + ". Open it to finish; you'll be signed in.");
        } else if (mode === "reset") {
          showAuthMessage("success", "If an account exists for " + email + ", a reset link is on its way.");
        } else if (mode === "recovery") {
          showAuthMessage("success", "Password updated — you're signed in.");
          setTimeout(function () { window.location.reload(); }, 900);
        } else {
          window.location.reload();
        }
      }, function (err) {
        submit.disabled = false;
        showAuthMessage("danger", err.message);
      });
    });
    return authEl;
  }

  function openAuth(mode) {
    ensureAuthModal();
    setAuthMode(mode || "signin");
    window.bootstrap.Modal.getOrCreateInstance(authEl).show();
  }

  function simpleModal(id, title, bodyHtml, buttons, isStatic) {
    var old = document.getElementById(id);
    if (old) old.remove();
    var el = document.createElement("div");
    el.className = "modal fade";
    el.id = id;
    el.tabIndex = -1;
    if (isStatic) { el.setAttribute("data-bs-backdrop", "static"); el.setAttribute("data-bs-keyboard", "false"); }
    el.innerHTML = '<div class="modal-dialog modal-dialog-centered"><div class="modal-content">' +
      '<div class="modal-header"><h5 class="modal-title">' + esc(title) + "</h5></div>" +
      '<div class="modal-body">' + bodyHtml + "</div>" +
      '<div class="modal-footer">' + buttons.map(function (b, i) {
        return '<button type="button" class="btn ' + b.cls + '" data-i="' + i + '">' + esc(b.label) + "</button>";
      }).join("") + "</div></div></div>";
    document.body.appendChild(el);
    var modal = window.bootstrap.Modal.getOrCreateInstance(el);
    Array.prototype.forEach.call(el.querySelectorAll(".modal-footer button"), function (btn) {
      btn.addEventListener("click", function () {
        modal.hide();
        buttons[Number(btn.getAttribute("data-i"))].onClick();
      });
    });
    modal.show();
    return el;
  }

  function showImportPrompt(projects) {
    var ids = projects.map(function (p) { return p.id; });
    simpleModal("tb-modal-import", "Add this browser's projects to your account?",
      '<p class="mb-2">These projects are only saved in this browser:</p><ul class="mb-2">' +
      projects.map(function (p) { return "<li>" + esc(p.title) + "</li>"; }).join("") + "</ul>" +
      '<p class="small text-muted mb-0">Add them to reach them from any computer you sign in on, or keep them here only — on a shared computer, keep them here only if they aren\'t yours.</p>',
      [
        { label: "Keep on this browser only", cls: "btn-outline-secondary", onClick: function () { window.TB.cloud.keepLocal(ids); } },
        { label: "Add to my account", cls: "btn-primary", onClick: function () { window.TB.cloud.adopt(ids); setTimeout(function () { window.location.reload(); }, 1500); } }
      ]);
  }

  var conflicts = [];
  var conflictTimer = null;
  function queueConflict(c) {
    conflicts.push(c);
    clearTimeout(conflictTimer);
    conflictTimer = setTimeout(function () {
      var list = conflicts.splice(0);
      simpleModal("tb-modal-conflict", "Changed on another computer",
        list.map(function (c) {
          return '<p>&ldquo;' + esc(c.title) + '&rdquo; was also edited on another computer since this browser last synced. Nothing is lost: your account\'s version is kept, and the edits made here are saved as a separate project, &ldquo;' + esc(c.copyTitle) + "&rdquo;.</p>";
        }).join("") + '<p class="small text-muted mb-0">Reload to continue with the latest version.</p>',
        [{ label: "Reload", cls: "btn-primary", onClick: function () { window.location.reload(); } }], true);
    }, 200);
  }

  function floatingAlert(id, html, kind) {
    var old = document.getElementById(id);
    if (old) old.remove();
    var div = document.createElement("div");
    div.id = id;
    div.className = "alert alert-" + kind + " d-flex align-items-center gap-2 shadow tb-floating-alert";
    div.setAttribute("role", "status");
    div.innerHTML = html;
    document.body.appendChild(div);
    return div;
  }

  function showRemoteChange() {
    var div = floatingAlert("tb-remote-banner",
      '<i class="bi bi-cloud-arrow-down"></i><span class="flex-grow-1">This project was updated on another computer.</span>' +
      '<button type="button" class="btn btn-sm btn-primary">Reload</button>', "info");
    div.querySelector("button").addEventListener("click", function () { window.location.reload(); });
  }

  function showRestored(r) {
    var div = floatingAlert("tb-restored-banner",
      '<i class="bi bi-arrow-counterclockwise"></i><span class="flex-grow-1">&ldquo;' + esc(r.title) +
      "&rdquo; was changed on another computer, so it wasn't deleted.</span>" +
      '<button type="button" class="btn-close" aria-label="Dismiss"></button>', "warning");
    div.querySelector(".btn-close").addEventListener("click", function () { div.remove(); });
  }

  function initAccount() {
    var cloud = window.TB.cloud;
    if (!cloud || !cloud.enabled()) return;
    renderAccount(cloud.status());
    cloud.on("status", renderAccount);
    cloud.on("importNeeded", showImportPrompt);
    cloud.on("conflict", queueConflict);
    cloud.on("remoteChange", showRemoteChange);
    cloud.on("restored", showRestored);
    cloud.on("recovery", function () { openAuth("recovery"); });
  }

  function initShell() {
    initAccount();
    var sidebar = document.getElementById("tb-sidebar");
    if (!sidebar) return;
    var page = normalizePath(location.pathname);
    Array.prototype.forEach.call(sidebar.querySelectorAll(".tb-nav-link"), function (a) {
      if (normalizePath(new URL(a.href, location.href).pathname) === page) {
        a.classList.add("active");
        a.setAttribute("aria-current", "page");
      }
    });
    function setOpen(open) {
      document.body.classList.toggle("tb-sidebar-open", open);
      var toggle = document.getElementById("tb-sidebar-toggle");
      if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
    var toggle = document.getElementById("tb-sidebar-toggle");
    if (toggle) toggle.addEventListener("click", function () { setOpen(!document.body.classList.contains("tb-sidebar-open")); });
    var backdrop = document.getElementById("tb-sidebar-backdrop");
    if (backdrop) backdrop.addEventListener("click", function () { setOpen(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") setOpen(false); });
    window.TB.whenReady(function () {
      if (window.TB.seedDemoIfNeeded) window.TB.seedDemoIfNeeded();
      refreshShell();
    });
  }

  // ----------------------------------------------------------- theme chips
  function themeChip(project, themeId) {
    var t = window.TB.themeById(project, themeId);
    if (!t) return "";
    return '<span class="tb-chip-static" style="--chip-color:' + esc(window.TB.safeColor(t.color)) + '" title="' +
      esc(window.TB.themePath(project, t.id)) + '"><span class="dot"></span>' + esc(t.name) + "</span>";
  }
  function themeChips(project, themeIds) {
    var order = {};
    window.TB.themesInTreeOrder(project).forEach(function (t, i) { order[t.id] = i; });
    return (themeIds || []).slice().sort(function (a, b) { return (order[a] || 0) - (order[b] || 0); })
      .map(function (id) { return themeChip(project, id); }).join("");
  }

  // -------------------------------------------------------- evidence modal
  var evidenceEl = null;
  function ensureEvidenceModal() {
    if (evidenceEl) return evidenceEl;
    evidenceEl = document.createElement("div");
    evidenceEl.className = "modal fade";
    evidenceEl.id = "tb-modal-evidence";
    evidenceEl.tabIndex = -1;
    evidenceEl.innerHTML =
      '<div class="modal-dialog modal-lg modal-dialog-scrollable"><div class="modal-content">' +
      '<div class="modal-header"><div><h5 class="modal-title" id="tb-evidence-title">Evidence</h5>' +
      '<div class="small text-muted" id="tb-evidence-sub"></div></div>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>' +
      '<div class="modal-body" id="tb-evidence-list"></div></div></div>';
    document.body.appendChild(evidenceEl);
    return evidenceEl;
  }

  function showEvidence(project, title, list) {
    var el = ensureEvidenceModal();
    el.querySelector("#tb-evidence-title").textContent = title;
    el.querySelector("#tb-evidence-sub").textContent = list.length + " coded reference" + (list.length === 1 ? "" : "s");
    el.querySelector("#tb-evidence-list").innerHTML = list.length ? list.map(function (e) {
      var who = e.respondentLabel && e.respondentLabel !== e.sourceName ? " — " + esc(e.respondentLabel) : "";
      return '<div class="tb-evidence-quote">&ldquo;' + esc(e.quote) + "&rdquo;" +
        '<div class="mt-1">' + themeChips(project, e.coding.themeIds) + "</div>" +
        '<div class="text-muted small mt-1">' + esc(e.sourceName) + who +
        (e.weight !== null && e.weight !== undefined ? ' · weight ' + e.weight + "/10" : "") +
        (e.memo ? " · <em>" + esc(e.memo) + "</em>" : "") +
        ' · <a href="workspace.html?source=' + encodeURIComponent(e.coding.sourceId) + "&amp;coding=" +
        encodeURIComponent(e.coding.id) + '">Open in transcript</a></div></div>';
    }).join("") : '<p class="text-muted mb-0">No coded references yet.</p>';
    window.bootstrap.Modal.getOrCreateInstance(el).show();
  }

  function showThemeEvidence(project, themeId, respondentId) {
    var TB = window.TB;
    var list = TB.evidenceForTheme(project, themeId);
    var title = TB.themePath(project, themeId);
    if (respondentId) {
      list = list.filter(function (e) { return TB.respondentIdForCoding(e.coding) === respondentId; });
      var r = TB.respondentsOf(project).find(function (r) { return r.id === respondentId; });
      if (r) title += " — " + r.label;
    }
    showEvidence(project, title, list);
  }

  // ------------------------------------------------------ level switch
  // Renders Themes / Sub-themes / Codes radio buttons into `container`;
  // hidden when the codebook has only one level. Returns the level in use.
  function levelControl(container, project, opts) {
    var levels = window.TB.levelOptions(project);
    var value = Math.min(opts.value || 0, levels.length - 1);
    container.innerHTML = '<div class="btn-group btn-group-sm tb-segmented" role="group" aria-label="Analysis level">' +
      levels.map(function (l) {
        var id = opts.name + "-" + l.value;
        return '<input type="radio" class="btn-check" name="' + opts.name + '" id="' + id + '" value="' + l.value + '"' +
          (l.value === value ? " checked" : "") + '><label class="btn btn-outline-primary" for="' + id + '">' + l.label + "</label>";
      }).join("") + "</div>";
    var group = container.closest(".tb-toolbar-group") || container;
    group.classList.toggle("d-none", levels.length < 2);
    Array.prototype.forEach.call(container.querySelectorAll("input"), function (inp) {
      inp.addEventListener("change", function () { opts.onChange(Number(inp.value)); });
    });
    return value;
  }

  function relativeTime(ts) {
    if (!ts) return "";
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    var m = Math.round(s / 60);
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60);
    if (h < 24) return h + " h ago";
    var d = Math.round(h / 24);
    if (d < 30) return d + " day" + (d === 1 ? "" : "s") + " ago";
    return new Date(ts).toLocaleDateString();
  }

  document.addEventListener("DOMContentLoaded", initShell);

  window.TB = window.TB || {};
  window.TB.ui = {
    refreshShell: refreshShell, openAuth: openAuth, themeChip: themeChip, themeChips: themeChips,
    showEvidence: showEvidence, showThemeEvidence: showThemeEvidence,
    levelControl: levelControl, relativeTime: relativeTime
  };
})();

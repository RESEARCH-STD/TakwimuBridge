/*
 * Shared UI pieces: the dashboard shell (sidebar active state, mobile
 * toggle, active-project card, account box), the sign-in form (dialog and
 * My Account page) and sync notices, the create/edit project dialog, the
 * evidence drill-down modal, theme chips, toasts, and the analysis / level
 * selectors used on every analysis view. Depends on assets/app.js
 * (window.TB), assets/cloud.js and Bootstrap's JS bundle.
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

  // ---------------------------------------------------------------- toast
  // A short notice at the bottom of the screen, optionally with one action
  // (e.g. "Undo").
  var toastTimer = null;
  function toast(message, opts) {
    opts = opts || {};
    var el = document.getElementById("tb-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "tb-toast";
      el.className = "tb-toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    el.innerHTML = '<span class="tb-toast-msg"></span>' +
      (opts.action ? '<button type="button" class="tb-toast-action"></button>' : "") +
      '<button type="button" class="tb-toast-close" aria-label="Dismiss"><i class="bi bi-x-lg"></i></button>';
    el.querySelector(".tb-toast-msg").textContent = message;
    if (opts.action) {
      var btn = el.querySelector(".tb-toast-action");
      btn.textContent = opts.action.label;
      btn.addEventListener("click", function () { hideToast(); opts.action.onClick(); });
    }
    el.querySelector(".tb-toast-close").addEventListener("click", hideToast);
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, opts.duration || 7000);
  }
  function hideToast() {
    var el = document.getElementById("tb-toast");
    if (el) el.classList.remove("show");
  }

  // ------------------------------------------------------- cloud account
  function accountHtml(s) {
    if (!s.user) {
      if (s.state === "connecting") {
        return '<div class="tb-account-head"><i class="bi bi-arrow-repeat tb-spin"></i> Connecting to your account…</div>';
      }
      if (s.state === "unavailable") {
        return '<div class="tb-account-head"><i class="bi bi-cloud-slash"></i> Accounts can\'t be reached right now — working in this browser only.</div>';
      }
      return '<div class="tb-account-head"><i class="bi bi-cloud-slash"></i> Not signed in — saved in this browser only</div>' +
        '<div class="tb-account-actions">' +
        '<button type="button" class="btn btn-sm btn-accent" id="tb-signup-btn">Create account</button>' +
        '<button type="button" class="btn btn-sm btn-outline-light" id="tb-signin-btn">Sign in</button></div>' +
        '<div class="tb-account-hint">Free. Keeps your projects safe online so you can carry on from any computer.</div>';
    }
    var line = {
      connecting: '<i class="bi bi-arrow-repeat tb-spin"></i> Connecting…',
      syncing: '<i class="bi bi-arrow-repeat tb-spin"></i> Saving to your account…',
      synced: '<i class="bi bi-cloud-check"></i> All changes saved to your account',
      pending: '<i class="bi bi-cloud-upload"></i> ' + s.pending + " change(s) waiting to sync",
      offline: '<i class="bi bi-wifi-off"></i> Offline — ' + s.pending + " change(s) will sync when you're back online",
      error: '<i class="bi bi-exclamation-triangle"></i> Sync problem — retrying shortly'
    }[s.state] || "";
    return '<a class="tb-account-user" href="account.html" title="My account">' +
      '<span class="tb-avatar">' + esc((s.user.email || "?").charAt(0).toUpperCase()) + "</span>" +
      '<span class="min-w-0"><span class="tb-account-email">' + esc(s.user.email) + "</span>" +
      '<span class="tb-account-state" title="' + esc(s.state === "error" ? s.error : "") + '">' + line + "</span></span></a>" +
      '<button type="button" class="btn btn-link btn-sm p-0 tb-account-signout" id="tb-signout-btn">Sign out</button>';
  }

  function signOutNow(btn) {
    if (btn) btn.disabled = true;
    window.TB.cloud.signOut().then(function (done) {
      if (done) window.location.href = "index.html";
      else if (btn) btn.disabled = false;
    });
  }

  function renderAccount(s) {
    var box = document.getElementById("tb-account");
    if (!box || !s.enabled) return;
    box.classList.remove("d-none");
    var note = document.getElementById("tb-sidebar-note");
    if (note) note.classList.add("d-none");
    box.innerHTML = accountHtml(s);
    var signIn = document.getElementById("tb-signin-btn");
    if (signIn) signIn.addEventListener("click", function () { openAuth("signin"); });
    var signUp = document.getElementById("tb-signup-btn");
    if (signUp) signUp.addEventListener("click", function () { openAuth("signup"); });
    var signOut = document.getElementById("tb-signout-btn");
    if (signOut) signOut.addEventListener("click", function () { signOutNow(signOut); });
  }

  // ------------------------------------------------------------ auth form
  // One form, used in the sign-in dialog (prefix "tb-auth") and on the
  // My Account page; ids are prefixed so both can exist on one page.
  var AUTH_TEXT = {
    signin: { title: "Sign in", submit: "Sign in", intro: "Sign in to keep your projects in your TakwimuBridge account and continue on any computer." },
    signup: { title: "Create your account", submit: "Create account", intro: "Anyone can create a free account. Your projects are saved to it and follow you to any computer you sign in on — no one else can see them." },
    reset: { title: "Reset your password", submit: "Email me a reset link", intro: "Enter your account's email and we'll send a link to choose a new password." },
    recovery: { title: "Choose a new password", submit: "Save new password", intro: "Enter a new password for your account." }
  };

  function authFormHtml(p) {
    var name = p.replace(/[^a-z]/gi, "") + "Mode";
    return '<form id="' + p + '-form" novalidate>' +
      '<p class="small text-muted" id="' + p + '-intro"></p>' +
      '<div class="btn-group w-100 mb-3 tb-segmented" role="group" id="' + p + '-tabs" aria-label="Sign in or create an account">' +
      '<input type="radio" class="btn-check" name="' + name + '" id="' + p + '-mode-signin" value="signin" checked>' +
      '<label class="btn btn-outline-primary" for="' + p + '-mode-signin">Sign in</label>' +
      '<input type="radio" class="btn-check" name="' + name + '" id="' + p + '-mode-signup" value="signup">' +
      '<label class="btn btn-outline-primary" for="' + p + '-mode-signup">Create account</label></div>' +
      '<div class="mb-2" data-field="email"><label class="form-label small mb-1" for="' + p + '-email">Email</label>' +
      '<input type="email" class="form-control" id="' + p + '-email" autocomplete="email"></div>' +
      '<div class="mb-2" data-field="password"><label class="form-label small mb-1" for="' + p + '-password">Password</label>' +
      '<input type="password" class="form-control" id="' + p + '-password" autocomplete="current-password">' +
      '<div class="form-text d-none" id="' + p + '-pw-hint">At least 8 characters.</div></div>' +
      '<div class="mb-2 d-none" data-field="confirm"><label class="form-label small mb-1" for="' + p + '-confirm">Repeat password</label>' +
      '<input type="password" class="form-control" id="' + p + '-confirm" autocomplete="new-password"></div>' +
      '<div class="alert small py-2 d-none" id="' + p + '-msg" role="alert"></div>' +
      '<button type="button" class="btn btn-link btn-sm p-0 mb-2 d-none" id="' + p + '-resend">Resend the confirmation email</button>' +
      '<button type="submit" class="btn btn-primary w-100 mt-1" id="' + p + '-submit">Sign in</button>' +
      '<div class="text-center mt-2"><button type="button" class="btn btn-link btn-sm" id="' + p + '-forgot">Forgot password?</button>' +
      '<button type="button" class="btn btn-link btn-sm d-none" id="' + p + '-back">Back to sign in</button></div>' +
      "</form>";
  }

  function wireAuthForm(root, p, onMode) {
    var mode = "signin";
    function q(id) { return root.querySelector("#" + p + "-" + id); }
    function field(name) { return root.querySelector('[data-field="' + name + '"]'); }
    function message(kind, text) {
      var msg = q("msg");
      msg.className = "alert small py-2" + (text ? " alert-" + kind : " d-none");
      msg.textContent = text;
    }
    function setMode(m) {
      mode = m;
      var t = AUTH_TEXT[m];
      q("intro").textContent = t.intro;
      q("submit").textContent = t.submit;
      q("tabs").classList.toggle("d-none", m === "reset" || m === "recovery");
      field("email").classList.toggle("d-none", m === "recovery");
      field("password").classList.toggle("d-none", m === "reset");
      field("confirm").classList.toggle("d-none", m !== "signup" && m !== "recovery");
      q("pw-hint").classList.toggle("d-none", m !== "signup" && m !== "recovery");
      q("forgot").classList.toggle("d-none", m !== "signin");
      q("back").classList.toggle("d-none", m !== "reset");
      q("resend").classList.add("d-none");
      q("password").setAttribute("autocomplete", m === "signin" ? "current-password" : "new-password");
      var radio = q("mode-" + m);
      if (radio) radio.checked = true;
      message("", "");
      if (onMode) onMode(m, t.title);
    }
    Array.prototype.forEach.call(root.querySelectorAll("#" + p + "-tabs input"), function (r) {
      r.addEventListener("change", function () { setMode(r.value); });
    });
    q("forgot").addEventListener("click", function () { setMode("reset"); });
    q("back").addEventListener("click", function () { setMode("signin"); });
    q("resend").addEventListener("click", function () {
      var email = q("email").value.trim();
      q("resend").disabled = true;
      window.TB.cloud.resendConfirmation(email).then(function () {
        q("resend").disabled = false;
        message("success", "A new confirmation link is on its way to " + email + ". Check your spam folder too.");
      }, function (err) {
        q("resend").disabled = false;
        message("danger", err.message);
      });
    });
    q("form").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = q("email").value.trim();
      var pw = q("password").value;
      var pw2 = q("confirm").value;
      var m = mode;
      if (m !== "recovery" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { message("danger", "Enter a valid email address."); return; }
      if (m !== "reset" && pw.length < 8) { message("danger", "Passwords need at least 8 characters."); return; }
      if ((m === "signup" || m === "recovery") && pw !== pw2) { message("danger", "The two passwords don't match."); return; }
      var submit = q("submit");
      submit.disabled = true;
      q("resend").classList.add("d-none");
      message("secondary", m === "signin" || m === "signup" ? "Connecting and syncing your projects…" : "Working…");
      var cloud = window.TB.cloud;
      var op = m === "signin" ? cloud.signIn(email, pw)
        : m === "signup" ? cloud.signUp(email, pw)
        : m === "reset" ? cloud.sendReset(email)
        : cloud.updatePassword(pw);
      op.then(function (res) {
        submit.disabled = false;
        if (m === "signup" && res && res.needsConfirmation) {
          message("success", "Almost done — we've emailed a confirmation link to " + email + ". Open it to finish; you'll be signed in. (Check your spam folder too.)");
          q("resend").classList.remove("d-none");
        } else if (m === "reset") {
          message("success", "If an account exists for " + email + ", a reset link is on its way.");
        } else if (m === "recovery") {
          message("success", "Password updated — you're signed in.");
          setTimeout(function () { window.location.reload(); }, 900);
        } else {
          window.location.reload();
        }
      }, function (err) {
        submit.disabled = false;
        message("danger", err.message);
        if (err.code === "email_not_confirmed") q("resend").classList.remove("d-none");
      });
    });
    return { setMode: setMode };
  }

  var authEl = null;
  var authForm = null;
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
      '<div class="modal-body">' + authFormHtml("tb-auth") + "</div></div></div>";
    document.body.appendChild(authEl);
    authForm = wireAuthForm(authEl, "tb-auth", function (m, title) {
      authEl.querySelector("#tb-auth-title").textContent = title;
    });
    return authEl;
  }

  function openAuth(mode) {
    ensureAuthModal();
    authForm.setMode(mode || "signin");
    window.bootstrap.Modal.getOrCreateInstance(authEl).show();
  }

  // ---------------------------------------------------- My Account page
  function mountAccountPage(el) {
    var cloud = window.TB.cloud;
    function draw(s) {
      if (!cloud || !s.enabled) {
        el.innerHTML = '<div class="card"><div class="card-body">' +
          '<h2 class="h5">Accounts aren\'t switched on for this site</h2>' +
          '<p class="text-muted mb-0">Your projects are saved in this browser only. Use <a href="export.html">Export → Full Project Backup</a> to move a project to another computer.</p></div></div>';
        return;
      }
      if (s.state === "connecting") {
        el.innerHTML = '<div class="card"><div class="card-body text-muted"><i class="bi bi-arrow-repeat tb-spin"></i> Connecting to your account…</div></div>';
        return;
      }
      if (!s.user) {
        if (el.querySelector("#tb-acct-form")) return;
        el.innerHTML = '<div class="grid gap-4">' +
          '<div class="g-col-12 g-col-lg-6"><div class="card h-100"><div class="card-body">' +
          '<h2 class="h5" id="tb-acct-title">Create your account</h2>' + authFormHtml("tb-acct") + "</div></div></div>" +
          '<div class="g-col-12 g-col-lg-6"><div class="card h-100"><div class="card-body">' +
          '<h2 class="h5">Why have an account?</h2><ul class="mb-3">' +
          "<li>Your projects are saved online as you work, not only in this browser.</li>" +
          "<li>Sign in on any computer — at the office, at home, in a training room — and carry on where you left off.</li>" +
          "<li>Each researcher has their own account; nobody else can see your projects.</li>" +
          "<li>On a shared computer, signing out removes your projects from it.</li></ul>" +
          '<p class="small text-muted mb-0">' + (s.state === "unavailable"
            ? "The account service can't be reached right now — check your internet connection and reload."
            : "Without an account TakwimuBridge still works, but projects stay in the browser you used.") + "</p>" +
          "</div></div></div></div>";
        var form = wireAuthForm(el, "tb-acct", function (m, title) { el.querySelector("#tb-acct-title").textContent = title; });
        form.setMode(new URLSearchParams(window.location.search).get("mode") === "signin" ? "signin" : "signup");
        return;
      }
      var inAccount = window.TB.listProjects().filter(function (p) { return cloud.syncState(p.id) === "cloud"; }).length;
      var stateText = { synced: "All changes saved", syncing: "Saving…", pending: s.pending + " change(s) waiting", offline: "Offline — changes will sync later", error: "Sync problem — retrying" }[s.state] || s.state;
      el.innerHTML = '<div class="grid gap-4">' +
        '<div class="g-col-12 g-col-lg-6"><div class="card h-100"><div class="card-body">' +
        '<div class="d-flex align-items-center gap-3 mb-3"><span class="tb-avatar lg">' + esc(s.user.email.charAt(0).toUpperCase()) + "</span>" +
        '<div class="min-w-0"><div class="tb-eyebrow">Signed in as</div><div class="fw-semibold text-truncate" id="tb-acct-email">' + esc(s.user.email) + "</div></div></div>" +
        '<p class="mb-1"><i class="bi bi-cloud-check text-accent"></i> ' + esc(stateText) + "</p>" +
        '<p class="text-muted small">' + inAccount + " project(s) in your account. Sign in with this email on any computer to open them.</p>" +
        '<button type="button" class="btn btn-outline-danger" id="tb-acct-signout"><i class="bi bi-box-arrow-right me-1"></i>Sign out of this computer</button>' +
        "</div></div></div>" +
        '<div class="g-col-12 g-col-lg-6"><div class="card h-100"><div class="card-body">' +
        '<h2 class="h5">Change password</h2>' +
        '<form id="tb-acct-pw-form" novalidate>' +
        '<div class="mb-2"><label class="form-label small mb-1" for="tb-acct-pw">New password</label><input type="password" class="form-control" id="tb-acct-pw" autocomplete="new-password"></div>' +
        '<div class="mb-2"><label class="form-label small mb-1" for="tb-acct-pw2">Repeat new password</label><input type="password" class="form-control" id="tb-acct-pw2" autocomplete="new-password"></div>' +
        '<div class="alert small py-2 d-none" id="tb-acct-pw-msg" role="alert"></div>' +
        '<button type="submit" class="btn btn-primary">Save new password</button></form>' +
        "</div></div></div></div>";
      el.querySelector("#tb-acct-signout").addEventListener("click", function (e) { signOutNow(e.currentTarget); });
      el.querySelector("#tb-acct-pw-form").addEventListener("submit", function (e) {
        e.preventDefault();
        var msg = el.querySelector("#tb-acct-pw-msg");
        function show(kind, text) { msg.className = "alert small py-2 alert-" + kind; msg.textContent = text; }
        var pw = el.querySelector("#tb-acct-pw").value, pw2 = el.querySelector("#tb-acct-pw2").value;
        if (pw.length < 8) { show("danger", "Passwords need at least 8 characters."); return; }
        if (pw !== pw2) { show("danger", "The two passwords don't match."); return; }
        cloud.updatePassword(pw).then(function () { show("success", "Password changed."); e.target.reset(); },
          function (err) { show("danger", err.message); });
      });
    }
    draw(cloud ? cloud.status() : { enabled: false });
    if (cloud && cloud.enabled()) cloud.on("status", draw);
  }

  // A reminder on the dashboard for visitors who haven't signed in.
  function mountSignupBanner(el) {
    var cloud = window.TB.cloud;
    if (!el || !cloud || !cloud.enabled()) return;
    var dismissed = false;
    try { dismissed = sessionStorage.getItem("tb_signup_banner_hidden") === "1"; } catch (e) { /* storage unavailable */ }
    function draw(s) {
      if (dismissed || s.user || s.state !== "signed-out") { el.innerHTML = ""; return; }
      el.innerHTML = '<div class="alert tb-signup-banner d-flex flex-wrap align-items-center gap-2 mb-4" role="note">' +
        '<i class="bi bi-person-plus fs-5"></i>' +
        '<span class="flex-grow-1"><strong>Create your own free account</strong> to keep your projects safe online and continue on any computer.</span>' +
        '<button type="button" class="btn btn-sm btn-primary" data-act="signup">Create account</button>' +
        '<button type="button" class="btn btn-sm btn-outline-primary" data-act="signin">Sign in</button>' +
        '<button type="button" class="btn-close ms-1" aria-label="Hide" data-act="hide"></button></div>';
      el.querySelector('[data-act="signup"]').addEventListener("click", function () { openAuth("signup"); });
      el.querySelector('[data-act="signin"]').addEventListener("click", function () { openAuth("signin"); });
      el.querySelector('[data-act="hide"]').addEventListener("click", function () {
        dismissed = true;
        try { sessionStorage.setItem("tb_signup_banner_hidden", "1"); } catch (e) { /* storage unavailable */ }
        el.innerHTML = "";
      });
    }
    draw(cloud.status());
    cloud.on("status", draw);
  }

  // ------------------------------------------------------------ modals
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

  // ------------------------------------------------- project create / edit
  var projectEl = null;
  function ensureProjectModal() {
    if (projectEl) return projectEl;
    projectEl = document.createElement("div");
    projectEl.className = "modal fade";
    projectEl.id = "tb-modal-new-project";
    projectEl.tabIndex = -1;
    projectEl.innerHTML =
      '<div class="modal-dialog"><div class="modal-content">' +
      '<div class="modal-header"><h5 class="modal-title" id="tb-proj-modal-title">New Project</h5>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>' +
      '<div class="modal-body">' +
      '<div class="mb-3"><label class="form-label" for="tbf-proj-title">Project Title</label><input class="form-control" id="tbf-proj-title" placeholder="e.g. Youth Employment Perceptions in Kilosa"></div>' +
      '<div class="mb-3"><label class="form-label" for="tbf-proj-description">Description</label><textarea class="form-control" id="tbf-proj-description" rows="2"></textarea></div>' +
      '<div class="mb-3" id="tbf-proj-analysis-wrap"><label class="form-label" for="tbf-proj-analysis">First thematic analysis</label>' +
      '<input class="form-control" id="tbf-proj-analysis" placeholder="e.g. Challenges facing youths in entrepreneurship">' +
      '<div class="form-text">The research question you\'ll code for. You can add more analyses later and code them all in the same reading.</div></div>' +
      '<div class="grid gap-2 mb-3">' +
      '<div class="g-col-6"><label class="form-label" for="tbf-proj-topic">Research Topic</label><input class="form-control" id="tbf-proj-topic"></div>' +
      '<div class="g-col-6"><label class="form-label" for="tbf-proj-date">Date</label><input type="date" class="form-control" id="tbf-proj-date"></div></div>' +
      '<div class="grid gap-2 mb-3">' +
      '<div class="g-col-6"><label class="form-label" for="tbf-proj-researcher">Researcher</label><input class="form-control" id="tbf-proj-researcher"></div>' +
      '<div class="g-col-6"><label class="form-label" for="tbf-proj-org">Organization</label><input class="form-control" id="tbf-proj-org"></div></div>' +
      '<div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="tbf-proj-weighting" checked>' +
      '<label class="form-check-label" for="tbf-proj-weighting">Enable 1–10 importance weighting</label></div>' +
      "</div>" +
      '<div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>' +
      '<button type="button" class="btn btn-accent" id="tb-create-project-btn">Create Project</button></div>' +
      "</div></div>";
    document.body.appendChild(projectEl);
    return projectEl;
  }

  // project null = create. opts.onSaved(project) runs after saving an edit.
  function openProjectModal(project, opts) {
    opts = opts || {};
    var TB = window.TB;
    var el = ensureProjectModal();
    function f(id) { return el.querySelector("#tbf-proj-" + id); }
    var editing = !!project;
    el.querySelector("#tb-proj-modal-title").textContent = editing ? "Edit Project" : "New Project";
    el.querySelector("#tb-create-project-btn").textContent = editing ? "Save Changes" : "Create Project";
    el.querySelector("#tbf-proj-analysis-wrap").classList.toggle("d-none", editing);
    var p = project || {};
    f("title").value = p.title || "";
    f("description").value = p.description || "";
    f("analysis").value = "";
    f("topic").value = p.topic || "";
    f("date").value = p.date || "";
    f("researcher").value = p.researcher || "";
    f("org").value = p.org || "";
    f("weighting").checked = editing ? p.weightingEnabled !== false : true;
    var save = el.querySelector("#tb-create-project-btn");
    var fresh = save.cloneNode(true);
    save.parentNode.replaceChild(fresh, save);
    fresh.addEventListener("click", function () {
      var title = f("title").value.trim();
      if (!title) { f("title").classList.add("is-invalid"); f("title").focus(); return; }
      f("title").classList.remove("is-invalid");
      var fields = {
        title: title, description: f("description").value, topic: f("topic").value,
        date: f("date").value, researcher: f("researcher").value, org: f("org").value,
        weightingEnabled: f("weighting").checked
      };
      var modal = window.bootstrap.Modal.getInstance(el);
      if (editing) {
        TB.updateProject(project, fields);
        modal.hide();
        refreshShell();
        if (opts.onSaved) opts.onSaved(project);
        return;
      }
      fields.analysisName = f("analysis").value.trim();
      var created = TB.createProject(fields);
      TB.setActiveProjectId(created.id);
      modal.hide();
      window.location.href = "workspace.html";
    });
    window.bootstrap.Modal.getOrCreateInstance(el).show();
    setTimeout(function () { f("title").focus(); }, 300);
  }

  // ---------------------------------------------------------- sync notices
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
      esc(window.TB.fullThemePath(project, t.id)) + '"><span class="dot"></span>' + esc(t.name) + "</span>";
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
    var title = TB.fullThemePath(project, themeId);
    if (respondentId) {
      list = list.filter(function (e) { return TB.respondentIdForCoding(e.coding) === respondentId; });
      var r = TB.respondentsOf(project).find(function (r) { return r.id === respondentId; });
      if (r) title += " — " + r.label;
    }
    showEvidence(project, title, list);
  }

  // ------------------------------------------------- analysis selection
  // Which thematic analysis the analysis pages show, remembered per project
  // across pages. null means "all analyses".
  var VIEW_KEY = "tb_view_analysis";
  function readViews() {
    try { return JSON.parse(localStorage.getItem(VIEW_KEY) || "{}"); } catch (e) { return {}; }
  }
  function viewAnalysisId(project) {
    var v = readViews()[project.id];
    if (v === "all" && project.analyses.length > 1) return null;
    return project.analyses.some(function (a) { return a.id === v; }) ? v : project.analyses[0].id;
  }
  function setViewAnalysisId(project, id) {
    var views = readViews();
    views[project.id] = id || "all";
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(views)); } catch (e) { /* storage full */ }
  }
  // Renders the analysis picker into `container` (hidden when the project
  // has a single analysis). Returns the analysis in use.
  function analysisControl(container, project, opts) {
    var current = viewAnalysisId(project);
    var group = container.closest(".tb-toolbar-group") || container;
    group.classList.toggle("d-none", project.analyses.length < 2);
    container.innerHTML = '<select class="form-select form-select-sm tb-analysis-select" aria-label="Thematic analysis">' +
      project.analyses.map(function (a) {
        return '<option value="' + esc(a.id) + '"' + (a.id === current ? " selected" : "") + ">" + esc(a.name) + "</option>";
      }).join("") +
      '<option value=""' + (current === null ? " selected" : "") + ">All analyses</option></select>";
    container.querySelector("select").addEventListener("change", function (e) {
      setViewAnalysisId(project, e.target.value || null);
      opts.onChange(e.target.value || null);
    });
    return current;
  }

  // ------------------------------------------------------ level switch
  // Renders Themes / Sub-themes / Codes radio buttons into `container`;
  // hidden when the codebook has only one level. Returns the level in use.
  function levelControl(container, project, opts) {
    var levels = window.TB.levelOptions(project, opts.analysisId || null);
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

  // Theme <option>s grouped by analysis, for selects that list every theme.
  function themeOptionsHtml(project, filter, selectedId) {
    var TB = window.TB;
    return project.analyses.map(function (a) {
      var opts = TB.themesInTreeOrder(project, a.id).filter(filter || function () { return true; }).map(function (t) {
        return '<option value="' + esc(t.id) + '"' + (t.id === selectedId ? " selected" : "") + ">" + esc(TB.themePath(project, t.id)) + "</option>";
      }).join("");
      if (!opts) return "";
      return project.analyses.length > 1 ? '<optgroup label="' + esc(a.name) + '">' + opts + "</optgroup>" : opts;
    }).join("");
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
    refreshShell: refreshShell, openAuth: openAuth, mountAccountPage: mountAccountPage, mountSignupBanner: mountSignupBanner,
    openProjectModal: openProjectModal, toast: toast, themeChip: themeChip, themeChips: themeChips,
    showEvidence: showEvidence, showThemeEvidence: showThemeEvidence,
    viewAnalysisId: viewAnalysisId, setViewAnalysisId: setViewAnalysisId, analysisControl: analysisControl,
    levelControl: levelControl, themeOptionsHtml: themeOptionsHtml, relativeTime: relativeTime
  };
})();

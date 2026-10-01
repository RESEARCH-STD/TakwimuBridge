/*
 * Shared UI pieces: the dashboard shell (sidebar active state, mobile
 * toggle, active-project card), the evidence drill-down modal, theme chips
 * and the Themes / Sub-themes / Codes level switch used on every analysis
 * view. Depends on assets/app.js (window.TB) and Bootstrap's JS bundle.
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

  function initShell() {
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
    if (window.TB.seedDemoIfNeeded) window.TB.seedDemoIfNeeded();
    refreshShell();
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
    refreshShell: refreshShell, themeChip: themeChip, themeChips: themeChips,
    showEvidence: showEvidence, showThemeEvidence: showThemeEvidence,
    levelControl: levelControl, relativeTime: relativeTime
  };
})();

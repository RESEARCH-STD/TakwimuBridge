/*
 * Coding Workspace behaviour — sources list, transcript rendering with
 * highlighted coded spans, the coded-references list, and the coding panel:
 * select a passage once, tick every theme it speaks to in every thematic
 * analysis, weight, memo, apply. Also undo/redo, codebook management
 * (analyses, promote/demote/move/rename themes) and sources (import, edit,
 * delete; FGD participants and stakeholder types).
 * Depends on assets/app.js + assets/ui.js (window.TB) and, on this page
 * only, mammoth.js (DOCX) and SheetJS/xlsx (CSV/XLSX bulk import).
 */
(function () {
  "use strict";

  var TB = null;
  var project = null;
  var activeSourceId = null;
  var mode = "idle";        // "idle" | "new" | "edit"
  var pending = null;       // { start, end, quote } while coding a new passage
  var editingId = null;     // coded reference open in the panel
  var editingGroup = [];    // every coded reference covering the clicked text
  var selected = {};        // themeId -> true
  var speakerId = null;
  var hiddenLenses = {};    // analysis or top-level theme id -> true when its highlights are hidden
  var addingUnder;          // open inline "add" input: theme id, "@<analysisId>" or "+analysis"
  var view = "text";        // "text" | "refs"
  var justCaptured = false;
  var mouseDown = false;
  var candidate = null;
  var flashId = null;
  var stakeholderTags = [];
  var cb = { editing: null, renaming: null, addingAnalysis: false };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) { return TB.escapeHtml(s); }
  function color(t) { return esc(TB.safeColor(t.color)); }
  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

  function activeSource() {
    return project.sources.find(function (s) { return s.id === activeSourceId; }) || null;
  }
  function codingById(id) {
    return project.codings.find(function (c) { return c.id === id; }) || null;
  }
  function sourceById(id) {
    return project.sources.find(function (s) { return s.id === id; }) || null;
  }
  function treeOrder() {
    var order = {};
    TB.themesInTreeOrder(project).forEach(function (t, i) { order[t.id] = i; });
    return order;
  }
  function selectedIds() {
    return TB.themesInTreeOrder(project).filter(function (t) { return selected[t.id]; }).map(function (t) { return t.id; });
  }

  // ------------------------------------------------------------ undo/redo
  // Snapshots of the whole project, taken before each change. Transcripts
  // rarely change, so identical transcript text is shared between snapshots.
  var MAX_HISTORY = 40;
  var undoStack = [];
  var redoStack = [];

  function snapshot(label) {
    var rest = Object.assign({}, project);
    delete rest.sources;
    var sources = JSON.stringify(project.sources);
    var prev = undoStack[undoStack.length - 1];
    if (prev && prev.sources === sources) sources = prev.sources;
    return { label: label, rest: JSON.stringify(rest), sources: sources };
  }
  // Runs one user change so it can be undone; fn returning false means
  // nothing changed.
  function act(label, fn) {
    var snap = snapshot(label);
    var result = fn();
    if (result === false) return false;
    undoStack.push(snap);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    renderHistory();
    return result;
  }
  function restore(snap) {
    var p = JSON.parse(snap.rest);
    p.sources = JSON.parse(snap.sources);
    TB.saveProject(p);
    project = TB.getActiveProject();
  }
  function undo() {
    if (!undoStack.length) return;
    var snap = undoStack.pop();
    redoStack.push(snapshot(snap.label));
    restore(snap);
    afterHistory("Undone: " + snap.label);
  }
  function redo() {
    if (!redoStack.length) return;
    var snap = redoStack.pop();
    undoStack.push(snapshot(snap.label));
    restore(snap);
    afterHistory("Redone: " + snap.label);
  }
  function afterHistory(message) {
    resetPanel();
    renderHistory();
    renderAll();
    if ($("#tb-modal-codebook").classList.contains("show")) renderCodebookEditor();
    TB.ui.toast(message);
  }
  function renderHistory() {
    var u = $("#tb-undo-btn"), r = $("#tb-redo-btn");
    u.disabled = !undoStack.length;
    r.disabled = !redoStack.length;
    u.title = undoStack.length ? "Undo: " + undoStack[undoStack.length - 1].label + " (Ctrl+Z)" : "Nothing to undo";
    r.title = redoStack.length ? "Redo: " + redoStack[redoStack.length - 1].label + " (Ctrl+Y)" : "Nothing to redo";
  }
  function notify(message) {
    TB.ui.toast(message, { action: { label: "Undo", onClick: undo } });
  }

  // ------------------------------------------------------------- rendering
  function renderAll() {
    if (!project) {
      $("#tb-no-project-alert").classList.remove("d-none");
      $("#tb-workspace-content").classList.add("d-none");
      return;
    }
    $("#tb-no-project-alert").classList.add("d-none");
    $("#tb-workspace-content").classList.remove("d-none");
    $("#tb-project-title").textContent = project.title;
    $("#tb-project-meta").textContent = [project.researcher, project.org, plural(project.sources.length, "source"),
      project.analyses.length + (project.analyses.length === 1 ? " thematic analysis" : " thematic analyses"),
      plural(project.codings.length, "coded reference")].filter(Boolean).join(" · ");

    if (activeSourceId && !activeSource()) activeSourceId = null;
    if (!activeSourceId && project.sources.length) activeSourceId = project.sources[0].id;

    renderSourceList();
    renderLensBar();
    renderTranscript();
    renderRefsList();
    renderPanel();
    if (TB.ui) TB.ui.refreshShell();
  }

  function renderSourceList() {
    var list = $("#tb-sources-list");
    $("#tb-sources-count").textContent = project.sources.length ? String(project.sources.length) : "";
    if (!project.sources.length) {
      list.innerHTML = '<p class="text-muted small mb-0">No sources yet. Click "Add Source" to import a KII, FGD, interview, survey response or document.</p>';
      return;
    }
    list.innerHTML = project.sources.map(function (s) {
      var count = TB.codingsForSource(project, s.id).length;
      var pct = TB.sourceCodedPct(project, s);
      return '<div class="tb-source-item' + (s.id === activeSourceId ? " active" : "") + '" data-source-id="' + esc(s.id) + '" role="button" tabindex="0">' +
        '<div class="d-flex justify-content-between align-items-start gap-2">' +
        '<span class="tb-source-name">' + esc(s.name) + "</span>" +
        '<span class="badge bg-secondary tb-source-type-badge">' + esc(s.type) + "</span>" +
        "</div>" +
        '<div class="text-muted" style="font-size:.74rem;">' + count + " coded · " + pct + "% of text</div>" +
        '<div class="tb-progress"><span style="width:' + pct + '%"></span></div>' +
        "</div>";
    }).join("");
  }

  // With several analyses, highlights are switched per analysis; with one,
  // per top-level theme.
  function lensItems() {
    if (project.analyses.length > 1) {
      return project.analyses.map(function (a) {
        var first = TB.themeTree(project, a.id)[0];
        return { id: a.id, name: a.name, color: first ? first.color : "#5B6B82" };
      });
    }
    var tops = TB.themeTree(project);
    return tops.length < 2 ? [] : tops.map(function (t) { return { id: t.id, name: t.name, color: t.color }; });
  }
  function isHidden(themeId) {
    return !!(hiddenLenses[TB.topLevelThemeId(project, themeId)] || hiddenLenses[TB.analysisIdOfTheme(project, themeId)]);
  }
  function renderLensBar() {
    var items = lensItems();
    var bar = $("#tb-lens-bar");
    bar.classList.toggle("d-none", !items.length || view !== "text");
    bar.innerHTML = items.length ? '<span class="small text-muted me-1">Highlight:</span>' + items.map(function (l) {
      return '<button type="button" class="tb-lens" data-lens-id="' + esc(l.id) + '" aria-pressed="' + (hiddenLenses[l.id] ? "false" : "true") +
        '" style="--chip-color:' + esc(TB.safeColor(l.color)) + '" title="Show or hide highlights coded under ' + esc(l.name) + '"><span class="dot"></span>' + esc(l.name) + "</button>";
    }).join("") : "";
  }

  function buildSegments(text, spans) {
    var points = {};
    points[0] = true; points[text.length] = true;
    spans.forEach(function (s) { points[s.start] = true; points[s.end] = true; });
    var sorted = Object.keys(points).map(Number)
      .filter(function (n) { return n >= 0 && n <= text.length; })
      .sort(function (a, b) { return a - b; });
    var segments = [];
    for (var i = 0; i < sorted.length - 1; i++) {
      var a = sorted[i], b = sorted[i + 1];
      if (a >= b) continue;
      segments.push({
        text: text.slice(a, b),
        covering: spans.filter(function (s) { return s.start <= a && s.end >= b; })
      });
    }
    return segments;
  }

  function renderAttributes(src) {
    var a = src.attributes || {};
    var isGroup = src.type === "FGD";
    var rows = [[isGroup ? "Group ID" : "Respondent ID", a.respondentId]];
    if (!isGroup) rows.push(["Sex", a.sex]);
    if (isGroup) {
      var pc = TB.participantsOf(src);
      if (pc.total) {
        rows.push(["Participants", pc.total + " (" + [pc.women + " women", pc.men + " men",
          pc.undisclosed ? pc.undisclosed + " not disclosed" : ""].filter(Boolean).join(", ") + ")"]);
      }
    }
    rows.push(["Location", a.location], ["Stakeholder type", TB.attrValues(a, "stakeholder").join(", ")], ["Institution", a.institution]);
    if (isGroup && src.speakers && src.speakers.length) {
      rows.push(["Speakers", src.speakers.map(function (sp) { return sp.label; }).join(", ")]);
    }
    $("#tb-source-attributes").innerHTML = '<div class="d-flex justify-content-between align-items-start gap-2">' +
      '<div class="d-flex flex-wrap">' + rows.filter(function (r) { return r[1]; }).map(function (r) {
        return '<span class="tb-meta-pill"><strong class="me-1">' + esc(r[0]) + ":</strong>" + esc(r[1]) + "</span>";
      }).join("") + "</div>" +
      '<div class="d-flex gap-1 flex-shrink-0">' +
      '<button type="button" class="btn btn-sm btn-outline-secondary" id="tb-edit-source-btn" title="Edit this source — name, details or text"><i class="bi bi-pencil"></i> Edit</button>' +
      '<button type="button" class="btn btn-sm btn-outline-danger" id="tb-delete-source-inline" title="Delete this source"><i class="bi bi-trash"></i></button>' +
      "</div></div>" +
      (src.memo ? '<p class="text-muted small mt-2 mb-0"><i class="bi bi-sticky"></i> ' + esc(src.memo) + "</p>" : "");
    $("#tb-edit-source-btn").addEventListener("click", function () { openSourceModal(src.id); });
    $("#tb-delete-source-inline").addEventListener("click", function () { deleteSource(src.id); });
  }

  function renderTranscript() {
    var src = activeSource();
    var nameEl = $("#tb-active-source-name");
    var body = $("#tb-transcript-text");
    if (!src) {
      nameEl.textContent = "No source selected";
      body.innerHTML = '<p class="text-muted">Add or select a source on the left to start reading and coding.</p>';
      $("#tb-source-attributes").innerHTML = "";
      return;
    }
    nameEl.textContent = src.name + " (" + src.type + ")";
    renderAttributes(src);

    if (!src.text) {
      body.innerHTML = '<p class="text-muted">This source has no text yet.</p>';
      return;
    }
    var order = treeOrder();
    var spans = [];
    TB.codingsForSource(project, src.id).forEach(function (c) {
      var ids = (c.themeIds || []).filter(function (id) { return !isHidden(id); });
      if (ids.length || c.id === editingId) spans.push({ start: c.start, end: c.end, coding: c, ids: ids });
    });
    if (mode === "new" && pending) spans.push({ start: pending.start, end: pending.end, pending: true, ids: [] });

    body.innerHTML = buildSegments(src.text, spans).map(function (seg) {
      if (!seg.covering.length) return esc(seg.text);
      var refs = seg.covering.filter(function (s) { return s.coding; });
      var isPending = seg.covering.some(function (s) { return s.pending; });
      if (!refs.length) return '<mark class="tb-pending">' + esc(seg.text) + "</mark>";

      var themeIds = [];
      refs.forEach(function (s) { s.ids.forEach(function (id) { if (themeIds.indexOf(id) === -1) themeIds.push(id); }); });
      themeIds.sort(function (a, b) { return (order[a] || 0) - (order[b] || 0); });
      var themes = themeIds.map(function (id) { return TB.themeById(project, id); }).filter(Boolean);
      var colors = themes.map(function (t) { return TB.safeColor(t.color); });
      // One underline stripe per theme, stacked, so a passage coded to a
      // cause and an impact shows both colours at a glance.
      var stripes = colors.slice(0, 4).map(function (c, i) { return "inset 0 -" + (3 * (i + 1)) + "px 0 " + c; }).join(", ");
      var ids = refs.map(function (s) { return s.coding.id; });
      var cls = "tb-coded" + (isPending ? " tb-pending" : "") +
        (editingId && ids.indexOf(editingId) !== -1 ? " tb-selected-ref" : "") +
        (flashId && ids.indexOf(flashId) !== -1 ? " tb-flash" : "");
      return '<mark class="' + cls + '" data-coding-ids="' + esc(ids.join(",")) + '"' +
        (ids.length > 1 ? ' data-count="' + ids.length + '"' : "") +
        ' style="--hl:' + esc(colors[0] || "#E08E45") + ";" + (stripes ? "box-shadow:" + esc(stripes) + ";" : "") +
        "padding-bottom:" + (3 * Math.min(4, colors.length) + 2) + 'px;"' +
        ' title="' + esc(themes.map(function (t) { return TB.fullThemePath(project, t.id); }).join("\n")) + '">' +
        esc(seg.text) + "</mark>";
    }).join("");
  }

  // ------------------------------------------------- coded references list
  function renderRefsList() {
    var src = activeSource();
    var el = $("#tb-refs-list");
    var refs = src ? TB.codingsForSource(project, src.id).slice().sort(function (a, b) { return a.start - b.start; }) : [];
    $("#tb-refs-count").textContent = refs.length;
    if (view !== "refs") return;
    if (!src) { el.innerHTML = ""; return; }
    var speakers = {};
    (src.speakers || []).forEach(function (sp) { speakers[sp.id] = sp.label; });
    el.innerHTML = refs.length ? '<p class="small text-muted">Every coded passage in this source, in reading order. Delete one with its bin — you can undo.</p>' +
      refs.map(function (c) {
        var meta = [c.speakerId ? speakers[c.speakerId] : "", c.weight !== null && c.weight !== undefined ? "weight " + c.weight + "/10" : "", c.memo].filter(Boolean);
        return '<div class="tb-ref-item" data-coding-id="' + esc(c.id) + '">' +
          '<div class="tb-ref-quote">&ldquo;' + esc(c.quote) + "&rdquo;</div>" +
          '<div class="mt-1">' + TB.ui.themeChips(project, c.themeIds) + "</div>" +
          '<div class="d-flex justify-content-between align-items-center gap-2 mt-1">' +
          '<span class="small text-muted">' + esc(meta.join(" · ")) + "</span>" +
          '<span class="d-flex gap-1 flex-shrink-0">' +
          '<button type="button" class="btn btn-sm btn-outline-secondary" data-act="edit"><i class="bi bi-pencil"></i> Edit</button>' +
          '<button type="button" class="btn btn-sm btn-outline-danger" data-act="delete" title="Delete this coded reference"><i class="bi bi-trash"></i></button>' +
          "</span></div></div>";
      }).join("")
      : '<p class="text-muted mb-0">Nothing coded in this source yet. Switch to <strong>Transcript</strong> and select a passage to code it.</p>';
  }

  function setView(v) {
    view = v;
    $("#tb-view-" + v).checked = true;
    $("#tb-transcript-text").classList.toggle("d-none", v !== "text");
    $("#tb-refs-list").classList.toggle("d-none", v !== "refs");
    renderLensBar();
    renderRefsList();
  }

  function deleteCoding(id) {
    act("delete coded reference", function () { TB.deleteCoding(project, id); });
    if (editingId === id) resetPanel();
    renderAll();
    notify("Coded reference deleted.");
  }

  function scrollToCoding(id) {
    var mark = $all("#tb-transcript-text mark.tb-coded").find(function (m) {
      return m.getAttribute("data-coding-ids").split(",").indexOf(id) !== -1;
    });
    if (mark) mark.scrollIntoView({ block: "center" });
  }

  // --------------------------------------------------------- coding panel
  function readCollapsed() {
    try { return (JSON.parse(localStorage.getItem("tb_ws_collapsed") || "{}")[project.id]) || {}; } catch (e) { return {}; }
  }
  function writeCollapsed(c) {
    try {
      var all = JSON.parse(localStorage.getItem("tb_ws_collapsed") || "{}");
      all[project.id] = c;
      localStorage.setItem("tb_ws_collapsed", JSON.stringify(all));
    } catch (e) { /* storage unavailable */ }
  }

  function chipHtml(node, stats) {
    var on = !!selected[node.id];
    var title = TB.fullThemePath(project, node.id) + (node.memo ? " — " + node.memo : "");
    return '<button type="button" class="tb-chip" data-theme-id="' + esc(node.id) + '" aria-pressed="' + on + '"' +
      (mode === "idle" ? " disabled" : "") + ' style="--chip-color:' + color(node) + '" title="' + esc(title) + '">' +
      '<span class="dot"></span>' + esc(node.name) + ' <span class="n">' + ((stats[node.id] || {}).frequency || 0) + "</span></button>";
  }
  var ADD_TEXT = {
    sub: ["Add", "New sub-theme, then Enter"],
    theme: ["New theme", "New theme, then Enter"],
    analysis: ["New thematic analysis", "Name the analysis, then Enter"]
  };
  function addHtml(key) {
    var kind = key === "+analysis" ? "analysis" : key.charAt(0) === "@" ? "theme" : "sub";
    if (addingUnder === key) {
      return '<input type="text" class="tb-chip-input' + (kind === "analysis" ? " wide" : "") + '" data-add-input="' + esc(key) +
        '" maxlength="100" placeholder="' + ADD_TEXT[kind][1] + '" aria-label="' + ADD_TEXT[kind][1] + '">';
    }
    return '<button type="button" class="tb-chip tb-chip-add" data-add-parent="' + esc(key) + '">' +
      '<i class="bi bi-plus-lg"></i>' + ADD_TEXT[kind][0] + "</button>";
  }
  function nestedHtml(children, stats) {
    return children.filter(function (c) { return c.children.length; }).map(function (c) {
      return '<div class="tb-cp-nested"><div class="tb-cp-nested-label">' + esc(c.name) + " ›</div>" +
        '<div class="tb-cp-chips">' + c.children.map(function (g) { return chipHtml(g, stats); }).join("") + addHtml(c.id) + "</div>" +
        nestedHtml(c.children, stats) + "</div>";
    }).join("");
  }

  function renderThemeGroups() {
    var stats = {};
    TB.allThemeStats(project).forEach(function (s) { stats[s.themeId] = s; });
    var collapsed = readCollapsed();
    var el = $("#tb-cp-themes");
    el.innerHTML = project.analyses.map(function (a) {
      var tree = TB.themeTree(project, a.id);
      var ticked = TB.themesInAnalysis(project, a.id).filter(function (t) { return selected[t.id]; }).length;
      var closed = !!collapsed[a.id];
      return '<section class="tb-cp-analysis" data-analysis-id="' + esc(a.id) + '">' +
        '<button type="button" class="tb-cp-analysis-head" data-toggle-analysis="' + esc(a.id) + '" aria-expanded="' + !closed + '"' +
        (a.question ? ' title="' + esc(a.question) + '"' : "") + ">" +
        '<i class="bi bi-chevron-' + (closed ? "right" : "down") + '"></i>' +
        '<span class="tb-cp-analysis-name">' + esc(a.name) + "</span>" +
        (ticked ? '<span class="badge bg-accent">' + ticked + " ticked</span>" : "") +
        '<span class="tb-cp-analysis-count">' + plural(tree.length, "theme") + "</span></button>" +
        (closed ? "" : tree.map(function (node) {
          return '<div class="tb-cp-group" style="--group-color:' + color(node) + '">' +
            '<div class="tb-cp-group-head">' + chipHtml(node, stats) +
            '<span class="small text-muted">' + plural(node.children.length, "sub-theme") + "</span></div>" +
            '<div class="tb-cp-chips">' + node.children.map(function (c) { return chipHtml(c, stats); }).join("") + addHtml(node.id) + "</div>" +
            nestedHtml(node.children, stats) +
            "</div>";
        }).join("") + (tree.length ? "" : '<p class="small text-muted mb-2">No themes yet. A good start is one theme per question — for example <em>Causes</em>, <em>Challenges</em> and <em>Impacts</em>.</p>') +
          '<div class="mb-1">' + addHtml("@" + a.id) + "</div>") +
        "</section>";
    }).join("") + '<div class="mt-2">' + addHtml("+analysis") + "</div>";
    var input = $("[data-add-input]", el);
    if (input) input.focus();
  }

  function renderSpeakerSelect() {
    var src = mode === "edit" ? sourceById((codingById(editingId) || {}).sourceId) : activeSource();
    var wrap = $("[data-speaker-wrap]");
    var select = $("#tb-cp-speaker");
    if (mode === "idle" || !src || src.type !== "FGD" || !src.speakers || !src.speakers.length) {
      wrap.classList.add("d-none");
      select.innerHTML = "";
      return;
    }
    wrap.classList.remove("d-none");
    select.innerHTML = '<option value="">(whole discussion / unspecified)</option>' +
      src.speakers.map(function (sp) { return '<option value="' + esc(sp.id) + '">' + esc(sp.label) + "</option>"; }).join("");
    select.value = speakerId || "";
  }

  function updateApplyButton() {
    var n = selectedIds().length;
    var btn = $("#tb-cp-apply");
    var removing = mode === "edit" && n === 0;
    btn.disabled = mode === "idle" || (mode === "new" && n === 0);
    btn.classList.toggle("btn-accent", !removing);
    btn.classList.toggle("btn-danger", removing);
    $("#tb-cp-apply-label").textContent = removing ? "Remove this coded reference"
      : mode === "edit" ? "Save changes"
      : mode === "idle" ? "Apply codes"
      : n ? "Apply " + plural(n, "code") : "Tick at least one theme";
  }

  function renderPanel() {
    var quoteEl = $("#tb-cp-quote");
    $("#tb-coding-panel").classList.toggle("has-selection", mode !== "idle");
    $("#tb-cp-title").innerHTML = mode === "edit"
      ? '<i class="bi bi-pencil-square me-1"></i>Edit coded reference'
      : '<i class="bi bi-highlighter me-1"></i>' + (mode === "new" ? "Code selection" : "Code a passage");
    $("#tb-cp-cancel").classList.toggle("d-none", mode === "idle");

    if (mode === "idle") {
      quoteEl.className = "tb-cp-quote is-empty";
      quoteEl.textContent = activeSource() ? "Select a passage in the transcript to code it, or click a highlight to change or delete it." : "Add or select a source first.";
    } else {
      quoteEl.className = "tb-cp-quote";
      quoteEl.textContent = mode === "new" ? pending.quote : ((codingById(editingId) || {}).quote || "");
    }

    var refs = $("#tb-cp-refs");
    refs.innerHTML = mode === "edit" && editingGroup.length > 1
      ? editingGroup.length + " coded references overlap here:" + editingGroup.map(function (id, i) {
        return '<button type="button" class="btn btn-sm py-0 px-2 ms-1 ' + (id === editingId ? "btn-primary" : "btn-outline-secondary") +
          '" data-ref-id="' + esc(id) + '">' + (i + 1) + "</button>";
      }).join("")
      : mode === "edit" ? "Untick a theme to remove it from this passage, or delete the whole coded reference below." : "";
    $("#tb-cp-hint").classList.toggle("d-none", mode !== "idle");

    renderThemeGroups();
    renderSpeakerSelect();
    var idle = mode === "idle";
    $("#tb-cp-weight-toggle").disabled = idle;
    $("#tb-cp-memo").disabled = idle;
    $("#tb-cp-weight").disabled = idle || !$("#tb-cp-weight-toggle").checked;
    $("#tb-cp-delete").classList.toggle("d-none", mode !== "edit");
    updateApplyButton();
  }

  function setDetails(weight, memo) {
    var on = weight !== null && weight !== undefined;
    $("#tb-cp-weight-toggle").checked = on;
    $("#tb-cp-weight").value = on ? weight : 5;
    $("#tb-cp-weight-value").textContent = on ? weight : 5;
    $("#tb-cp-memo").value = memo || "";
  }

  function showStatus(msg, withUndo) {
    var el = $("#tb-cp-status");
    el.innerHTML = msg ? esc(msg) + (withUndo ? ' <button type="button" class="btn btn-link btn-sm p-0 align-baseline" data-undo>Undo</button>' : "") : "";
    el.classList.toggle("d-none", !msg);
    clearTimeout(showStatus.timer);
    if (msg) showStatus.timer = setTimeout(function () { el.classList.add("d-none"); }, 6000);
  }

  // The FGD speaker is whoever's "Label:" turn most recently starts at or
  // before the selection, so coding a turn doesn't need a manual pick.
  function detectSpeaker(src, offset) {
    if (!src || src.type !== "FGD" || !src.speakers || !src.speakers.length) return null;
    var best = null, bestPos = -1;
    src.speakers.forEach(function (sp) {
      var re = new RegExp("(^|[\\n.!?]\\s*)" + TB.escapeRegExp(sp.label) + "\\s*:", "g");
      var m;
      while ((m = re.exec(src.text))) {
        var pos = m.index + m[1].length;
        if (pos > offset) break;
        if (pos > bestPos) { bestPos = pos; best = sp.id; }
        if (re.lastIndex === m.index) re.lastIndex++;
      }
    });
    return best;
  }

  function startNew(sel) {
    mode = "new";
    pending = { start: sel.start, end: sel.end, quote: sel.quote };
    editingId = null; editingGroup = []; selected = {};
    speakerId = detectSpeaker(activeSource(), sel.start);
    setDetails(project.weightingEnabled ? 5 : null, "");
    showStatus("");
    renderTranscript();
    renderPanel();
  }

  function openEdit(group, id) {
    var c = codingById(id || group[0]);
    if (!c) return;
    mode = "edit";
    pending = null;
    editingGroup = group;
    editingId = c.id;
    selected = {};
    (c.themeIds || []).forEach(function (t) { selected[t] = true; });
    speakerId = c.speakerId || null;
    setDetails(c.weight, c.memo);
    showStatus("");
    renderTranscript();
    renderPanel();
  }

  function resetPanel() {
    mode = "idle";
    pending = null; editingId = null; editingGroup = []; selected = {}; speakerId = null;
    addingUnder = undefined;
  }

  function applyCoding() {
    var ids = selectedIds();
    if (mode === "edit" && !ids.length) { deleteCurrent(); return; }
    if (mode === "idle" || !ids.length) return;
    var weight = $("#tb-cp-weight-toggle").checked ? Number($("#tb-cp-weight").value) : null;
    var memo = $("#tb-cp-memo").value;
    var speaker = $("[data-speaker-wrap]").classList.contains("d-none") ? null : (speakerId || null);
    var msg;
    if (mode === "new") {
      var c = act("code a passage", function () {
        return TB.addCoding(project, {
          sourceId: activeSourceId, speakerId: speaker, themeIds: ids,
          start: pending.start, end: pending.end, quote: pending.quote, weight: weight, memo: memo
        });
      });
      flashId = c.id;
      msg = "Coded to " + plural(ids.length, "theme") + ".";
    } else {
      var id = editingId;
      act("change a coded reference", function () {
        TB.updateCoding(project, id, { themeIds: ids, speakerId: speaker, weight: weight, memo: memo });
      });
      flashId = id;
      msg = "Changes saved.";
    }
    resetPanel();
    renderAll();
    showStatus(msg, true);
    setTimeout(function () { flashId = null; }, 2600);
  }

  function deleteCurrent() {
    if (mode !== "edit") return;
    deleteCoding(editingId);
  }

  function commitInlineAdd(input) {
    var name = input.value.trim();
    var key = input.getAttribute("data-add-input") || "";
    addingUnder = undefined;
    if (name) {
      if (key === "+analysis") {
        act("add a thematic analysis", function () { return TB.addAnalysis(project, { name: name }); });
        TB.ui.toast("Thematic analysis “" + name + "” added — now add its themes.");
      } else {
        var t = act("add a theme", function () {
          return key.charAt(0) === "@" ? TB.addTheme(project, { name: name, analysisId: key.slice(1) })
            : TB.addTheme(project, { name: name, parentId: key });
        });
        if (mode !== "idle") selected[t.id] = true;
      }
    }
    renderLensBar();
    renderThemeGroups();
    updateApplyButton();
  }

  function wirePanel() {
    var themesEl = $("#tb-cp-themes");
    themesEl.addEventListener("click", function (e) {
      var toggle = e.target.closest("[data-toggle-analysis]");
      if (toggle) {
        var c = readCollapsed();
        var id = toggle.getAttribute("data-toggle-analysis");
        if (c[id]) delete c[id]; else c[id] = true;
        writeCollapsed(c);
        renderThemeGroups();
        return;
      }
      var chip = e.target.closest("[data-theme-id]");
      if (chip) {
        if (chip.disabled) return;
        var tid = chip.getAttribute("data-theme-id");
        if (selected[tid]) delete selected[tid]; else selected[tid] = true;
        chip.setAttribute("aria-pressed", selected[tid] ? "true" : "false");
        updateApplyButton();
        return;
      }
      var add = e.target.closest("[data-add-parent]");
      if (add) {
        addingUnder = add.getAttribute("data-add-parent");
        renderThemeGroups();
      }
    });
    themesEl.addEventListener("keydown", function (e) {
      var input = e.target.closest("[data-add-input]");
      if (!input) return;
      if (e.key === "Enter") { e.preventDefault(); commitInlineAdd(input); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); addingUnder = undefined; renderThemeGroups(); }
    });
    themesEl.addEventListener("focusout", function (e) {
      var input = e.target.closest && e.target.closest("[data-add-input]");
      if (!input) return;
      setTimeout(function () {
        if (!input.isConnected || addingUnder === undefined || document.activeElement === input) return;
        if (input.value.trim()) commitInlineAdd(input);
        else { addingUnder = undefined; renderThemeGroups(); }
      }, 150);
    });

    $("#tb-cp-weight-toggle").addEventListener("change", function (e) {
      $("#tb-cp-weight").disabled = !e.target.checked || mode === "idle";
    });
    $("#tb-cp-weight").addEventListener("input", function (e) {
      $("#tb-cp-weight-value").textContent = e.target.value;
    });
    $("#tb-cp-speaker").addEventListener("change", function (e) { speakerId = e.target.value || null; });
    $("#tb-cp-apply").addEventListener("click", applyCoding);
    $("#tb-cp-delete").addEventListener("click", deleteCurrent);
    $("#tb-cp-cancel").addEventListener("click", function () { resetPanel(); renderTranscript(); renderPanel(); });
    $("#tb-cp-refs").addEventListener("click", function (e) {
      var b = e.target.closest("[data-ref-id]");
      if (b) openEdit(editingGroup, b.getAttribute("data-ref-id"));
    });
    $("#tb-cp-status").addEventListener("click", function (e) {
      if (e.target.closest("[data-undo]")) { showStatus(""); undo(); }
    });

    $("#tb-undo-btn").addEventListener("click", undo);
    $("#tb-redo-btn").addEventListener("click", redo);

    document.addEventListener("keydown", function (e) {
      if (document.querySelector(".modal.show")) return;
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      var key = (e.key || "").toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !typing && (key === "z" || key === "y")) {
        e.preventDefault();
        if (key === "y" || e.shiftKey) redo(); else undo();
        return;
      }
      if (typing) return;
      if (e.key === "Escape" && mode !== "idle") { resetPanel(); renderTranscript(); renderPanel(); }
      else if (e.key === "Enter" && mode !== "idle" && e.target === document.body) { e.preventDefault(); applyCoding(); }
      else if (e.key === "Delete" && mode === "edit") { e.preventDefault(); deleteCurrent(); }
    });
  }

  // ------------------------------------------------------- text selection
  // Offsets are measured with a Range from the transcript's start, which is
  // exact because the transcript DOM contains only the source text itself.
  function textOffset(root, node, offset) {
    var r = document.createRange();
    r.setStart(root, 0);
    r.setEnd(node, offset);
    return r.toString().length;
  }

  function readSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    var body = $("#tb-transcript-text");
    if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) return null;
    var src = activeSource();
    if (!src || !src.text) return null;
    var start = textOffset(body, range.startContainer, range.startOffset);
    var end = textOffset(body, range.endContainer, range.endOffset);
    if (start > end) { var tmp = start; start = end; end = tmp; }
    while (start < end && /\s/.test(src.text.charAt(start))) start++;
    while (end > start && /\s/.test(src.text.charAt(end - 1))) end--;
    if (end <= start) return null;
    return { start: start, end: end, quote: src.text.slice(start, end), rect: range.getBoundingClientRect() };
  }

  function hideFloatingButton() { $("#tb-code-selection-btn").classList.add("d-none"); }

  function captureFrom(sel) {
    justCaptured = true;
    setTimeout(function () { justCaptured = false; }, 0);
    hideFloatingButton();
    window.getSelection().removeAllRanges();
    startNew(sel);
  }

  function setupSelectionHandling() {
    var btn = $("#tb-code-selection-btn");
    // Mouse selections are captured as soon as the button is released;
    // touch and keyboard selections get a floating "Code selection" button
    // instead, since capturing would cut short adjusting the selection.
    document.addEventListener("pointerdown", function (e) { if (e.pointerType === "mouse") mouseDown = true; });
    document.addEventListener("pointerup", function (e) {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      mouseDown = false;
      var sel = readSelection();
      if (sel) captureFrom(sel);
    });
    var timer = null;
    document.addEventListener("selectionchange", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (mouseDown) return;
        var sel = readSelection();
        if (!sel) { hideFloatingButton(); candidate = null; return; }
        candidate = sel;
        btn.style.top = (sel.rect.bottom + window.scrollY + 8) + "px";
        btn.style.left = Math.max(8, sel.rect.left + window.scrollX) + "px";
        btn.classList.remove("d-none");
      }, 250);
    });
    btn.addEventListener("click", function () {
      var sel = readSelection() || candidate;
      candidate = null;
      if (sel) captureFrom(sel); else hideFloatingButton();
    });

    $("#tb-transcript-text").addEventListener("click", function (e) {
      if (justCaptured) return;
      var mark = e.target.closest("mark.tb-coded");
      if (!mark) return;
      openEdit(mark.getAttribute("data-coding-ids").split(","));
    });
  }

  // ------------------------------------------------------------ codebook
  function openCodebookModal() {
    cb = { editing: null, renaming: null, addingAnalysis: false };
    renderCodebookEditor();
    $("#tbf-theme-color").value = TB.suggestColor(project);
    window.bootstrap.Modal.getOrCreateInstance($("#tb-modal-codebook")).show();
  }

  // <option>s for "place under": the top level of each analysis, then every
  // theme in it except `exclude` and its descendants.
  function placementOptions(exclude, selectedValue) {
    var banned = {};
    if (exclude) {
      banned[exclude] = true;
      TB.descendantThemeIds(project, exclude).forEach(function (id) { banned[id] = true; });
    }
    return project.analyses.map(function (a) {
      var opts = '<option value="@' + esc(a.id) + '"' + (selectedValue === "@" + a.id ? " selected" : "") + ">Main theme (top level)</option>" +
        TB.themesInTreeOrder(project, a.id).filter(function (t) { return !banned[t.id]; }).map(function (t) {
          return '<option value="' + esc(t.id) + '"' + (selectedValue === t.id ? " selected" : "") + ">" +
            new Array(TB.themeDepth(project, t.id) + 2).join(" ") + "under " + esc(t.name) + "</option>";
        }).join("");
      return '<optgroup label="' + esc(a.name) + '">' + opts + "</optgroup>";
    }).join("");
  }

  function codebookRow(node, depth, stats) {
    var prev = TB.previousSibling(project, node.id);
    var s = stats[node.id] || { frequency: 0 };
    var html = '<div class="tb-cb-row" style="--depth:' + depth + '" data-theme-id="' + esc(node.id) + '">' +
      '<span class="tb-cb-swatch" style="background:' + color(node) + '"></span>' +
      '<span class="tb-cb-name">' + esc(node.name) + "</span>" +
      '<span class="tb-cb-count" title="Coded references">' + s.frequency + "</span>" +
      (node.memo ? '<i class="bi bi-sticky text-muted" title="' + esc(node.memo) + '"></i>' : "") +
      '<span class="tb-cb-actions">' +
      '<button type="button" class="btn btn-sm btn-link" data-act="promote"' + (node.parentId ? "" : " disabled") +
      ' title="Promote — move it up one level' + (depth === 1 ? " (make it a main theme)" : "") + '"><i class="bi bi-arrow-bar-left"></i></button>' +
      '<button type="button" class="btn btn-sm btn-link" data-act="demote"' + (prev ? "" : " disabled") +
      ' title="' + (prev ? "Demote — make it a sub-theme of “" + esc(prev.name) + "”" : "Nothing above to put it under") + '"><i class="bi bi-arrow-bar-right"></i></button>' +
      '<button type="button" class="btn btn-sm btn-link" data-act="edit" title="Rename, recolour, move or add a memo"><i class="bi bi-pencil"></i></button>' +
      '<button type="button" class="btn btn-sm btn-link text-danger" data-act="delete" title="Delete"><i class="bi bi-trash"></i></button>' +
      "</span></div>";
    if (cb.editing === node.id) {
      var current = node.parentId || "@" + TB.analysisIdOfTheme(project, node.id);
      html += '<div class="tb-cb-edit" style="--depth:' + depth + '" data-theme-id="' + esc(node.id) + '"><div class="grid gap-2">' +
        '<div class="g-col-12 g-col-md-6"><label class="form-label small mb-1">Name</label><input class="form-control form-control-sm" data-f="name" maxlength="100" value="' + esc(node.name) + '"></div>' +
        '<div class="g-col-4 g-col-md-2"><label class="form-label small mb-1">Colour</label><input type="color" class="form-control form-control-sm form-control-color w-100" data-f="color" value="' + color(node) + '"></div>' +
        '<div class="g-col-8 g-col-md-4"><label class="form-label small mb-1">Place under</label><select class="form-select form-select-sm" data-f="parent">' + placementOptions(node.id, current) + "</select></div>" +
        '<div class="g-col-12"><label class="form-label small mb-1">Memo</label><textarea class="form-control form-control-sm" rows="2" data-f="memo">' + esc(node.memo || "") + "</textarea></div>" +
        '</div><div class="d-flex gap-2 mt-2"><button type="button" class="btn btn-sm btn-primary" data-act="save-edit">Save</button>' +
        '<button type="button" class="btn btn-sm btn-outline-secondary" data-act="cancel-edit">Cancel</button></div></div>';
    }
    return html + node.children.map(function (c) { return codebookRow(c, depth + 1, stats); }).join("");
  }

  function analysisForm(a) {
    return '<div class="tb-cb-edit" data-analysis-form="' + esc(a ? a.id : "") + '"><div class="grid gap-2">' +
      '<div class="g-col-12 g-col-md-5"><label class="form-label small mb-1">Analysis name</label><input class="form-control form-control-sm" data-f="name" maxlength="100" placeholder="e.g. Youth political uprising factors" value="' + esc(a ? a.name : "") + '"></div>' +
      '<div class="g-col-12 g-col-md-7"><label class="form-label small mb-1">Research question (optional)</label><input class="form-control form-control-sm" data-f="question" maxlength="300" value="' + esc(a ? a.question || "" : "") + '"></div>' +
      '</div><div class="d-flex gap-2 mt-2"><button type="button" class="btn btn-sm btn-primary" data-act="save-analysis">' + (a ? "Save" : "Add analysis") + "</button>" +
      '<button type="button" class="btn btn-sm btn-outline-secondary" data-act="cancel-analysis">Cancel</button></div></div>';
  }

  function renderCodebookEditor() {
    var stats = {};
    TB.allThemeStats(project).forEach(function (s) { stats[s.themeId] = s; });
    var el = $("#tb-theme-tree-editor");
    el.innerHTML = project.analyses.map(function (a) {
      var tree = TB.themeTree(project, a.id);
      var head = cb.renaming === a.id ? analysisForm(a)
        : '<div class="tb-cb-analysis-head"><div class="min-w-0"><div class="fw-semibold"><i class="bi bi-journal-text me-1"></i>' + esc(a.name) + "</div>" +
          (a.question ? '<div class="small text-muted">' + esc(a.question) + "</div>" : "") + "</div>" +
          '<span class="tb-cb-actions">' +
          '<button type="button" class="btn btn-sm btn-link" data-act="rename-analysis" data-analysis-id="' + esc(a.id) + '" title="Rename this analysis"><i class="bi bi-pencil"></i></button>' +
          '<button type="button" class="btn btn-sm btn-link text-danger" data-act="delete-analysis" data-analysis-id="' + esc(a.id) + '"' +
          (project.analyses.length < 2 ? ' disabled title="A project needs at least one analysis"' : ' title="Delete this analysis and its themes"') + '><i class="bi bi-trash"></i></button>' +
          "</span></div>";
      return '<section class="tb-cb-analysis">' + head +
        (tree.length ? tree.map(function (n) { return codebookRow(n, 0, stats); }).join("") : '<p class="small text-muted mb-2">No themes yet — add one below.</p>') +
        "</section>";
    }).join("") + (cb.addingAnalysis ? analysisForm(null) : "");
    $("#tb-cb-add-analysis").classList.toggle("d-none", cb.addingAnalysis);
    var parent = $("#tbf-theme-parent");
    var keep = parent.value;
    parent.innerHTML = placementOptions(null, keep || "@" + project.analyses[0].id);
    var focus = $("[data-f=name]", el);
    if (focus && (cb.editing || cb.renaming || cb.addingAnalysis)) focus.focus();
  }

  function refreshAfterCodebook(message) {
    renderCodebookEditor();
    renderAll();
    if (message) notify(message);
  }

  function wireCodebookModal() {
    var el = $("#tb-theme-tree-editor");
    el.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-act]");
      if (!btn || btn.disabled) return;
      var actName = btn.getAttribute("data-act");
      var row = btn.closest("[data-theme-id]");
      var themeId = row && row.getAttribute("data-theme-id");
      var t = themeId && TB.themeById(project, themeId);
      var analysisId = btn.getAttribute("data-analysis-id");

      if (actName === "promote") {
        act("promote “" + t.name + "”", function () { return TB.promoteTheme(project, themeId); });
        refreshAfterCodebook("“" + t.name + "” moved up a level.");
      } else if (actName === "demote") {
        var prev = TB.previousSibling(project, themeId);
        act("demote “" + t.name + "”", function () { return TB.demoteTheme(project, themeId); });
        refreshAfterCodebook("“" + t.name + "” is now a sub-theme of “" + (prev ? prev.name : "") + "”.");
      } else if (actName === "edit") {
        cb.editing = cb.editing === themeId ? null : themeId;
        renderCodebookEditor();
      } else if (actName === "cancel-edit") {
        cb.editing = null;
        renderCodebookEditor();
      } else if (actName === "save-edit") {
        var form = btn.closest(".tb-cb-edit");
        var name = $("[data-f=name]", form).value.trim();
        if (!name) { $("[data-f=name]", form).classList.add("is-invalid"); return; }
        var place = $("[data-f=parent]", form).value;
        var patch = { name: name, color: $("[data-f=color]", form).value, memo: $("[data-f=memo]", form).value };
        var current = t.parentId || "@" + TB.analysisIdOfTheme(project, themeId);
        act("edit “" + t.name + "”", function () {
          TB.updateTheme(project, themeId, patch);
          if (place !== current) {
            if (place.charAt(0) === "@") TB.moveTheme(project, themeId, null, place.slice(1));
            else TB.moveTheme(project, themeId, place);
          }
        });
        cb.editing = null;
        refreshAfterCodebook("Theme updated.");
      } else if (actName === "delete") {
        var subs = TB.descendantThemeIds(project, themeId).length;
        var uses = TB.themeStats(project, themeId).frequency;
        if (!window.confirm("Delete “" + t.name + "”" + (subs ? " and its " + plural(subs, "sub-theme") : "") + "?\n\n" +
          plural(uses, "coded reference") + " use it. They keep any other themes they have; ones with no other theme are removed.\n\nYou can undo this.")) return;
        act("delete “" + t.name + "”", function () { TB.deleteTheme(project, themeId); });
        if (cb.editing === themeId) cb.editing = null;
        refreshAfterCodebook("“" + t.name + "” deleted.");
      } else if (actName === "rename-analysis") {
        cb.renaming = analysisId;
        renderCodebookEditor();
      } else if (actName === "delete-analysis") {
        var a = TB.analysisById(project, analysisId);
        var n = TB.themesInAnalysis(project, analysisId).length;
        if (!window.confirm("Delete the thematic analysis “" + a.name + "” and its " + plural(n, "theme") + "?\n\nPassages keep the codes they have in your other analyses.\n\nYou can undo this.")) return;
        act("delete analysis “" + a.name + "”", function () { return TB.deleteAnalysis(project, analysisId); });
        refreshAfterCodebook("Analysis “" + a.name + "” deleted.");
      } else if (actName === "save-analysis") {
        var f = btn.closest("[data-analysis-form]");
        var aname = $("[data-f=name]", f).value.trim();
        if (!aname) { $("[data-f=name]", f).classList.add("is-invalid"); return; }
        var question = $("[data-f=question]", f).value.trim();
        var existing = f.getAttribute("data-analysis-form");
        if (existing) act("rename an analysis", function () { TB.updateAnalysis(project, existing, { name: aname, question: question }); });
        else act("add a thematic analysis", function () { return TB.addAnalysis(project, { name: aname, question: question }); });
        cb.renaming = null;
        cb.addingAnalysis = false;
        refreshAfterCodebook(existing ? "Analysis renamed." : "Analysis “" + aname + "” added.");
      } else if (actName === "cancel-analysis") {
        cb.renaming = null;
        cb.addingAnalysis = false;
        renderCodebookEditor();
      }
    });
    el.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
      var box = e.target.closest(".tb-cb-edit");
      var save = box && $('[data-act="save-edit"], [data-act="save-analysis"]', box);
      if (save) { e.preventDefault(); save.click(); }
    });
    $("#tb-cb-add-analysis").addEventListener("click", function () {
      cb.addingAnalysis = true;
      renderCodebookEditor();
    });
    $("#tb-add-theme-btn").addEventListener("click", function () {
      var name = $("#tbf-theme-name").value.trim();
      if (!name) { $("#tbf-theme-name").classList.add("is-invalid"); $("#tbf-theme-name").focus(); return; }
      $("#tbf-theme-name").classList.remove("is-invalid");
      var place = $("#tbf-theme-parent").value;
      var fields = { name: name, color: $("#tbf-theme-color").value };
      if (place.charAt(0) === "@") fields.analysisId = place.slice(1); else fields.parentId = place;
      act("add “" + name + "”", function () { return TB.addTheme(project, fields); });
      $("#tbf-theme-name").value = "";
      $("#tbf-theme-color").value = TB.suggestColor(project);
      refreshAfterCodebook("“" + name + "” added.");
    });
    $("#tbf-theme-name").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); $("#tb-add-theme-btn").click(); }
    });
  }

  // ------------------------------------------------------------- sources
  function renderTags() {
    var box = $("#tbf-stakeholder-tags");
    $all(".tb-tag", box).forEach(function (n) { n.remove(); });
    var input = $("#tbf-source-stakeholder");
    stakeholderTags.forEach(function (tag, i) {
      var span = document.createElement("span");
      span.className = "tb-tag";
      span.innerHTML = esc(tag) + '<button type="button" aria-label="Remove ' + esc(tag) + '" data-tag-index="' + i + '">&times;</button>';
      box.insertBefore(span, input);
    });
    var chosen = {};
    stakeholderTags.forEach(function (t) { chosen[t.toLowerCase()] = true; });
    $("#tbf-stakeholder-options").innerHTML = TB.stakeholderSuggestions(project)
      .filter(function (s) { return !chosen[s.toLowerCase()]; })
      .map(function (s) { return '<option value="' + esc(s) + '">'; }).join("");
  }
  function addTag(value) {
    String(value || "").split(/[,;]/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (v) {
      if (!stakeholderTags.some(function (t) { return t.toLowerCase() === v.toLowerCase(); })) stakeholderTags.push(v);
    });
    $("#tbf-source-stakeholder").value = "";
    renderTags();
  }

  function updateParticipantTotal() {
    var total = ["women", "men", "undisclosed"].reduce(function (sum, k) {
      var v = Number($("#tbf-part-" + k).value);
      return sum + (isFinite(v) && v > 0 ? Math.floor(v) : 0);
    }, 0);
    $("#tbf-part-total").textContent = total;
  }

  function openSourceModal(sourceId) {
    var s = sourceId ? sourceById(sourceId) : null;
    var a = (s && s.attributes) || {};
    var parts = (a.participants) || {};
    $("#tbf-source-id").value = sourceId || "";
    $("#tbf-source-type").value = s ? s.type : "KII";
    $("#tbf-source-name").value = s ? s.name : "";
    $("#tbf-source-respondentid").value = a.respondentId || "";
    $("#tbf-source-sex").value = a.sex || "";
    $("#tbf-source-location").value = a.location || "";
    $("#tbf-source-institution").value = a.institution || "";
    $("#tbf-part-women").value = parts.women || "";
    $("#tbf-part-men").value = parts.men || "";
    $("#tbf-part-undisclosed").value = parts.undisclosed || "";
    $("#tbf-source-speakers").value = s ? (s.speakers || []).map(function (sp) { return sp.label; }).join(", ") : "";
    $("#tbf-source-text").value = s ? s.text : "";
    $("#tbf-source-memo").value = s ? s.memo || "" : "";
    $("#tbf-source-file").value = "";
    stakeholderTags = s ? TB.attrValues(a, "stakeholder").slice() : [];
    $("#tbf-source-stakeholder").value = "";
    renderTags();
    updateParticipantTotal();
    $('input[name="srcImportMode"][value="paste"]').checked = true;
    $("#tb-modal-add-source .modal-title").textContent = s ? "Edit Source" : "Add Source";
    $("#tb-save-source-btn").textContent = s ? "Save Changes" : "Add Source";
    $("#tb-delete-source-btn").classList.toggle("d-none", !s);
    $("#tbf-text-note").classList.toggle("d-none", !s || !TB.codingsForSource(project, s.id).length);
    toggleTypeFields();
    toggleImportFields();
    window.bootstrap.Modal.getOrCreateInstance($("#tb-modal-add-source")).show();
  }

  function toggleTypeFields() {
    var isGroup = $("#tbf-source-type").value === "FGD";
    $("#tbf-speakers-wrap").classList.toggle("d-none", !isGroup);
    $("#tbf-participants-wrap").classList.toggle("d-none", !isGroup);
    $("#tbf-sex-wrap").classList.toggle("d-none", isGroup);
    $("#tbf-respondentid-label").textContent = isGroup ? "Group ID" : "Respondent ID";
    $("#tbf-attr-legend").textContent = isGroup ? "Group attributes" : "Respondent / source attributes";
  }
  function toggleImportFields() {
    var importMode = $('input[name="srcImportMode"]:checked').value;
    $("#tbf-text-wrap").classList.toggle("d-none", importMode !== "paste");
    $("#tbf-file-wrap").classList.toggle("d-none", importMode === "paste");
    $("#tbf-source-file").accept = importMode === "docx" ? ".docx" : importMode === "csv" ? ".csv,.xlsx,.xls" : ".txt";
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }
  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  function deleteSource(sourceId) {
    var s = sourceById(sourceId);
    if (!s) return;
    var n = TB.codingsForSource(project, sourceId).length;
    if (!window.confirm("Delete “" + s.name + "”" + (n ? " and its " + plural(n, "coded reference") : "") + "?\n\nYou can undo this with the Undo button.")) return false;
    act("delete “" + s.name + "”", function () { TB.deleteSource(project, sourceId); });
    if (activeSourceId === sourceId) activeSourceId = null;
    resetPanel();
    renderAll();
    notify("“" + s.name + "” deleted.");
    return true;
  }

  function wireSourceModal() {
    $("#tbf-source-type").addEventListener("change", toggleTypeFields);
    $all('input[name="srcImportMode"]').forEach(function (r) { r.addEventListener("change", toggleImportFields); });
    ["women", "men", "undisclosed"].forEach(function (k) { $("#tbf-part-" + k).addEventListener("input", updateParticipantTotal); });

    var tagInput = $("#tbf-source-stakeholder");
    tagInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagInput.value); }
      else if (e.key === "Backspace" && !tagInput.value && stakeholderTags.length) { stakeholderTags.pop(); renderTags(); }
    });
    tagInput.addEventListener("change", function () { if (tagInput.value.trim()) addTag(tagInput.value); });
    $("#tbf-stakeholder-tags").addEventListener("click", function (e) {
      var x = e.target.closest("[data-tag-index]");
      if (x) { stakeholderTags.splice(Number(x.getAttribute("data-tag-index")), 1); renderTags(); }
      else tagInput.focus();
    });

    $("#tb-delete-source-btn").addEventListener("click", function () {
      var id = $("#tbf-source-id").value;
      var modal = window.bootstrap.Modal.getInstance($("#tb-modal-add-source"));
      if (deleteSource(id)) modal.hide();
    });

    $("#tb-save-source-btn").addEventListener("click", function () {
      var importMode = $('input[name="srcImportMode"]:checked').value;
      var name = $("#tbf-source-name").value.trim() || $("#tbf-source-respondentid").value.trim() || "Untitled Source";
      var type = $("#tbf-source-type").value;
      var isGroup = type === "FGD";
      if (tagInput.value.trim()) addTag(tagInput.value);
      var existingId = $("#tbf-source-id").value || null;
      var existing = existingId ? sourceById(existingId) : null;
      var labels = isGroup ? $("#tbf-source-speakers").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean) : [];
      function num(id) { var v = Number($(id).value); return isFinite(v) && v > 0 ? Math.floor(v) : 0; }
      var attributes = {
        respondentId: $("#tbf-source-respondentid").value.trim(),
        sex: isGroup ? "" : $("#tbf-source-sex").value.trim(),
        location: $("#tbf-source-location").value.trim(),
        stakeholder: stakeholderTags.slice(),
        institution: $("#tbf-source-institution").value.trim()
      };
      if (isGroup) attributes.participants = { women: num("#tbf-part-women"), men: num("#tbf-part-men"), undisclosed: num("#tbf-part-undisclosed") };
      var memo = $("#tbf-source-memo").value;

      function finish(text) {
        if (existing) {
          var plan = text !== existing.text ? TB.planReanchor(project, existing.id, text) : { moves: [], lost: [] };
          if (plan.lost.length && !window.confirm(plural(plan.lost.length, "coded passage") + " no longer appear in the edited text and will be removed:\n\n" +
            plan.lost.slice(0, 5).map(function (c) { return "• “" + (c.quote.length > 80 ? c.quote.slice(0, 79) + "…" : c.quote) + "”"; }).join("\n") +
            (plan.lost.length > 5 ? "\n…" : "") + "\n\nSave anyway? (You can undo.)")) return;
          act("edit “" + existing.name + "”", function () {
            TB.applyReanchor(project, plan);
            var speakers = isGroup ? TB.mergeSpeakers(project, existing, labels) : [];
            TB.updateSource(project, existing.id, { type: type, name: name, text: text, attributes: attributes, speakers: speakers, memo: memo });
          });
          activeSourceId = existing.id;
        } else {
          var src = act("add “" + name + "”", function () {
            return TB.addSource(project, { type: type, name: name, text: text, attributes: attributes, speakers: TB.mergeSpeakers(project, null, labels), memo: memo });
          });
          activeSourceId = src.id;
        }
        window.bootstrap.Modal.getInstance($("#tb-modal-add-source")).hide();
        resetPanel();
        renderAll();
        notify(existing ? "Source updated." : "“" + name + "” added.");
      }

      if (importMode === "paste") { finish($("#tbf-source-text").value); return; }
      var file = $("#tbf-source-file").files[0];
      if (!file) { alert("Choose a file to upload, or switch to Paste Text."); return; }

      if (importMode === "txt") {
        readFileAsText(file).then(finish);
      } else if (importMode === "docx") {
        if (!window.mammoth) { alert("The DOCX reader library did not load — check your internet connection and try again."); return; }
        readFileAsArrayBuffer(file).then(function (buf) {
          return window.mammoth.extractRawText({ arrayBuffer: buf });
        }).then(function (result) { finish(result.value); });
      } else if (importMode === "csv") {
        if (!window.XLSX) { alert("The spreadsheet reader library did not load — check your internet connection and try again."); return; }
        readFileAsArrayBuffer(file).then(function (buf) {
          var wb = window.XLSX.read(buf, { type: "array" });
          var rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
          finish(rows.map(function (row) { return row.join(" — "); }).join("\n\n"));
        });
      }
    });
  }

  // ---------------------------------------------------------------- init
  function wireLists() {
    function pick(el) {
      if (!el) return;
      activeSourceId = el.getAttribute("data-source-id");
      resetPanel();
      renderAll();
    }
    var list = $("#tb-sources-list");
    list.addEventListener("click", function (e) { pick(e.target.closest(".tb-source-item")); });
    list.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(e.target.closest(".tb-source-item")); }
    });
    $("#tb-lens-bar").addEventListener("click", function (e) {
      var lens = e.target.closest("[data-lens-id]");
      if (!lens) return;
      var id = lens.getAttribute("data-lens-id");
      if (hiddenLenses[id]) delete hiddenLenses[id]; else hiddenLenses[id] = true;
      renderLensBar();
      renderTranscript();
    });
    $all('input[name="tbTxView"]').forEach(function (r) {
      r.addEventListener("change", function () { setView(r.value); });
    });
    $("#tb-refs-list").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-act]");
      if (!btn) return;
      var id = btn.closest("[data-coding-id]").getAttribute("data-coding-id");
      if (btn.getAttribute("data-act") === "delete") { deleteCoding(id); return; }
      setView("text");
      openEdit([id]);
      flashId = id;
      renderTranscript();
      scrollToCoding(id);
      setTimeout(function () { flashId = null; }, 2600);
    });
  }

  // ?source=<id> opens a transcript; &coding=<id> also scrolls to and
  // flashes that coded reference (links from the dashboard and evidence).
  function applyUrlParams() {
    var params = new URLSearchParams(window.location.search);
    var c = params.get("coding") ? codingById(params.get("coding")) : null;
    if (c) { activeSourceId = c.sourceId; flashId = c.id; return; }
    var sid = params.get("source");
    if (sid && sourceById(sid)) activeSourceId = sid;
  }
  function scrollToFlash() {
    if (!flashId) return;
    scrollToCoding(flashId);
    setTimeout(function () { flashId = null; }, 2600);
  }

  function init() {
    TB = window.TB;
    project = TB.getActiveProject();
    if (!project) { renderAll(); return; }
    document.body.appendChild($("#tb-code-selection-btn"));
    applyUrlParams();
    renderAll();
    renderHistory();
    wireLists();
    wirePanel();
    setupSelectionHandling();
    wireCodebookModal();
    wireSourceModal();
    $("#tb-add-source-btn").addEventListener("click", function () { openSourceModal(null); });
    $("#tb-manage-themes-btn").addEventListener("click", openCodebookModal);
    $("#tb-edit-project-btn").addEventListener("click", function () {
      TB.ui.openProjectModal(project, { onSaved: function () { renderAll(); } });
    });
    scrollToFlash();
  }

  window.TB = window.TB || {};
  window.TB.workspace = { init: init };
})();

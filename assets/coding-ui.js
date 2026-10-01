/*
 * Coding Workspace behaviour — sources list, transcript rendering with
 * highlighted coded spans, and the coding panel: select a passage once,
 * tick every theme it speaks to across all theme groups (e.g. a cause, a
 * challenge and an impact), weight, memo, apply. Also codebook management
 * and source import (paste/txt/docx/csv).
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
  var hiddenLenses = {};    // top-level themeId -> true when its highlights are hidden
  var addingUnder;          // parent id ("" = top level) while an inline "add theme" input is open
  var justCaptured = false;
  var mouseDown = false;
  var candidate = null;
  var flashId = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) { return TB.escapeHtml(s); }
  function color(t) { return esc(TB.safeColor(t.color)); }

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
    $("#tb-project-meta").textContent = [project.researcher, project.org,
      project.sources.length + " source(s)", project.codings.length + " coded reference(s)"].filter(Boolean).join(" · ");

    if (activeSourceId && !activeSource()) activeSourceId = null;
    if (!activeSourceId && project.sources.length) activeSourceId = project.sources[0].id;

    renderSourceList();
    renderLensBar();
    renderTranscript();
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

  function renderLensBar() {
    var tops = TB.childThemes(project, null);
    var bar = $("#tb-lens-bar");
    if (tops.length < 2) { bar.innerHTML = ""; return; }
    bar.innerHTML = '<span class="small text-muted me-1" style="font-family:var(--bs-body-font-family);font-weight:400;">Highlight:</span>' +
      tops.map(function (t) {
        return '<button type="button" class="tb-lens" data-lens-id="' + esc(t.id) + '" aria-pressed="' + (hiddenLenses[t.id] ? "false" : "true") +
          '" style="--chip-color:' + color(t) + '" title="Show or hide highlights coded under ' + esc(t.name) + '"><span class="dot"></span>' + esc(t.name) + "</button>";
      }).join("");
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

  function renderTranscript() {
    var src = activeSource();
    var nameEl = $("#tb-active-source-name");
    var body = $("#tb-transcript-text");
    var attrsEl = $("#tb-source-attributes");
    if (!src) {
      nameEl.textContent = "No source selected";
      body.innerHTML = '<p class="text-muted">Add or select a source on the left to start reading and coding.</p>';
      attrsEl.innerHTML = "";
      return;
    }
    nameEl.textContent = src.name + " (" + src.type + ")";

    if (!src.text) {
      body.innerHTML = '<p class="text-muted">This source has no text yet.</p>';
    } else {
      var order = treeOrder();
      var spans = [];
      TB.codingsForSource(project, src.id).forEach(function (c) {
        var ids = (c.themeIds || []).filter(function (id) { return !hiddenLenses[TB.topLevelThemeId(project, id)]; });
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
          ' title="' + esc(themes.map(function (t) { return TB.themePath(project, t.id); }).join("\n")) + '">' +
          esc(seg.text) + "</mark>";
      }).join("");
    }

    var a = src.attributes || {};
    var rows = [["Respondent ID", a.respondentId], ["Sex", a.sex], ["Location", a.location],
      ["Stakeholder", a.stakeholder], ["Institution", a.institution]].filter(function (r) { return r[1]; });
    if (src.type === "FGD" && src.speakers && src.speakers.length) {
      rows.push(["Speakers", src.speakers.map(function (sp) { return sp.label; }).join(", ")]);
    }
    attrsEl.innerHTML = '<div class="d-flex justify-content-between align-items-start gap-2">' +
      '<div class="d-flex flex-wrap">' + rows.map(function (r) {
        return '<span class="tb-meta-pill"><strong class="me-1">' + esc(r[0]) + ":</strong>" + esc(r[1]) + "</span>";
      }).join("") + "</div>" +
      '<button type="button" class="btn btn-sm btn-outline-secondary flex-shrink-0" id="tb-edit-source-btn" title="Edit source"><i class="bi bi-pencil"></i></button>' +
      "</div>" +
      (src.memo ? '<p class="text-muted small mt-2 mb-0"><i class="bi bi-sticky"></i> ' + esc(src.memo) + "</p>" : "");
    $("#tb-edit-source-btn").addEventListener("click", function () { openSourceModal(src.id); });
  }

  // --------------------------------------------------------- coding panel
  function chipHtml(node, stats) {
    var on = !!selected[node.id];
    var title = TB.themePath(project, node.id) + (node.memo ? " — " + node.memo : "");
    return '<button type="button" class="tb-chip" data-theme-id="' + esc(node.id) + '" aria-pressed="' + on + '"' +
      (mode === "idle" ? " disabled" : "") + ' style="--chip-color:' + color(node) + '" title="' + esc(title) + '">' +
      '<span class="dot"></span>' + esc(node.name) + ' <span class="n">' + ((stats[node.id] || {}).frequency || 0) + "</span></button>";
  }
  function addHtml(parentId) {
    if (addingUnder === parentId) {
      return '<input type="text" class="tb-chip-input" data-add-input="' + esc(parentId) + '" maxlength="80" placeholder="' +
        (parentId ? "New sub-theme, then Enter" : "New theme, then Enter") + '" aria-label="New theme name">';
    }
    return '<button type="button" class="tb-chip tb-chip-add" data-add-parent="' + esc(parentId) + '">' +
      '<i class="bi bi-plus-lg"></i>' + (parentId ? "Add" : "New theme") + "</button>";
  }
  function nestedHtml(children, stats) {
    return children.filter(function (c) { return c.children.length; }).map(function (c) {
      return '<div class="tb-cp-nested"><div class="tb-cp-nested-label">' + esc(c.name) + " ›</div>" +
        '<div class="tb-cp-chips">' + c.children.map(function (g) { return chipHtml(g, stats); }).join("") + addHtml(c.id) + "</div>" +
        nestedHtml(c.children, stats) + "</div>";
    }).join("");
  }

  function renderThemeGroups() {
    var tree = TB.themeTree(project);
    var stats = {};
    TB.allThemeStats(project).forEach(function (s) { stats[s.themeId] = s; });
    var el = $("#tb-cp-themes");
    el.innerHTML = (tree.length ? tree.map(function (node) {
      return '<div class="tb-cp-group" style="--group-color:' + color(node) + '">' +
        '<div class="tb-cp-group-head">' + chipHtml(node, stats) +
        '<span class="small text-muted">' + node.children.length + " sub-theme" + (node.children.length === 1 ? "" : "s") + "</span></div>" +
        '<div class="tb-cp-chips">' + node.children.map(function (c) { return chipHtml(c, stats); }).join("") + addHtml(node.id) + "</div>" +
        nestedHtml(node.children, stats) +
        "</div>";
    }).join("") : '<p class="small text-muted">No themes yet. A good start is one theme per research question — for example <em>Causes</em>, <em>Challenges</em> and <em>Impacts</em>.</p>') +
      '<div class="mt-1">' + addHtml("") + "</div>";
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
    $("#tb-cp-apply").disabled = mode === "idle" || n === 0;
    $("#tb-cp-apply-label").textContent = mode === "edit" ? "Save changes"
      : mode === "idle" ? "Apply codes"
      : n ? "Apply " + n + " code" + (n === 1 ? "" : "s") : "Tick at least one theme";
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
      quoteEl.textContent = activeSource() ? "Select a passage in the transcript to code it." : "Add or select a source first.";
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
      : "";
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

  function showStatus(msg) {
    var el = $("#tb-cp-status");
    el.textContent = msg;
    el.classList.toggle("d-none", !msg);
    clearTimeout(showStatus.timer);
    if (msg) showStatus.timer = setTimeout(function () { el.classList.add("d-none"); }, 3500);
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
    if (mode === "idle" || !ids.length) return;
    var weight = $("#tb-cp-weight-toggle").checked ? Number($("#tb-cp-weight").value) : null;
    var memo = $("#tb-cp-memo").value;
    var speaker = $("[data-speaker-wrap]").classList.contains("d-none") ? null : (speakerId || null);
    var msg;
    if (mode === "new") {
      var c = TB.addCoding(project, {
        sourceId: activeSourceId, speakerId: speaker, themeIds: ids,
        start: pending.start, end: pending.end, quote: pending.quote, weight: weight, memo: memo
      });
      flashId = c.id;
      msg = "Coded to " + ids.length + " theme" + (ids.length === 1 ? "" : "s") + ".";
    } else {
      TB.updateCoding(project, editingId, { themeIds: ids, speakerId: speaker, weight: weight, memo: memo });
      flashId = editingId;
      msg = "Changes saved.";
    }
    resetPanel();
    renderAll();
    showStatus(msg);
    setTimeout(function () { flashId = null; }, 2600);
  }

  function deleteCurrent() {
    if (mode !== "edit" || !confirm("Remove this coded reference? This cannot be undone.")) return;
    TB.deleteCoding(project, editingId);
    resetPanel();
    renderAll();
    showStatus("Coded reference removed.");
  }

  function commitInlineAdd(input) {
    var name = input.value.trim();
    var parentId = input.getAttribute("data-add-input") || null;
    addingUnder = undefined;
    if (name) {
      var t = TB.addTheme(project, { name: name, parentId: parentId });
      if (mode !== "idle") selected[t.id] = true;
    }
    renderLensBar();
    renderThemeGroups();
    updateApplyButton();
  }

  function wirePanel() {
    var themesEl = $("#tb-cp-themes");
    themesEl.addEventListener("click", function (e) {
      var chip = e.target.closest("[data-theme-id]");
      if (chip) {
        if (chip.disabled) return;
        var id = chip.getAttribute("data-theme-id");
        if (selected[id]) delete selected[id]; else selected[id] = true;
        chip.setAttribute("aria-pressed", selected[id] ? "true" : "false");
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

    document.addEventListener("keydown", function (e) {
      if (document.querySelector(".modal.show")) return;
      if (e.key === "Escape" && mode !== "idle") { resetPanel(); renderTranscript(); renderPanel(); }
      else if (e.key === "Enter" && mode !== "idle" && e.target === document.body) { e.preventDefault(); applyCoding(); }
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
    renderCodebookEditor();
    $("#tbf-theme-color").value = TB.suggestColor(project);
    new bootstrap.Modal($("#tb-modal-codebook")).show();
  }

  function renderCodebookEditor() {
    var tree = TB.themeTree(project);
    function renderNode(node, depth) {
      return '<div class="d-flex align-items-center gap-2 mb-1" style="margin-left:' + (depth * 1.1) + 'rem;">' +
        '<span class="d-inline-block flex-shrink-0" style="background:' + color(node) + ';width:.8rem;height:.8rem;border-radius:3px;"></span>' +
        '<span class="flex-grow-1">' + esc(node.name) + (node.memo ? ' <i class="bi bi-sticky text-muted" title="' + esc(node.memo) + '"></i>' : "") + "</span>" +
        '<button type="button" class="btn btn-sm btn-link p-0 tb-theme-edit-memo" data-theme-id="' + esc(node.id) + '" title="Edit memo"><i class="bi bi-chat-square-text"></i></button>' +
        '<button type="button" class="btn btn-sm btn-link p-0 text-danger tb-theme-delete" data-theme-id="' + esc(node.id) + '" title="Delete"><i class="bi bi-trash"></i></button>' +
        "</div>" +
        node.children.map(function (c) { return renderNode(c, depth + 1); }).join("");
    }
    $("#tb-theme-tree-editor").innerHTML = tree.length ? tree.map(function (n) { return renderNode(n, 0); }).join("") : '<p class="text-muted small">No themes yet.</p>';
    $("#tbf-theme-parent").innerHTML = '<option value="">(top-level theme)</option>' +
      TB.themesInTreeOrder(project).map(function (t) {
        return '<option value="' + esc(t.id) + '">' + esc(TB.themePath(project, t.id)) + "</option>";
      }).join("");

    $all(".tb-theme-delete", $("#tb-theme-tree-editor")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("Delete this theme (and its sub-themes)? Coded references keep any other themes they also have.")) return;
        TB.deleteTheme(project, btn.getAttribute("data-theme-id"));
        renderCodebookEditor();
        renderAll();
      });
    });
    $all(".tb-theme-edit-memo", $("#tb-theme-tree-editor")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var t = TB.themeById(project, btn.getAttribute("data-theme-id"));
        var memo = prompt("Theme memo for \"" + t.name + "\":", t.memo || "");
        if (memo === null) return;
        TB.updateTheme(project, t.id, { memo: memo });
        renderCodebookEditor();
      });
    });
  }

  function wireCodebookModal() {
    $("#tb-add-theme-btn").addEventListener("click", function () {
      var name = $("#tbf-theme-name").value.trim();
      if (!name) { alert("Enter a theme name."); return; }
      TB.addTheme(project, {
        name: name,
        parentId: $("#tbf-theme-parent").value || null,
        color: $("#tbf-theme-color").value
      });
      $("#tbf-theme-name").value = "";
      $("#tbf-theme-color").value = TB.suggestColor(project);
      renderCodebookEditor();
      renderAll();
    });
  }

  // ------------------------------------------------------------- sources
  function openSourceModal(sourceId) {
    $("#tbf-source-id").value = sourceId || "";
    $("#tbf-source-type").value = "KII";
    $("#tbf-source-name").value = "";
    $("#tbf-source-respondentid").value = "";
    $("#tbf-source-sex").value = "";
    $("#tbf-source-location").value = "";
    $("#tbf-source-stakeholder").value = "";
    $("#tbf-source-institution").value = "";
    $("#tbf-source-speakers").value = "";
    $("#tbf-source-text").value = "";
    $("#tbf-source-memo").value = "";
    $('input[name="srcImportMode"][value="paste"]').checked = true;
    $("#tb-modal-add-source .modal-title").textContent = sourceId ? "Edit Source" : "Add Source";
    $("#tb-save-source-btn").textContent = sourceId ? "Save Changes" : "Add Source";
    if (sourceId) {
      var s = sourceById(sourceId);
      $("#tbf-source-type").value = s.type;
      $("#tbf-source-name").value = s.name;
      $("#tbf-source-respondentid").value = (s.attributes && s.attributes.respondentId) || "";
      $("#tbf-source-sex").value = (s.attributes && s.attributes.sex) || "";
      $("#tbf-source-location").value = (s.attributes && s.attributes.location) || "";
      $("#tbf-source-stakeholder").value = (s.attributes && s.attributes.stakeholder) || "";
      $("#tbf-source-institution").value = (s.attributes && s.attributes.institution) || "";
      $("#tbf-source-speakers").value = (s.speakers || []).map(function (sp) { return sp.label; }).join(", ");
      $("#tbf-source-text").value = s.text;
      $("#tbf-source-memo").value = s.memo || "";
    }
    toggleSpeakerField();
    toggleImportFields();
    new bootstrap.Modal($("#tb-modal-add-source")).show();
  }

  function toggleSpeakerField() {
    $("#tbf-speakers-wrap").classList.toggle("d-none", $("#tbf-source-type").value !== "FGD");
  }
  function toggleImportFields() {
    var mode = $('input[name="srcImportMode"]:checked').value;
    $("#tbf-text-wrap").classList.toggle("d-none", mode !== "paste");
    $("#tbf-file-wrap").classList.toggle("d-none", mode === "paste");
    $("#tbf-source-file").accept = mode === "docx" ? ".docx" : mode === "csv" ? ".csv,.xlsx,.xls" : ".txt";
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

  function wireSourceModal() {
    $("#tbf-source-type").addEventListener("change", toggleSpeakerField);
    $all('input[name="srcImportMode"]').forEach(function (r) { r.addEventListener("change", toggleImportFields); });

    $("#tb-save-source-btn").addEventListener("click", function () {
      var importMode = $('input[name="srcImportMode"]:checked').value;
      var name = $("#tbf-source-name").value.trim() || $("#tbf-source-respondentid").value.trim() || "Untitled Source";
      var type = $("#tbf-source-type").value;
      var speakers = [];
      if (type === "FGD") {
        speakers = $("#tbf-source-speakers").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean)
          .map(function (label, i) { return { id: "sp" + i, label: label }; });
      }
      var attributes = {
        respondentId: $("#tbf-source-respondentid").value.trim(),
        sex: $("#tbf-source-sex").value.trim(),
        location: $("#tbf-source-location").value.trim(),
        stakeholder: $("#tbf-source-stakeholder").value.trim(),
        institution: $("#tbf-source-institution").value.trim()
      };
      var memo = $("#tbf-source-memo").value;
      var existingId = $("#tbf-source-id").value || null;

      function finish(text) {
        if (existingId) {
          TB.updateSource(project, existingId, { type: type, name: name, text: text, attributes: attributes, speakers: speakers, memo: memo });
          activeSourceId = existingId;
        } else {
          activeSourceId = TB.addSource(project, { type: type, name: name, text: text, attributes: attributes, speakers: speakers, memo: memo }).id;
        }
        bootstrap.Modal.getInstance($("#tb-modal-add-source")).hide();
        resetPanel();
        renderAll();
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
    var target = flashId;
    var mark = $all("#tb-transcript-text mark.tb-coded").find(function (m) {
      return m.getAttribute("data-coding-ids").split(",").indexOf(target) !== -1;
    });
    if (mark) mark.scrollIntoView({ block: "center" });
    setTimeout(function () { flashId = null; }, 2600);
  }

  function init() {
    TB = window.TB;
    project = TB.getActiveProject();
    if (!project) { renderAll(); return; }
    document.body.appendChild($("#tb-code-selection-btn"));
    applyUrlParams();
    renderAll();
    wireLists();
    wirePanel();
    setupSelectionHandling();
    wireCodebookModal();
    wireSourceModal();
    $("#tb-add-source-btn").addEventListener("click", function () { openSourceModal(null); });
    $("#tb-manage-themes-btn").addEventListener("click", openCodebookModal);
    scrollToFlash();
  }

  window.TB = window.TB || {};
  window.TB.workspace = { init: init };
})();

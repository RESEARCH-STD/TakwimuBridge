/*
 * Coding Workspace behaviour — sources list, transcript rendering with
 * highlighted coded spans, text-selection → apply-code flow, codebook
 * (theme/sub-theme/code) management, and source import (paste/txt/docx/csv).
 * Depends on assets/app.js (window.TB) and, on this page only, mammoth.js
 * (DOCX) and SheetJS/xlsx (CSV/XLSX bulk import of open-ended responses).
 */
(function () {
  "use strict";

  var project = null;
  var activeSourceId = null;
  var pendingSelection = null; // {start, end, quote}
  var editingCodingId = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) { return window.TB.escapeHtml(s); }

  function refreshProject() {
    project = window.TB.getActiveProject();
    return project;
  }

  function persist() {
    window.TB.saveProject(project);
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
    $("#tb-project-meta").textContent = (project.researcher ? project.researcher + " · " : "") +
      (project.org ? project.org + " · " : "") + project.sources.length + " source(s)";

    if (!activeSourceId && project.sources.length) activeSourceId = project.sources[0].id;
    if (activeSourceId && !project.sources.some(function (s) { return s.id === activeSourceId; })) {
      activeSourceId = project.sources.length ? project.sources[0].id : null;
    }

    renderSourceList();
    renderTranscript();
    renderCodebookPanel();
  }

  function renderSourceList() {
    var list = $("#tb-sources-list");
    if (!project.sources.length) {
      list.innerHTML = '<p class="text-muted small mb-0">No sources yet. Click "Add Source" to import a KII, FGD, interview, survey response or document.</p>';
      return;
    }
    list.innerHTML = project.sources.map(function (s) {
      var count = window.TB.codingsForSource(project, s.id).length;
      return '<div class="tb-source-item ' + (s.id === activeSourceId ? "active" : "") + '" data-source-id="' + s.id + '">' +
        '<div class="d-flex justify-content-between align-items-start">' +
        '<span>' + esc(s.name) + '</span>' +
        '<span class="badge bg-secondary tb-source-type-badge">' + esc(s.type) + '</span>' +
        '</div>' +
        '<div class="text-muted" style="font-size:.75rem;">' + count + ' coded reference(s)</div>' +
        '</div>';
    }).join("");
    $all(".tb-source-item", list).forEach(function (el) {
      el.addEventListener("click", function () {
        activeSourceId = el.getAttribute("data-source-id");
        renderAll();
      });
    });
  }

  function activeSource() {
    return project.sources.find(function (s) { return s.id === activeSourceId; }) || null;
  }

  function buildSegments(text, codings) {
    var pointsSet = {};
    pointsSet[0] = true; pointsSet[text.length] = true;
    codings.forEach(function (c) { pointsSet[c.start] = true; pointsSet[c.end] = true; });
    var points = Object.keys(pointsSet).map(Number).sort(function (a, b) { return a - b; });
    var segments = [];
    for (var i = 0; i < points.length - 1; i++) {
      var s = points[i], e = points[i + 1];
      if (s >= e) continue;
      var covering = codings.filter(function (c) { return c.start <= s && c.end >= e; });
      segments.push({ start: s, end: e, text: text.slice(s, e), codings: covering });
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
    var codings = window.TB.codingsForSource(project, src.id);
    if (!src.text) {
      body.innerHTML = '<p class="text-muted">This source has no text yet.</p>';
    } else {
      var segments = buildSegments(src.text, codings);
      body.innerHTML = segments.map(function (seg) {
        if (!seg.codings.length) return esc(seg.text);
        var themeNames = [];
        seg.codings.forEach(function (c) {
          (c.themeIds || []).forEach(function (tid) {
            var t = window.TB.themeById(project, tid);
            if (t && themeNames.indexOf(t.name) === -1) themeNames.push(t.name);
          });
        });
        var primaryTheme = window.TB.themeById(project, (seg.codings[0].themeIds || [])[0]);
        var color = primaryTheme ? primaryTheme.color : "#E08E45";
        var ids = seg.codings.map(function (c) { return c.id; }).join(",");
        var multiBadge = seg.codings.length > 1 ? " <sup>×" + seg.codings.length + "</sup>" : "";
        return '<mark class="tb-coded" data-coding-ids="' + ids + '" style="background-color:' + color + '33;box-shadow:inset 0 -2px 0 ' + color + ';" title="' +
          esc(themeNames.join(", ")) + '">' + esc(seg.text) + multiBadge + '</mark>';
      }).join("");
    }

    var a = src.attributes || {};
    var rows = [];
    if (a.respondentId) rows.push(["Respondent ID", a.respondentId]);
    if (a.sex) rows.push(["Sex", a.sex]);
    if (a.location) rows.push(["Location", a.location]);
    if (a.stakeholder) rows.push(["Stakeholder", a.stakeholder]);
    if (a.institution) rows.push(["Institution", a.institution]);
    attrsEl.innerHTML = '<div class="d-flex justify-content-between align-items-start">' +
      '<table class="table table-sm mb-0" style="font-size:.82rem;"><tbody>' +
      rows.map(function (r) { return "<tr><th class=\"text-muted\">" + esc(r[0]) + "</th><td>" + esc(r[1]) + "</td></tr>"; }).join("") +
      "</tbody></table>" +
      '<button class="btn btn-sm btn-outline-secondary ms-2" id="tb-edit-source-btn" title="Edit source"><i class="bi bi-pencil"></i></button>' +
      "</div>" +
      (src.memo ? '<p class="text-muted small mt-2 mb-0"><i class="bi bi-sticky"></i> ' + esc(src.memo) + "</p>" : "");

    var editBtn = $("#tb-edit-source-btn");
    if (editBtn) editBtn.addEventListener("click", function () { openSourceModal(src.id); });

    $all("mark.tb-coded", body).forEach(function (m) {
      m.addEventListener("click", function (e) {
        e.stopPropagation();
        var ids = m.getAttribute("data-coding-ids").split(",");
        openEditCodingModal(ids);
      });
    });
  }

  function renderCodebookPanel() {
    var tree = window.TB.themeTree(project);
    var stats = {};
    window.TB.allThemeStats(project).forEach(function (s) { stats[s.themeId] = s; });
    function renderNode(node, depth) {
      var s = stats[node.id] || { frequency: 0 };
      return '<div class="tb-theme-row" style="margin-left:' + (depth * 0.9) + 'rem;" data-theme-id="' + node.id + '">' +
        '<span class="tb-theme-swatch" style="background:' + node.color + ';"></span>' +
        '<span class="flex-grow-1">' + esc(node.name) + '</span>' +
        '<span class="badge bg-light text-dark border">' + s.frequency + '</span>' +
        '</div>' +
        node.children.map(function (c) { return renderNode(c, depth + 1); }).join("");
    }
    $("#tb-codebook-tree").innerHTML = tree.length
      ? tree.map(function (n) { return renderNode(n, 0); }).join("")
      : '<p class="text-muted small mb-0">No themes yet — open Codebook to add your first theme.</p>';
  }

  // ------------------------------------------------------- text selection
  function domOffsetToTextOffset(root, node, offset) {
    var total = 0, found = false;
    function walk(n) {
      if (found) return;
      if (n.nodeType === 3) {
        if (n === node) { total += offset; found = true; return; }
        total += n.textContent.length;
      } else {
        for (var i = 0; i < n.childNodes.length; i++) { walk(n.childNodes[i]); if (found) return; }
      }
    }
    walk(root);
    return total;
  }

  function setupSelectionHandling() {
    var body = $("#tb-transcript-text");
    var btn = $("#tb-code-selection-btn");
    document.addEventListener("mouseup", function (e) {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { btn.classList.add("d-none"); return; }
      var range = sel.getRangeAt(0);
      if (!body.contains(range.commonAncestorContainer)) { btn.classList.add("d-none"); return; }
      var src = activeSource();
      if (!src) { btn.classList.add("d-none"); return; }
      var start = domOffsetToTextOffset(body, range.startContainer, range.startOffset);
      var end = domOffsetToTextOffset(body, range.endContainer, range.endOffset);
      if (start > end) { var tmp = start; start = end; end = tmp; }
      if (end - start < 1) { btn.classList.add("d-none"); return; }
      pendingSelection = { start: start, end: end, quote: src.text.slice(start, end) };
      var rect = range.getBoundingClientRect();
      btn.style.top = (rect.top + window.scrollY - 40) + "px";
      btn.style.left = (rect.left + window.scrollX) + "px";
      btn.classList.remove("d-none");
    });
    btn.addEventListener("click", function () {
      btn.classList.add("d-none");
      if (pendingSelection) openApplyCodeModal(pendingSelection);
    });
  }

  // ------------------------------------------------------------- modals
  function themeCheckboxOptions(selectedIds) {
    selectedIds = selectedIds || [];
    var tree = window.TB.themeTree(project);
    function renderNode(node, depth) {
      var checked = selectedIds.indexOf(node.id) !== -1 ? "checked" : "";
      return '<div class="form-check" style="margin-left:' + (depth * 1.1) + 'rem;">' +
        '<input class="form-check-input tb-theme-check" type="checkbox" value="' + node.id + '" id="chk-' + node.id + '" ' + checked + '>' +
        '<label class="form-check-label" for="chk-' + node.id + '"><span class="tb-theme-swatch d-inline-block" style="background:' + node.color + ';width:.7rem;height:.7rem;border-radius:2px;"></span> ' + esc(node.name) + "</label>" +
        "</div>" +
        node.children.map(function (c) { return renderNode(c, depth + 1); }).join("");
    }
    return tree.length ? tree.map(function (n) { return renderNode(n, 0); }).join("") : '<p class="text-muted small">No themes yet. Add one from the Codebook button first.</p>';
  }

  function populateSpeakerSelect(select, source, currentSpeakerId) {
    var wrap = select.closest("[data-speaker-wrap]");
    if (!source || source.type !== "FGD" || !source.speakers || !source.speakers.length) {
      wrap.classList.add("d-none");
      select.innerHTML = "";
      return;
    }
    wrap.classList.remove("d-none");
    select.innerHTML = '<option value="">(whole discussion / unspecified)</option>' +
      source.speakers.map(function (sp) {
        return '<option value="' + sp.id + '" ' + (sp.id === currentSpeakerId ? "selected" : "") + ">" + esc(sp.label) + "</option>";
      }).join("");
  }

  function openApplyCodeModal(sel) {
    editingCodingId = null;
    $("#tb-apply-quote-preview").textContent = sel.quote;
    $("#tb-apply-theme-checks").innerHTML = themeCheckboxOptions([]);
    $("#tb-apply-weight-toggle").checked = project.weightingEnabled;
    $("#tb-apply-weight-slider").disabled = !project.weightingEnabled;
    $("#tb-apply-weight-slider").value = 5;
    $("#tb-apply-weight-value").textContent = "5";
    $("#tb-apply-memo").value = "";
    populateSpeakerSelect($("#tb-apply-speaker-select"), activeSource(), null);
    new bootstrap.Modal($("#tb-modal-apply-code")).show();
  }

  function openEditCodingModal(codingIds) {
    var codingId = codingIds[0];
    var coding = project.codings.find(function (c) { return c.id === codingId; });
    if (!coding) return;
    editingCodingId = coding.id;
    var src = project.sources.find(function (s) { return s.id === coding.sourceId; });
    var extra = codingIds.length > 1
      ? '<p class="small text-muted">' + (codingIds.length - 1) + ' other coded reference(s) also cover this exact text — save/delete only affects this one.</p>'
      : "";
    $("#tb-edit-quote-preview").innerHTML = esc(coding.quote) + extra;
    $("#tb-edit-theme-checks").innerHTML = themeCheckboxOptions(coding.themeIds);
    var hasWeight = coding.weight !== null && coding.weight !== undefined;
    $("#tb-edit-weight-toggle").checked = hasWeight;
    $("#tb-edit-weight-slider").disabled = !hasWeight;
    $("#tb-edit-weight-slider").value = hasWeight ? coding.weight : 5;
    $("#tb-edit-weight-value").textContent = hasWeight ? coding.weight : "5";
    $("#tb-edit-memo").value = coding.memo || "";
    populateSpeakerSelect($("#tb-edit-speaker-select"), src, coding.speakerId);
    new bootstrap.Modal($("#tb-modal-edit-coding")).show();
  }

  function selectedThemeIds(container) {
    return $all(".tb-theme-check:checked", container).map(function (c) { return c.value; });
  }

  function wireApplyCodeModal() {
    $("#tb-apply-weight-toggle").addEventListener("change", function (e) {
      $("#tb-apply-weight-slider").disabled = !e.target.checked;
    });
    $("#tb-apply-weight-slider").addEventListener("input", function (e) {
      $("#tb-apply-weight-value").textContent = e.target.value;
    });
    $("#tb-save-coding-btn").addEventListener("click", function () {
      var themeIds = selectedThemeIds($("#tb-apply-theme-checks"));
      if (!themeIds.length) { alert("Choose at least one theme/code for this selection."); return; }
      var weightOn = $("#tb-apply-weight-toggle").checked;
      var speakerSelect = $("#tb-apply-speaker-select");
      window.TB.addCoding(project, {
        sourceId: activeSourceId,
        speakerId: speakerSelect.value || null,
        themeIds: themeIds,
        start: pendingSelection.start,
        end: pendingSelection.end,
        quote: pendingSelection.quote,
        weight: weightOn ? $("#tb-apply-weight-slider").value : null,
        memo: $("#tb-apply-memo").value
      });
      bootstrap.Modal.getInstance($("#tb-modal-apply-code")).hide();
      renderAll();
    });
  }

  function wireEditCodingModal() {
    $("#tb-edit-weight-toggle").addEventListener("change", function (e) {
      $("#tb-edit-weight-slider").disabled = !e.target.checked;
    });
    $("#tb-edit-weight-slider").addEventListener("input", function (e) {
      $("#tb-edit-weight-value").textContent = e.target.value;
    });
    $("#tb-update-coding-btn").addEventListener("click", function () {
      var themeIds = selectedThemeIds($("#tb-edit-theme-checks"));
      if (!themeIds.length) { alert("Choose at least one theme/code for this selection."); return; }
      var weightOn = $("#tb-edit-weight-toggle").checked;
      window.TB.updateCoding(project, editingCodingId, {
        themeIds: themeIds,
        speakerId: $("#tb-edit-speaker-select").value || null,
        weight: weightOn ? Number($("#tb-edit-weight-slider").value) : null,
        memo: $("#tb-edit-memo").value
      });
      bootstrap.Modal.getInstance($("#tb-modal-edit-coding")).hide();
      renderAll();
    });
    $("#tb-delete-coding-btn").addEventListener("click", function () {
      if (!confirm("Remove this coded reference? This cannot be undone.")) return;
      window.TB.deleteCoding(project, editingCodingId);
      bootstrap.Modal.getInstance($("#tb-modal-edit-coding")).hide();
      renderAll();
    });
  }

  // ------------------------------------------------------------ codebook
  function openCodebookModal() {
    renderCodebookEditor();
    new bootstrap.Modal($("#tb-modal-codebook")).show();
  }

  function renderCodebookEditor() {
    var tree = window.TB.themeTree(project);
    function renderNode(node, depth) {
      return '<div class="d-flex align-items-center gap-2 mb-1" style="margin-left:' + (depth * 1.1) + 'rem;">' +
        '<span class="tb-theme-swatch" style="background:' + node.color + ';width:.8rem;height:.8rem;border-radius:2px;"></span>' +
        '<span class="flex-grow-1">' + esc(node.name) + (node.memo ? ' <i class="bi bi-sticky text-muted" title="' + esc(node.memo) + '"></i>' : "") + '</span>' +
        '<button class="btn btn-sm btn-link p-0 tb-theme-edit-memo" data-theme-id="' + node.id + '" title="Edit memo"><i class="bi bi-chat-square-text"></i></button>' +
        '<button class="btn btn-sm btn-link p-0 text-danger tb-theme-delete" data-theme-id="' + node.id + '" title="Delete"><i class="bi bi-trash"></i></button>' +
        "</div>" +
        node.children.map(function (c) { return renderNode(c, depth + 1); }).join("");
    }
    $("#tb-theme-tree-editor").innerHTML = tree.length ? tree.map(function (n) { return renderNode(n, 0); }).join("") : '<p class="text-muted small">No themes yet.</p>';
    var parentSelect = $("#tbf-theme-parent");
    parentSelect.innerHTML = '<option value="">(top-level theme)</option>' +
      project.themes.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + "</option>"; }).join("");

    $all(".tb-theme-delete", $("#tb-theme-tree-editor")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (!confirm("Delete this theme (and its sub-themes)? Coded references keep any other themes they also have.")) return;
        window.TB.deleteTheme(project, btn.getAttribute("data-theme-id"));
        renderCodebookEditor();
        renderAll();
      });
    });
    $all(".tb-theme-edit-memo", $("#tb-theme-tree-editor")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var t = window.TB.themeById(project, btn.getAttribute("data-theme-id"));
        var memo = prompt("Theme memo for \"" + t.name + "\":", t.memo || "");
        if (memo === null) return;
        window.TB.updateTheme(project, t.id, { memo: memo });
        renderCodebookEditor();
      });
    });
  }

  function wireCodebookModal() {
    $("#tb-add-theme-btn").addEventListener("click", function () {
      var name = $("#tbf-theme-name").value.trim();
      if (!name) { alert("Enter a theme name."); return; }
      window.TB.addTheme(project, {
        name: name,
        parentId: $("#tbf-theme-parent").value || null,
        color: $("#tbf-theme-color").value
      });
      $("#tbf-theme-name").value = "";
      $("#tbf-theme-color").value = window.TB.nextColor();
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
    toggleSpeakerField();
    toggleImportFields();
    if (sourceId) {
      var s = project.sources.find(function (s) { return s.id === sourceId; });
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
      $('input[name="srcImportMode"][value="paste"]').checked = true;
      toggleSpeakerField();
      toggleImportFields();
    }
    new bootstrap.Modal($("#tb-modal-add-source")).show();
  }

  function toggleSpeakerField() {
    var isFgd = $("#tbf-source-type").value === "FGD";
    $("#tbf-speakers-wrap").classList.toggle("d-none", !isFgd);
  }
  function toggleImportFields() {
    var mode = $('input[name="srcImportMode"]:checked').value;
    $("#tbf-text-wrap").classList.toggle("d-none", mode !== "paste");
    $("#tbf-file-wrap").classList.toggle("d-none", mode === "paste");
    var fileInput = $("#tbf-source-file");
    fileInput.accept = mode === "docx" ? ".docx" : mode === "csv" ? ".csv,.xlsx,.xls" : ".txt";
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
      var mode = $('input[name="srcImportMode"]:checked').value;
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
          window.TB.updateSource(project, existingId, { type: type, name: name, text: text, attributes: attributes, speakers: speakers, memo: memo });
          activeSourceId = existingId;
        } else {
          var src = window.TB.addSource(project, { type: type, name: name, text: text, attributes: attributes, speakers: speakers, memo: memo });
          activeSourceId = src.id;
        }
        bootstrap.Modal.getInstance($("#tb-modal-add-source")).hide();
        renderAll();
      }

      if (mode === "paste") {
        finish($("#tbf-source-text").value);
        return;
      }
      var file = $("#tbf-source-file").files[0];
      if (!file) { alert("Choose a file to upload, or switch to Paste Text."); return; }

      if (mode === "txt") {
        readFileAsText(file).then(finish);
      } else if (mode === "docx") {
        if (!window.mammoth) { alert("The DOCX reader library did not load — check your internet connection and try again."); return; }
        readFileAsArrayBuffer(file).then(function (buf) {
          return window.mammoth.extractRawText({ arrayBuffer: buf });
        }).then(function (result) { finish(result.value); });
      } else if (mode === "csv") {
        if (!window.XLSX) { alert("The spreadsheet reader library did not load — check your internet connection and try again."); return; }
        readFileAsArrayBuffer(file).then(function (buf) {
          var wb = window.XLSX.read(buf, { type: "array" });
          var sheet = wb.Sheets[wb.SheetNames[0]];
          var rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1 });
          var text = rows.map(function (row) { return row.join(" — "); }).join("\n\n");
          finish(text);
        });
      }
    });
  }

  // ---------------------------------------------------------------- init
  function init() {
    refreshProject();
    if (!project) { renderAll(); return; }
    renderAll();
    setupSelectionHandling();
    wireApplyCodeModal();
    wireEditCodingModal();
    wireCodebookModal();
    wireSourceModal();

    $("#tb-add-source-btn").addEventListener("click", function () { openSourceModal(null); });
    $("#tb-manage-themes-btn").addEventListener("click", openCodebookModal);
    $("#tbf-theme-color").value = window.TB.nextColor();
  }

  window.TB = window.TB || {};
  window.TB.workspace = { init: init };
})();

/*
 * Export helpers — everything genuinely runs client-side: CSV/XLSX via
 * SheetJS, a Word-compatible report via an HTML Blob served with a .doc
 * extension (Word opens HTML natively; documented in README as not a
 * native OOXML binary), chart/heatmap/word-cloud PNGs via canvas, and a
 * full project JSON backup/restore.
 */
(function () {
  "use strict";

  function downloadBlob(filename, content, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }

  function csvEscape(v) {
    v = v === null || v === undefined ? "" : String(v);
    if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }
  function toCSV(headers, rows) {
    var lines = [headers.map(csvEscape).join(",")];
    rows.forEach(function (r) { lines.push(r.map(csvEscape).join(",")); });
    return lines.join("\r\n");
  }

  function themeStatsRows(project) {
    var stats = window.TB.allThemeStats(project);
    return stats.map(function (s) {
      return [s.theme.name, s.frequency, s.coverageCount, s.coverageTotal, s.coveragePct + "%",
        s.totalWeight, s.avgWeight === null ? "" : s.avgWeight];
    });
  }
  var THEME_STATS_HEADERS = ["Theme", "Frequency", "Respondents Covered", "Total Respondents", "Coverage %", "Total Weighted Score", "Average Weight"];

  function codedReferenceRows(project) {
    var respondents = window.TB.respondentsOf(project);
    var respMap = {}; respondents.forEach(function (r) { respMap[r.id] = r; });
    return project.codings.map(function (c) {
      var src = project.sources.find(function (s) { return s.id === c.sourceId; });
      var r = respMap[window.TB.respondentIdForCoding(c)];
      var themeNames = (c.themeIds || []).map(function (id) {
        var t = window.TB.themeById(project, id); return t ? t.name : "";
      }).filter(Boolean).join(" | ");
      return [src ? src.name : "", r ? r.label : "", themeNames, c.weight === null ? "" : c.weight, c.memo || "", c.quote];
    });
  }
  var CODED_REFERENCE_HEADERS = ["Source", "Respondent", "Theme(s)", "Weight", "Memo", "Quote"];

  function matrixRows(project, metric) {
    var m = window.TB.matrixData(project, null);
    var headers = ["Respondent"].concat(m.themes.map(function (t) { return t.name; }));
    var rows = m.respondents.map(function (r) {
      return [r.label].concat(m.themes.map(function (t) {
        var cell = m.cells[r.id][t.id];
        if (metric === "avgWeight") return cell.weightedCount ? Math.round((cell.totalWeight / cell.weightedCount) * 100) / 100 : "";
        if (metric === "totalWeight") return cell.totalWeight;
        return cell.frequency;
      }));
    });
    return { headers: headers, rows: rows };
  }

  function wordFrequencyRows(wordFreqArray) {
    return wordFreqArray.map(function (w) { return [w.word, w.count]; });
  }

  // ------------------------------------------------------------ CSV exports
  function exportCodedReferencesCSV(project) {
    downloadBlob(slug(project.title) + "-coded-references.csv",
      toCSV(CODED_REFERENCE_HEADERS, codedReferenceRows(project)), "text/csv");
  }
  function exportFrequencyTableCSV(project) {
    downloadBlob(slug(project.title) + "-theme-frequency.csv",
      toCSV(THEME_STATS_HEADERS, themeStatsRows(project)), "text/csv");
  }
  function exportMatrixCSV(project, metric) {
    var m = matrixRows(project, metric);
    downloadBlob(slug(project.title) + "-matrix-" + metric + ".csv", toCSV(m.headers, m.rows), "text/csv");
  }
  function exportWordFrequencyCSV(wordFreqArray, filenamePrefix) {
    downloadBlob((filenamePrefix || "word-frequency") + ".csv",
      toCSV(["Word", "Count"], wordFrequencyRows(wordFreqArray)), "text/csv");
  }

  // ------------------------------------------------------------ XLSX export
  function exportWorkbook(project) {
    if (!window.XLSX) { alert("The spreadsheet library did not load — check your internet connection and try again."); return; }
    var wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet([THEME_STATS_HEADERS].concat(themeStatsRows(project))), "Theme Frequency");
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet([CODED_REFERENCE_HEADERS].concat(codedReferenceRows(project))), "Coded References");
    ["frequency", "totalWeight", "avgWeight"].forEach(function (metric) {
      var m = matrixRows(project, metric);
      var sheetName = "Matrix " + (metric === "frequency" ? "Freq" : metric === "totalWeight" ? "TotalWt" : "AvgWt");
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet([m.headers].concat(m.rows)), sheetName);
    });
    window.XLSX.writeFile(wb, slug(project.title) + "-analysis.xlsx");
  }

  // -------------------------------------------------------- Word-compatible
  function exportThemeReportWord(project) {
    var stats = window.TB.allThemeStats(project).sort(function (a, b) { return b.frequency - a.frequency; });
    var html = "<html><head><meta charset='utf-8'><title>" + esc(project.title) + " — Coding Report</title></head><body style=\"font-family:Calibri,Arial,sans-serif;\">" +
      "<h1>" + esc(project.title) + "</h1>" +
      "<p><em>" + esc(project.description || "") + "</em></p>" +
      "<p>Researcher: " + esc(project.researcher || "—") + " &nbsp;|&nbsp; Organization: " + esc(project.org || "—") + " &nbsp;|&nbsp; Date: " + esc(project.date || "—") + "</p>" +
      "<h2>Theme Summary</h2>" +
      stats.map(function (s) {
        var evidence = window.TB.evidenceForTheme(project, s.themeId).slice(0, 3);
        return "<h3 style=\"color:#1B4F9C;\">" + esc(s.theme.name) + "</h3>" +
          "<p><b>Frequency:</b> " + s.frequency + " &nbsp; <b>Respondent Coverage:</b> " + s.coverageCount + "/" + s.coverageTotal + " (" + s.coveragePct + "%) &nbsp; " +
          "<b>Total Weighted Score:</b> " + s.totalWeight + " &nbsp; <b>Average Weight:</b> " + (s.avgWeight === null ? "—" : s.avgWeight) + "</p>" +
          (s.theme.memo ? "<p><i>Memo: " + esc(s.theme.memo) + "</i></p>" : "") +
          (evidence.length ? "<p><b>Supporting evidence:</b></p><ul>" + evidence.map(function (e) {
            return "<li>&ldquo;" + esc(e.quote) + "&rdquo; — " + esc(e.sourceName) + (e.respondentLabel ? " (" + esc(e.respondentLabel) + ")" : "") + (e.weight !== null ? ", weight " + e.weight + "/10" : "") + "</li>";
          }).join("") + "</ul>" : "<p><i>No coded references yet.</i></p>");
      }).join("") +
      "<hr><p style=\"font-size:11px;color:#666;\">Generated by TakwimuBridge — client-side qualitative analysis tool. This file is HTML formatted for Word compatibility, not a native .docx binary.</p>" +
      "</body></html>";
    downloadBlob(slug(project.title) + "-coding-report.doc", html, "application/msword");
  }

  // -------------------------------------------------------------- JSON
  function exportProjectJSON(project) {
    downloadBlob(slug(project.title) + "-project-backup.json", JSON.stringify(project, null, 2), "application/json");
  }
  function importProjectJSON(file, onDone) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var project = JSON.parse(reader.result);
        if (!project.id || !project.sources || !project.themes || !project.codings) throw new Error("Not a recognizable TakwimuBridge project file.");
        project.id = window.TB.uid("proj");
        window.TB.saveProject(project);
        onDone(null, project);
      } catch (e) { onDone(e); }
    };
    reader.readAsText(file);
  }

  // -------------------------------------------------------------- images
  function canvasToPNG(canvasId, filename) {
    var el = document.getElementById(canvasId);
    if (!el) return;
    var a = document.createElement("a");
    a.href = el.toDataURL("image/png");
    a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function esc(s) { return window.TB.escapeHtml(s); }
  function slug(s) {
    return String(s || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project";
  }

  window.TB = window.TB || {};
  window.TB.exportUtil = {
    downloadBlob: downloadBlob, toCSV: toCSV,
    exportCodedReferencesCSV: exportCodedReferencesCSV, exportFrequencyTableCSV: exportFrequencyTableCSV,
    exportMatrixCSV: exportMatrixCSV, exportWordFrequencyCSV: exportWordFrequencyCSV,
    exportWorkbook: exportWorkbook, exportThemeReportWord: exportThemeReportWord,
    exportProjectJSON: exportProjectJSON, importProjectJSON: importProjectJSON,
    canvasToPNG: canvasToPNG, slug: slug
  };
})();

/*
 * TakwimuBridge core module — storage, data model (CRUD), and analysis
 * computations. Everything runs client-side against localStorage; there is
 * no server. Attaches a single global `TB` namespace used by every page.
 */
(function () {
  "use strict";

  var LS_PREFIX = "tb_project_";
  var LS_INDEX = "tb_project_index";
  var LS_ACTIVE = "tb_active_project";

  function uid(prefix) {
    return (prefix || "id") + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  var PALETTE = ["#4B2E83", "#17B8A6", "#E08E45", "#C0392B", "#2F6FED", "#1E8A5F",
    "#8E44AD", "#D35400", "#16A085", "#B3261E", "#2C3E50", "#7D3C98"];
  var paletteCursor = 0;
  function nextColor() {
    var c = PALETTE[paletteCursor % PALETTE.length];
    paletteCursor++;
    return c;
  }

  // ---------------------------------------------------------------- storage
  function listProjects() {
    try { return JSON.parse(localStorage.getItem(LS_INDEX) || "[]"); }
    catch (e) { return []; }
  }

  function saveIndexEntry(project) {
    var idx = listProjects().filter(function (p) { return p.id !== project.id; });
    idx.push({ id: project.id, title: project.title, researcher: project.researcher, updatedAt: Date.now() });
    idx.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    localStorage.setItem(LS_INDEX, JSON.stringify(idx));
  }

  function loadProject(id) {
    try { return JSON.parse(localStorage.getItem(LS_PREFIX + id)); }
    catch (e) { return null; }
  }

  function saveProject(project) {
    localStorage.setItem(LS_PREFIX + project.id, JSON.stringify(project));
    saveIndexEntry(project);
    return project;
  }

  function deleteProject(id) {
    localStorage.removeItem(LS_PREFIX + id);
    var idx = listProjects().filter(function (p) { return p.id !== id; });
    localStorage.setItem(LS_INDEX, JSON.stringify(idx));
    if (getActiveProjectId() === id) setActiveProjectId(null);
  }

  function getActiveProjectId() { return localStorage.getItem(LS_ACTIVE) || null; }
  function setActiveProjectId(id) {
    if (id) localStorage.setItem(LS_ACTIVE, id);
    else localStorage.removeItem(LS_ACTIVE);
  }
  function getActiveProject() {
    var id = getActiveProjectId();
    return id ? loadProject(id) : null;
  }

  function createProject(fields) {
    fields = fields || {};
    var project = {
      id: uid("proj"),
      title: fields.title || "Untitled Project",
      description: fields.description || "",
      topic: fields.topic || "",
      researcher: fields.researcher || "",
      org: fields.org || "",
      date: fields.date || new Date().toISOString().slice(0, 10),
      weightingEnabled: fields.weightingEnabled !== false,
      memo: fields.memo || "",
      createdAt: Date.now(),
      sources: [],
      themes: [],
      codings: []
    };
    saveProject(project);
    return project;
  }

  // ---------------------------------------------------------------- sources
  function addSource(project, fields) {
    fields = fields || {};
    var source = {
      id: uid("src"),
      type: fields.type || "Document",
      name: fields.name || "Untitled Source",
      text: fields.text || "",
      attributes: fields.attributes || {},
      speakers: fields.speakers || [],
      memo: fields.memo || "",
      createdAt: Date.now()
    };
    project.sources.push(source);
    saveProject(project);
    return source;
  }
  function updateSource(project, sourceId, patch) {
    var s = project.sources.find(function (s) { return s.id === sourceId; });
    if (!s) return null;
    Object.assign(s, patch);
    saveProject(project);
    return s;
  }
  function deleteSource(project, sourceId) {
    project.sources = project.sources.filter(function (s) { return s.id !== sourceId; });
    project.codings = project.codings.filter(function (c) { return c.sourceId !== sourceId; });
    saveProject(project);
  }

  // ----------------------------------------------------------------- themes
  function addTheme(project, fields) {
    fields = fields || {};
    var theme = {
      id: uid("thm"),
      name: fields.name || "Untitled Theme",
      parentId: fields.parentId || null,
      color: fields.color || nextColor(),
      memo: fields.memo || ""
    };
    project.themes.push(theme);
    saveProject(project);
    return theme;
  }
  function updateTheme(project, themeId, patch) {
    var t = project.themes.find(function (t) { return t.id === themeId; });
    if (!t) return null;
    Object.assign(t, patch);
    saveProject(project);
    return t;
  }
  function deleteTheme(project, themeId) {
    var toDelete = {};
    toDelete[themeId] = true;
    descendantThemeIds(project, themeId).forEach(function (id) { toDelete[id] = true; });
    project.themes = project.themes.filter(function (t) { return !toDelete[t.id]; });
    project.codings.forEach(function (c) {
      c.themeIds = c.themeIds.filter(function (id) { return !toDelete[id]; });
    });
    project.codings = project.codings.filter(function (c) { return c.themeIds.length > 0; });
    saveProject(project);
  }
  function themeById(project, id) { return project.themes.find(function (t) { return t.id === id; }); }
  function childThemes(project, parentId) {
    return project.themes.filter(function (t) { return (t.parentId || null) === (parentId || null); });
  }
  function themeTree(project) {
    function build(parentId) {
      return childThemes(project, parentId).map(function (t) {
        var node = Object.assign({}, t);
        node.children = build(t.id);
        return node;
      });
    }
    return build(null);
  }
  function ancestorsAndSelf(project, themeId) {
    var result = [];
    var cur = themeById(project, themeId);
    var guard = 0;
    while (cur && guard++ < 50) {
      result.push(cur.id);
      cur = cur.parentId ? themeById(project, cur.parentId) : null;
    }
    return result;
  }
  function descendantThemeIds(project, themeId) {
    var result = [];
    function walk(id) {
      childThemes(project, id).forEach(function (c) { result.push(c.id); walk(c.id); });
    }
    walk(themeId);
    return result;
  }
  function themeDepth(project, themeId) {
    return ancestorsAndSelf(project, themeId).length - 1;
  }

  // ---------------------------------------------------------------- codings
  function addCoding(project, fields) {
    fields = fields || {};
    var coding = {
      id: uid("cod"),
      sourceId: fields.sourceId,
      speakerId: fields.speakerId || null,
      themeIds: fields.themeIds || [],
      start: fields.start,
      end: fields.end,
      quote: fields.quote || "",
      weight: (fields.weight === undefined || fields.weight === "" || fields.weight === null) ? null : Number(fields.weight),
      memo: fields.memo || "",
      createdAt: Date.now()
    };
    project.codings.push(coding);
    saveProject(project);
    return coding;
  }
  function updateCoding(project, codingId, patch) {
    var c = project.codings.find(function (c) { return c.id === codingId; });
    if (!c) return null;
    Object.assign(c, patch);
    saveProject(project);
    return c;
  }
  function deleteCoding(project, codingId) {
    project.codings = project.codings.filter(function (c) { return c.id !== codingId; });
    saveProject(project);
  }
  function codingsForSource(project, sourceId) {
    return project.codings.filter(function (c) { return c.sourceId === sourceId; });
  }
  function codingEffectiveThemeIds(project, coding) {
    var set = {};
    (coding.themeIds || []).forEach(function (id) {
      ancestorsAndSelf(project, id).forEach(function (a) { set[a] = true; });
    });
    return set;
  }

  // ------------------------------------------------------------ respondents
  function respondentsOf(project) {
    var list = [];
    project.sources.forEach(function (s) {
      if (s.type === "FGD" && s.speakers && s.speakers.length) {
        s.speakers.forEach(function (sp) {
          list.push({
            id: s.id + ":" + sp.id, sourceId: s.id, speakerId: sp.id,
            label: sp.label, sourceName: s.name, attributes: s.attributes || {}
          });
        });
      } else {
        list.push({
          id: s.id, sourceId: s.id, speakerId: null,
          label: (s.attributes && s.attributes.respondentId) || s.name,
          sourceName: s.name, attributes: s.attributes || {}
        });
      }
    });
    return list;
  }
  function respondentIdForCoding(coding) {
    return coding.speakerId ? (coding.sourceId + ":" + coding.speakerId) : coding.sourceId;
  }

  // -------------------------------------------------------------- analysis
  function themeStats(project, themeId) {
    var descendants = {};
    descendants[themeId] = true;
    descendantThemeIds(project, themeId).forEach(function (id) { descendants[id] = true; });
    var totalRespondents = respondentsOf(project).length;
    var covered = {};
    var frequency = 0, totalWeight = 0, weightedCount = 0;
    project.codings.forEach(function (c) {
      var eff = codingEffectiveThemeIds(project, c);
      var matches = false;
      for (var id in descendants) { if (eff[id]) { matches = true; break; } }
      if (!matches) return;
      frequency++;
      covered[respondentIdForCoding(c)] = true;
      if (c.weight !== null && c.weight !== undefined) { totalWeight += c.weight; weightedCount++; }
    });
    var coverageCount = Object.keys(covered).length;
    return {
      themeId: themeId,
      frequency: frequency,
      coverageCount: coverageCount,
      coverageTotal: totalRespondents,
      coveragePct: totalRespondents ? Math.round((coverageCount / totalRespondents) * 1000) / 10 : 0,
      totalWeight: totalWeight,
      weightedCount: weightedCount,
      avgWeight: weightedCount ? Math.round((totalWeight / weightedCount) * 100) / 100 : null
    };
  }

  function allThemeStats(project) {
    return project.themes.map(function (t) {
      var stats = themeStats(project, t.id);
      stats.theme = t;
      return stats;
    });
  }

  function matrixData(project, themeIds) {
    var themes = themeIds ? project.themes.filter(function (t) { return themeIds.indexOf(t.id) !== -1; }) : project.themes;
    var respondents = respondentsOf(project);
    var cells = {};
    respondents.forEach(function (r) {
      cells[r.id] = {};
      themes.forEach(function (t) { cells[r.id][t.id] = { frequency: 0, totalWeight: 0, weightedCount: 0 }; });
    });
    project.codings.forEach(function (c) {
      var rid = respondentIdForCoding(c);
      if (!cells[rid]) return;
      var eff = codingEffectiveThemeIds(project, c);
      themes.forEach(function (t) {
        if (eff[t.id]) {
          cells[rid][t.id].frequency++;
          if (c.weight != null) { cells[rid][t.id].totalWeight += c.weight; cells[rid][t.id].weightedCount++; }
        }
      });
    });
    return { respondents: respondents, themes: themes, cells: cells };
  }

  function evidenceForTheme(project, themeId) {
    var descendants = {};
    descendants[themeId] = true;
    descendantThemeIds(project, themeId).forEach(function (id) { descendants[id] = true; });
    var respMap = {};
    respondentsOf(project).forEach(function (r) { respMap[r.id] = r; });
    return project.codings.filter(function (c) {
      var eff = codingEffectiveThemeIds(project, c);
      for (var id in descendants) { if (eff[id]) return true; }
      return false;
    }).map(function (c) {
      var src = project.sources.find(function (s) { return s.id === c.sourceId; });
      var r = respMap[respondentIdForCoding(c)];
      return {
        coding: c,
        sourceName: src ? src.name : "",
        respondentLabel: r ? r.label : "",
        weight: c.weight, memo: c.memo, quote: c.quote
      };
    }).sort(function (a, b) { return a.coding.createdAt - b.coding.createdAt; });
  }

  function groupComparison(project, attributeKey, themeId) {
    var descendants = {};
    descendants[themeId] = true;
    descendantThemeIds(project, themeId).forEach(function (id) { descendants[id] = true; });
    var respondents = respondentsOf(project);
    var groups = {};
    function ensure(v) {
      if (!groups[v]) groups[v] = { value: v, totalRespondents: 0, covered: {}, frequency: 0 };
      return groups[v];
    }
    respondents.forEach(function (r) {
      var v = (r.attributes && r.attributes[attributeKey]) || "Unspecified";
      ensure(v).totalRespondents++;
    });
    project.codings.forEach(function (c) {
      var eff = codingEffectiveThemeIds(project, c);
      var matches = false;
      for (var id in descendants) { if (eff[id]) { matches = true; break; } }
      if (!matches) return;
      var rid = respondentIdForCoding(c);
      var r = respondents.find(function (r) { return r.id === rid; });
      if (!r) return;
      var v = (r.attributes && r.attributes[attributeKey]) || "Unspecified";
      var g = ensure(v);
      g.frequency++;
      g.covered[rid] = true;
    });
    return Object.keys(groups).map(function (k) {
      var g = groups[k];
      var coverageCount = Object.keys(g.covered).length;
      return {
        value: g.value,
        totalRespondents: g.totalRespondents,
        coverageCount: coverageCount,
        coveragePct: g.totalRespondents ? Math.round((coverageCount / g.totalRespondents) * 1000) / 10 : 0,
        frequency: g.frequency
      };
    });
  }

  var DEFAULT_STOPWORDS = ["the", "is", "are", "was", "were", "a", "an", "and", "or", "of", "to", "in", "on",
    "for", "with", "that", "this", "it", "as", "at", "by", "be", "has", "have", "had", "not", "no", "we", "our",
    "they", "their", "you", "your", "i", "he", "she", "his", "her", "them", "but", "so", "if", "because", "than",
    "then", "there", "here", "which", "who", "what", "when", "where", "how", "do", "does", "did", "can", "could",
    "will", "would", "should", "from", "into", "about", "more", "most", "some", "such", "also", "just", "over",
    "near", "been", "being", "these", "those", "its", "us", "all", "any", "one", "two", "very", "much", "now",
    "still", "each", "other", "same", "own", "only", "even", "many"];

  function wordFrequency(project, opts) {
    opts = opts || {};
    var scope = opts.scope || "all";
    var themeIds = opts.themeIds || null;
    var extraStop = opts.extraStopwords || [];
    var stopSet = {};
    DEFAULT_STOPWORDS.concat(extraStop.map(function (w) { return String(w).toLowerCase(); }))
      .forEach(function (w) { stopSet[w] = true; });

    var texts = [];
    if (scope === "coded") {
      var descendants = null;
      if (themeIds && themeIds.length) {
        descendants = {};
        themeIds.forEach(function (id) {
          descendants[id] = true;
          descendantThemeIds(project, id).forEach(function (d) { descendants[d] = true; });
        });
      }
      project.codings.forEach(function (c) {
        if (descendants) {
          var eff = codingEffectiveThemeIds(project, c);
          var matches = false;
          for (var id in descendants) { if (eff[id]) { matches = true; break; } }
          if (!matches) return;
        }
        texts.push(c.quote);
      });
    } else if (opts.sourceIds && opts.sourceIds.length) {
      project.sources.filter(function (s) { return opts.sourceIds.indexOf(s.id) !== -1; })
        .forEach(function (s) { texts.push(s.text); });
    } else {
      project.sources.forEach(function (s) { texts.push(s.text); });
    }

    var counts = {};
    var joined = texts.join(" ").toLowerCase();
    var words = joined.split(/[^a-zÀ-ɏ']+/i);
    words.forEach(function (w) {
      w = w.replace(/^'+|'+$/g, "");
      if (w.length < 3) return;
      if (stopSet[w]) return;
      counts[w] = (counts[w] || 0) + 1;
    });
    return Object.keys(counts).map(function (w) { return { word: w, count: counts[w] }; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  function searchTerm(project, term) {
    if (!term) return [];
    var re = new RegExp(escapeRegExp(term), "ig");
    var results = [];
    project.sources.forEach(function (s) {
      var m;
      while ((m = re.exec(s.text))) {
        var start = Math.max(0, m.index - 40);
        var end = Math.min(s.text.length, m.index + term.length + 40);
        results.push({ sourceId: s.id, sourceName: s.name, index: m.index, context: s.text.slice(start, end) });
        if (re.lastIndex === m.index) re.lastIndex++;
      }
    });
    return results;
  }

  window.TB = {
    uid: uid, escapeHtml: escapeHtml, nextColor: nextColor,
    listProjects: listProjects, loadProject: loadProject, saveProject: saveProject, deleteProject: deleteProject,
    getActiveProjectId: getActiveProjectId, setActiveProjectId: setActiveProjectId, getActiveProject: getActiveProject,
    createProject: createProject,
    addSource: addSource, updateSource: updateSource, deleteSource: deleteSource,
    addTheme: addTheme, updateTheme: updateTheme, deleteTheme: deleteTheme, themeById: themeById,
    childThemes: childThemes, themeTree: themeTree, ancestorsAndSelf: ancestorsAndSelf,
    descendantThemeIds: descendantThemeIds, themeDepth: themeDepth,
    addCoding: addCoding, updateCoding: updateCoding, deleteCoding: deleteCoding,
    codingsForSource: codingsForSource, codingEffectiveThemeIds: codingEffectiveThemeIds,
    respondentsOf: respondentsOf, respondentIdForCoding: respondentIdForCoding,
    themeStats: themeStats, allThemeStats: allThemeStats, matrixData: matrixData,
    evidenceForTheme: evidenceForTheme, groupComparison: groupComparison,
    wordFrequency: wordFrequency, searchTerm: searchTerm,
    DEFAULT_STOPWORDS: DEFAULT_STOPWORDS
  };
})();

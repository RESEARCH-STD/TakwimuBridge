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

  // Theme colours end up inside style attributes; imported backups are
  // untrusted, so only plain hex colours are ever rendered.
  function safeColor(c) {
    return /^#[0-9a-f]{3,8}$/i.test(String(c || "")) ? c : "#1B4F9C";
  }

  var PALETTE = ["#1B4F9C", "#17B8A6", "#E08E45", "#C0392B", "#2F6FED", "#1E8A5F",
    "#8E44AD", "#D35400", "#16A085", "#B3261E", "#2C3E50", "#7D3C98"];
  var paletteCursor = 0;
  function nextColor() {
    var c = PALETTE[paletteCursor % PALETTE.length];
    paletteCursor++;
    return c;
  }
  function suggestColor(project) {
    var used = {};
    (project ? project.themes : []).forEach(function (t) { used[String(t.color).toLowerCase()] = true; });
    return PALETTE.find(function (c) { return !used[c.toLowerCase()]; }) || nextColor();
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
      color: fields.color || suggestColor(project),
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
  function topLevelThemeId(project, themeId) {
    var chain = ancestorsAndSelf(project, themeId);
    return chain.length ? chain[chain.length - 1] : null;
  }
  function themePath(project, themeId, sep) {
    return ancestorsAndSelf(project, themeId).reverse().map(function (id) {
      var t = themeById(project, id); return t ? t.name : "";
    }).join(sep || " › ");
  }
  function maxThemeDepth(project) {
    var max = -1;
    project.themes.forEach(function (t) { max = Math.max(max, themeDepth(project, t.id)); });
    return max;
  }
  function themesInTreeOrder(project) {
    var out = [];
    (function walk(nodes) {
      nodes.forEach(function (n) { out.push(themeById(project, n.id)); walk(n.children); });
    })(themeTree(project));
    return out;
  }
  // A "cut" through the codebook at one depth (0 = themes, 1 = sub-themes,
  // 2 = codes): every node at that depth plus any leaf that stops short of
  // it, so no coded reference falls out of the analysis. Tree order.
  function themesAtLevel(project, level, withinThemeId) {
    var result = [];
    function walk(node, depth) {
      if (depth >= level || !node.children.length) { result.push(themeById(project, node.id)); return; }
      node.children.forEach(function (c) { walk(c, depth + 1); });
    }
    var tree = themeTree(project);
    if (withinThemeId) {
      var found = null;
      (function find(nodes) {
        nodes.forEach(function (n) { if (n.id === withinThemeId) found = n; else if (!found) find(n.children); });
      })(tree);
      if (found) walk(found, themeDepth(project, found.id));
    } else {
      tree.forEach(function (n) { walk(n, 0); });
    }
    return result;
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
  function recentCodings(project, limit) {
    return project.codings.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, limit || 5);
  }

  // Characters inside at least one coded reference (overlaps merged), as a
  // coding-progress indicator — not an analytical measure.
  function codedCharacterCount(project, sourceId) {
    var ranges = codingsForSource(project, sourceId).map(function (c) { return [c.start, c.end]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    var total = 0, curStart = 0, curEnd = 0;
    ranges.forEach(function (r) {
      if (r[0] > curEnd) { total += curEnd - curStart; curStart = r[0]; curEnd = r[1]; }
      else curEnd = Math.max(curEnd, r[1]);
    });
    return total + (curEnd - curStart);
  }
  function sourceCodedPct(project, source) {
    var len = (source.text || "").length;
    return len ? Math.min(100, Math.round((codedCharacterCount(project, source.id) / len) * 1000) / 10) : 0;
  }
  function projectCodedPct(project) {
    var len = 0, coded = 0;
    project.sources.forEach(function (s) { len += (s.text || "").length; coded += codedCharacterCount(project, s.id); });
    return len ? Math.min(100, Math.round((coded / len) * 1000) / 10) : 0;
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

  var LEVEL_NAMES = ["Themes", "Sub-themes", "Codes"];
  function levelOptions(project) {
    var out = [];
    for (var i = 0; i <= Math.max(0, maxThemeDepth(project)); i++) {
      out.push({ value: i, label: LEVEL_NAMES[i] || ("Level " + (i + 1)) });
    }
    return out;
  }

  // Themes at one analysis level with their stats; labels fall back to the
  // full path when two themes at that level share a name.
  function themeLevelItems(project, level, withinThemeId) {
    var themes = themesAtLevel(project, level, withinThemeId);
    var nameCount = {};
    themes.forEach(function (t) { nameCount[t.name] = (nameCount[t.name] || 0) + 1; });
    var topOrder = {};
    themeTree(project).forEach(function (n, i) { topOrder[n.id] = i; });
    return themes.map(function (t) {
      var path = themePath(project, t.id);
      var topId = topLevelThemeId(project, t.id);
      return {
        id: t.id, theme: t, color: safeColor(t.color), path: path,
        label: nameCount[t.name] > 1 ? path : t.name,
        topId: topId, topOrder: topOrder[topId] || 0,
        stats: themeStats(project, t.id)
      };
    });
  }
  // Sort by a stat, keeping sub-themes grouped under their theme.
  function sortThemeItems(items, key, grouped) {
    return items.slice().sort(function (a, b) {
      if (grouped && a.topOrder !== b.topOrder) return a.topOrder - b.topOrder;
      return (b.stats[key] || 0) - (a.stats[key] || 0);
    });
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
    uid: uid, escapeHtml: escapeHtml, escapeRegExp: escapeRegExp,
    nextColor: nextColor, suggestColor: suggestColor, safeColor: safeColor,
    levelOptions: levelOptions, themeLevelItems: themeLevelItems, sortThemeItems: sortThemeItems,
    listProjects: listProjects, loadProject: loadProject, saveProject: saveProject, deleteProject: deleteProject,
    getActiveProjectId: getActiveProjectId, setActiveProjectId: setActiveProjectId, getActiveProject: getActiveProject,
    createProject: createProject,
    addSource: addSource, updateSource: updateSource, deleteSource: deleteSource,
    addTheme: addTheme, updateTheme: updateTheme, deleteTheme: deleteTheme, themeById: themeById,
    childThemes: childThemes, themeTree: themeTree, ancestorsAndSelf: ancestorsAndSelf,
    descendantThemeIds: descendantThemeIds, themeDepth: themeDepth,
    topLevelThemeId: topLevelThemeId, themePath: themePath, maxThemeDepth: maxThemeDepth,
    themesInTreeOrder: themesInTreeOrder, themesAtLevel: themesAtLevel,
    addCoding: addCoding, updateCoding: updateCoding, deleteCoding: deleteCoding,
    codingsForSource: codingsForSource, codingEffectiveThemeIds: codingEffectiveThemeIds,
    recentCodings: recentCodings, sourceCodedPct: sourceCodedPct, projectCodedPct: projectCodedPct,
    respondentsOf: respondentsOf, respondentIdForCoding: respondentIdForCoding,
    themeStats: themeStats, allThemeStats: allThemeStats, matrixData: matrixData,
    evidenceForTheme: evidenceForTheme, groupComparison: groupComparison,
    wordFrequency: wordFrequency, searchTerm: searchTerm,
    DEFAULT_STOPWORDS: DEFAULT_STOPWORDS
  };
})();

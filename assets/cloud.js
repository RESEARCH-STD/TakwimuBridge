/*
 * Optional cloud sync. When assets/config.js holds a Supabase project URL and
 * public key, researchers can sign in and every project is mirrored to their
 * account, so work continues on another computer. The browser copy stays the
 * working copy — every page still reads and writes it synchronously — and
 * this module pulls the account's latest copies when a page opens and pushes
 * each edit shortly after it is made. Without a config it does nothing.
 *
 * Cloud table (see supabase/setup.sql): one row per project, keyed by
 * (owner_id, id), holding the project JSON; row-level security limits every
 * user to their own rows; updated_at is set by the database and doubles as a
 * version stamp, so an upload only succeeds if nobody changed that project
 * since this browser last saw it. Deletions are kept as tombstones
 * (deleted = true) so they reach the user's other computers.
 */
(function () {
  "use strict";

  var SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js";
  var SUPABASE_SRI = "sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok";
  var META_KEY = "tb_sync_meta";      // per project: { remoteUpdatedAt, dirty, rev, localOnly }
  var OWNER_KEY = "tb_sync_owner";    // whose synced copies this browser holds
  var PUSH_DELAY = 700;
  var NETWORK_TIMEOUT = 10000;
  var RETRY_DELAY = 30000;

  var TB = window.TB;
  var cfg = window.TB_CONFIG || {};
  var enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  var sb = null;
  var user = null;
  var state = enabled ? "connecting" : "local";
  var lastError = "";
  var lastSyncedAt = 0;
  var handlers = {};
  var timers = {};
  var inflight = {};
  var again = {};
  var retryTimer = null;
  var expectingSignIn = false;
  var booted = false;

  // ------------------------------------------------------------ helpers
  // One-off notices raised before the page has subscribed (sync starts
  // before DOMContentLoaded) are held and delivered on subscription.
  var HELD = { importNeeded: true, conflict: true, restored: true, recovery: true, remoteChange: true };
  var held = {};
  function call(fn, payload) {
    try { fn(payload); } catch (e) { console.error(e); }
  }
  function on(name, fn) {
    (handlers[name] = handlers[name] || []).push(fn);
    (held[name] || []).splice(0).forEach(function (p) { call(fn, p); });
  }
  function emit(name, payload) {
    var list = handlers[name] || [];
    if (!list.length && HELD[name]) { (held[name] = held[name] || []).push(payload); return; }
    list.forEach(function (fn) { call(fn, payload); });
  }
  // Signing in reloads the page straight afterwards; notices raised during
  // it (e.g. a conflict) are carried across the reload instead of flashing.
  var quiet = false;
  var NOTICES_KEY = "tb_sync_notices";
  function notice(name, payload) {
    if (!quiet) { emit(name, payload); return; }
    var list = [];
    try { list = JSON.parse(sessionStorage.getItem(NOTICES_KEY) || "[]"); } catch (e) { list = []; }
    list.push([name, payload]);
    sessionStorage.setItem(NOTICES_KEY, JSON.stringify(list));
  }
  function replayNotices() {
    var list = [];
    try { list = JSON.parse(sessionStorage.getItem(NOTICES_KEY) || "[]"); } catch (e) { list = []; }
    sessionStorage.removeItem(NOTICES_KEY);
    list.forEach(function (n) { emit(n[0], n[1]); });
  }

  function readMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY) || "{}"); } catch (e) { return {}; }
  }
  function writeMeta(m) { localStorage.setItem(META_KEY, JSON.stringify(m)); }
  function getMeta(id) { return readMeta()[id] || null; }
  function patchMeta(id, patch) {
    var m = readMeta();
    m[id] = Object.assign(m[id] || {}, patch);
    writeMeta(m);
  }
  function dropMeta(id) {
    var m = readMeta();
    delete m[id];
    writeMeta(m);
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error("timeout")); }, ms);
      Promise.resolve(promise).then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  // Supabase calls resolve with { data, error } rather than rejecting.
  function unwrap(res) {
    if (res && res.error) throw res.error;
    return res ? res.data : null;
  }

  function isUntouchedDemo(project) {
    return !!(project && project.id === TB.DEMO_PROJECT_ID && TB.isUntouchedDemo && TB.isUntouchedDemo(project));
  }

  // Transcripts (project.sources) are stored in their own column and only
  // uploaded when their content changed, so coding a passage sends the
  // small part of the project rather than every transcript again.
  function hashText(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + ":" + s.length;
  }
  function sourcesHash(sources) { return hashText(JSON.stringify(sources || [])); }
  function usableRow(row) {
    return !!(row && row.data && typeof row.data === "object" && Array.isArray(row.data.themes) && Array.isArray(row.data.codings));
  }
  // Writes an account copy into the browser; returns its transcripts' hash.
  function writeFromRow(row) {
    var project = Object.assign({}, row.data, { id: row.id, sources: Array.isArray(row.sources) ? row.sources : [] });
    TB.writeProjectLocal(project, Date.parse(row.updated_at));
    return sourcesHash(project.sources);
  }
  function rowFor(project, m) {
    if (!project) return { row: { title: "", data: {}, sources: [], deleted: true }, hash: null };
    var data = Object.assign({}, project);
    delete data.sources;
    var row = { title: project.title || "", data: data, deleted: false };
    var hash = sourcesHash(project.sources);
    if (!m.remoteUpdatedAt || m.sourcesHash !== hash) row.sources = project.sources || [];
    return { row: row, hash: hash };
  }
  function withSources(id, row) {
    if (row.deleted || row.sources) return row;
    var p = TB.loadProject(id);
    return Object.assign({}, row, { sources: (p && p.sources) || [] });
  }

  // ------------------------------------------------------------- status
  function pendingCount() {
    var m = readMeta();
    return Object.keys(m).filter(function (id) { return m[id].dirty && !m[id].localOnly; }).length;
  }
  function status() {
    return {
      enabled: enabled, state: state, error: lastError, lastSyncedAt: lastSyncedAt,
      user: user ? { id: user.id, email: user.email } : null,
      pending: user ? pendingCount() : 0
    };
  }
  function setState(s) {
    state = s;
    emit("status", status());
  }
  function refreshState() {
    if (!user) return;
    if (Object.keys(inflight).length || Object.keys(timers).length) setState("syncing");
    else if (pendingCount()) setState(lastError ? (navigator.onLine === false || /offline|timeout|fetch|network/i.test(lastError) ? "offline" : "error") : "pending");
    else { lastSyncedAt = Date.now(); lastError = ""; setState("synced"); }
  }

  function handleError(err) {
    var msg = (err && (err.message || err.error_description || err.msg)) || String(err);
    lastError = /timeout|Failed to fetch|NetworkError|Load failed|network/i.test(msg) || navigator.onLine === false
      ? "offline" : msg;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(flushDirty, RETRY_DELAY);
  }

  // --------------------------------------------------------------- pull
  // Keep both versions when a project changed here *and* in the account
  // since this browser last synced: the account's copy keeps the original
  // id, this browser's edits become a new "conflicted copy" project.
  function keepBoth(local, row) {
    var copy = JSON.parse(JSON.stringify(local));
    copy.id = TB.uid("proj");
    copy.title = local.title + " (conflicted copy, " + new Date().toLocaleDateString() + ")";
    copy.demoVersion = undefined;
    TB.writeProjectLocal(copy);
    patchMeta(copy.id, { dirty: true, rev: 1 });
    patchMeta(local.id, { remoteUpdatedAt: row.updated_at, dirty: false, sourcesHash: writeFromRow(row) });
    schedulePush(copy.id);
    return { id: local.id, title: local.title, copyId: copy.id, copyTitle: copy.title };
  }

  function applyPull(heads, full) {
    var meta = readMeta();
    var seen = {};
    var conflicts = [];
    heads.forEach(function (head) {
      seen[head.id] = true;
      var m = meta[head.id] || {};
      if (m.localOnly) return;
      var local = TB.loadProject(head.id);
      // "Changed here" = edited since the last sync, or never synced at all
      // (its relation to the account's copy is unknown) unless it is the
      // untouched demo every fresh browser seeds.
      var changedHere = !!local && (!!m.dirty || (!m.remoteUpdatedAt && !isUntouchedDemo(local)));
      if (head.deleted) {
        if (head.id === TB.DEMO_PROJECT_ID && TB.markDemoSeeded) TB.markDemoSeeded();
        if (local && changedHere && m.remoteUpdatedAt !== head.updated_at) {
          // Deleted elsewhere but edited here: keep the work; the next
          // upload restores it to the account.
          patchMeta(head.id, { remoteUpdatedAt: head.updated_at, dirty: true, sourcesHash: null });
          return;
        }
        if (local) TB.removeProjectLocal(head.id);
        dropMeta(head.id);
        return;
      }
      var row = full[head.id];
      if (!usableRow(row)) return;                // already up to date here (or unreadable)
      // Deleted here (e.g. offline) and unchanged in the account since:
      // the pending upload delivers the deletion, so don't bring it back.
      if (!local && m.dirty && m.remoteUpdatedAt === row.updated_at) return;
      if (!local || !changedHere) {
        patchMeta(head.id, { remoteUpdatedAt: row.updated_at, dirty: false, sourcesHash: writeFromRow(row) });
        return;
      }
      conflicts.push(keepBoth(local, row));
    });
    // Synced before but gone from the account altogether.
    TB.listProjects().forEach(function (p) {
      var m = meta[p.id];
      if (m && m.remoteUpdatedAt && !m.localOnly && !m.dirty && !seen[p.id]) {
        TB.removeProjectLocal(p.id);
        dropMeta(p.id);
      }
    });
    return conflicts;
  }

  // Two steps so that opening a page usually transfers only a short list
  // of ids and version stamps; full project data is fetched only for
  // projects that changed in the account.
  function pullAll() {
    return withTimeout(sb.from("projects").select("id,updated_at,deleted"), NETWORK_TIMEOUT).then(unwrap).then(function (heads) {
      heads = heads || [];
      var meta = readMeta();
      var need = heads.filter(function (h) {
        var m = meta[h.id] || {};
        if (h.deleted || m.localOnly) return false;
        if (m.remoteUpdatedAt !== h.updated_at) return true;
        return !TB.loadProject(h.id) && !m.dirty;
      }).map(function (h) { return h.id; });
      if (!need.length) return applyPull(heads, {});
      return withTimeout(sb.from("projects").select("id,title,data,sources,updated_at,deleted").in("id", need), NETWORK_TIMEOUT)
        .then(unwrap)
        .then(function (rows) {
          var full = {};
          (rows || []).forEach(function (r) { full[r.id] = r; });
          return applyPull(heads, full);
        });
    }).then(function (conflicts) {
      lastSyncedAt = Date.now();
      conflicts.forEach(function (c) { notice("conflict", c); });
    });
  }

  // --------------------------------------------------------------- push
  function schedulePush(id, delay) {
    if (!user) return;
    clearTimeout(timers[id]);
    timers[id] = setTimeout(function () { delete timers[id]; push(id); }, delay === undefined ? PUSH_DELAY : delay);
    setState("syncing");
  }

  function selectOne(id) {
    return withTimeout(sb.from("projects").select("id,title,data,sources,updated_at,deleted").eq("owner_id", user.id).eq("id", id), NETWORK_TIMEOUT)
      .then(unwrap).then(function (rows) { return rows && rows[0]; });
  }

  // Each resolves to { updatedAt, direct } — direct when this browser's
  // version is what the account now holds; otherwise reconcile() already
  // updated the browser copy and its sync record.
  function insertRow(id, row) {
    row = withSources(id, row);
    return withTimeout(sb.from("projects").insert(Object.assign({ owner_id: user.id, id: id }, row)).select("updated_at"), NETWORK_TIMEOUT)
      .then(function (res) {
        if (res.error && res.error.code === "23505") return reconcile(id, row);   // already in the account
        return { updatedAt: unwrap(res)[0].updated_at, direct: true };
      });
  }

  // expected = the version this browser last saw; the update only applies if
  // the account still holds exactly that version.
  function updateRow(id, row, expected) {
    var q = sb.from("projects").update(row).eq("owner_id", user.id).eq("id", id);
    if (expected) q = q.eq("updated_at", expected);
    return withTimeout(q.select("updated_at"), NETWORK_TIMEOUT).then(unwrap).then(function (rows) {
      if (rows && rows.length) return { updatedAt: rows[0].updated_at, direct: true };
      return expected ? reconcile(id, row) : insertRow(id, row);
    });
  }

  // The project changed (or vanished) in the account since this browser
  // last synced it.
  function reconcile(id, row) {
    return selectOne(id).then(function (remote) {
      if (!remote) return row.deleted ? { updatedAt: null, direct: true } : insertRow(id, row);
      if (remote.deleted || !usableRow(remote)) {
        // Deleted elsewhere: our delete is moot; our edits bring it back.
        return row.deleted ? { updatedAt: remote.updated_at, direct: true } : updateRow(id, withSources(id, row), null);
      }
      if (row.deleted) {
        // Edited elsewhere after this browser last saw it: don't delete
        // someone's newer work — restore it here instead.
        patchMeta(id, { sourcesHash: writeFromRow(remote) });
        notice("restored", { id: id, title: remote.title });
        return { updatedAt: remote.updated_at, restored: true };
      }
      var local = TB.loadProject(id);
      if (!local || isUntouchedDemo(local)) {
        patchMeta(id, { sourcesHash: writeFromRow(remote) });
        return { updatedAt: remote.updated_at, direct: false };
      }
      notice("conflict", keepBoth(local, remote));
      return { updatedAt: remote.updated_at, direct: false };
    });
  }

  function push(id) {
    if (!user) return;
    if (inflight[id]) { again[id] = true; return; }
    var m = getMeta(id);
    if (!m || !m.dirty || m.localOnly) { refreshState(); return; }
    var rev = m.rev || 0;
    var project = TB.loadProject(id);
    var built = rowFor(project, m);
    var op = m.remoteUpdatedAt ? updateRow(id, built.row, m.remoteUpdatedAt) : insertRow(id, built.row);
    inflight[id] = op.then(function (result) {
      var stillDirty = ((getMeta(id) || {}).rev || 0) !== rev;
      if (result.restored) {
        patchMeta(id, { remoteUpdatedAt: result.updatedAt, dirty: false });
      } else if (!project) {
        dropMeta(id);                                    // deletion delivered
      } else if (result.direct) {
        patchMeta(id, { remoteUpdatedAt: result.updatedAt, dirty: stillDirty, sourcesHash: built.hash });
      } else {
        patchMeta(id, { remoteUpdatedAt: result.updatedAt, dirty: stillDirty });
      }
      lastError = "";
    }, handleError).then(function () {
      delete inflight[id];
      if (again[id]) { delete again[id]; push(id); }
      refreshState();
    });
  }

  function flushDirty() {
    if (!user) return;
    var m = readMeta();
    Object.keys(m).forEach(function (id) {
      if (m[id].dirty && !m[id].localOnly && !timers[id]) push(id);
    });
    refreshState();
  }

  function flushAndWait(ms) {
    Object.keys(timers).forEach(function (id) { clearTimeout(timers[id]); delete timers[id]; });
    flushDirty();
    var deadline = Date.now() + ms;
    return new Promise(function (resolve) {
      (function check() {
        if (!Object.keys(inflight).length || Date.now() > deadline) return resolve();
        setTimeout(check, 100);
      })();
    });
  }

  // Every save/delete marks the project for upload. Projects this browser
  // already tracks stay marked even while signed out (e.g. an expired
  // session offline), so the edits upload after the next sign-in.
  TB.onProjectChange(function (type, id) {
    if (!enabled) return;
    var m = getMeta(id);
    if (!m && !user) return;
    if (m && m.localOnly) return;
    if (type === "delete" && !(m && m.remoteUpdatedAt)) { dropMeta(id); return; }
    patchMeta(id, { dirty: true, rev: ((m && m.rev) || 0) + 1 });
    schedulePush(id);
  });

  // ------------------------------------------------------------ session
  // Remove another account's synced copies from this browser. Unsynced
  // edits are kept as browser-only projects rather than lost.
  function forgetAccountData(includeUnsynced) {
    var m = readMeta();
    Object.keys(m).forEach(function (id) {
      if (m[id].localOnly) return;
      if (m[id].dirty && !includeUnsynced && TB.loadProject(id)) { m[id] = { localOnly: true }; return; }
      TB.removeProjectLocal(id);
      delete m[id];
    });
    writeMeta(m);
    localStorage.removeItem(OWNER_KEY);
    if (TB.forgetDemoSeed) TB.forgetDemoSeed();
  }

  function startSession(session) {
    user = session.user;
    var owner = localStorage.getItem(OWNER_KEY);
    if (owner && owner !== user.id) forgetAccountData(false);
    localStorage.setItem(OWNER_KEY, user.id);
    setState("syncing");
    return pullAll().then(function () {
      var m = readMeta();
      var demo = TB.loadProject(TB.DEMO_PROJECT_ID);
      if (demo && !m[demo.id]) { patchMeta(demo.id, { dirty: true, rev: 1 }); }
      flushDirty();
      var unsynced = TB.listProjects().filter(function (p) { return !m[p.id] && p.id !== TB.DEMO_PROJECT_ID; });
      if (unsynced.length && !quiet) emit("importNeeded", unsynced);
    });
  }

  // Reloads only react to sign-ins/outs in *another tab* once this page has
  // started; during start-up getSession() picks up the session itself (and
  // a reload would swallow a password-reset link's recovery step).
  function onAuthEvent(event, session) {
    // Supabase advises against calling its API inside this callback.
    setTimeout(function () {
      if (event === "PASSWORD_RECOVERY") emit("recovery");
      else if (!booted) return;
      else if (event === "SIGNED_OUT" && user) window.location.reload();
      else if (event === "SIGNED_IN" && session && !user && !expectingSignIn) window.location.reload();
    }, 0);
  }

  function loadLibrary() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = SUPABASE_JS;
      s.integrity = SUPABASE_SRI;
      s.crossOrigin = "anonymous";
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Could not load the sync library — check your internet connection.")); };
      document.head.appendChild(s);
    });
  }

  function boot() {
    if (!enabled) return Promise.resolve();
    return withTimeout(loadLibrary(), NETWORK_TIMEOUT).then(function () {
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      sb.auth.onAuthStateChange(onAuthEvent);
      return withTimeout(sb.auth.getSession(), NETWORK_TIMEOUT);
    }).then(function (res) {
      var session = res && res.data && res.data.session;
      if (!session) { setState("signed-out"); return; }
      return startSession(session).then(refreshState);
    }).catch(function (err) {
      handleError(err);
      setState(user ? "offline" : "unavailable");
    }).then(function () {
      booted = true;
      replayNotices();
    });
  }

  TB.setReady(boot());

  window.addEventListener("online", flushDirty);
  // Coming back to a tab: tell the page if its project changed on another
  // computer meanwhile (the page shows stale data until reloaded).
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible" || !user) return;
    flushDirty();
    var id = TB.getActiveProjectId();
    var m = id && getMeta(id);
    if (!m || !m.remoteUpdatedAt || m.localOnly) return;
    withTimeout(sb.from("projects").select("updated_at,deleted").eq("owner_id", user.id).eq("id", id), NETWORK_TIMEOUT)
      .then(unwrap).then(function (rows) {
        var row = rows && rows[0];
        var cur = getMeta(id) || {};
        if (row && row.updated_at !== cur.remoteUpdatedAt && !inflight[id] && !timers[id]) emit("remoteChange", { id: id, deleted: row.deleted });
      }).catch(function () {});
  });

  // ------------------------------------------------------------ account
  function redirectUrl() {
    return window.location.origin + window.location.pathname.replace(/[^/]*$/, "") + "index.html";
  }
  function friendly(err) {
    var msg = (err && (err.message || err.msg)) || String(err);
    if (/invalid login credentials/i.test(msg)) return "That email and password don't match an account.";
    if (/email not confirmed/i.test(msg)) return "Please confirm your email first — check your inbox for the link.";
    if (/already registered|already exists/i.test(msg)) return "An account with this email already exists — sign in instead.";
    if (/password should be/i.test(msg)) return msg;
    if (/rate limit/i.test(msg)) return "Too many attempts — please wait a few minutes and try again.";
    if (/timeout|fetch|network/i.test(msg)) return "Couldn't reach the sync service — check your internet connection.";
    return msg;
  }
  function needClient() {
    if (!sb) throw new Error("Cloud sync isn't available right now — check your internet connection and reload.");
  }

  // The UI reloads after these resolve; quiet holds notices for the reload.
  function enterSession(session) {
    quiet = true;
    return startSession(session).then(function () { return flushAndWait(8000); });
  }

  function signIn(email, password) {
    needClient();
    expectingSignIn = true;
    return sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
      if (res.error) throw res.error;
      return enterSession(res.data.session);
    }).catch(function (err) { expectingSignIn = false; quiet = false; throw new Error(friendly(err)); });
  }

  function signUp(email, password) {
    needClient();
    expectingSignIn = true;
    return sb.auth.signUp({ email: email, password: password, options: { emailRedirectTo: redirectUrl() } }).then(function (res) {
      if (res.error) throw res.error;
      if (!res.data.session) { expectingSignIn = false; return { needsConfirmation: true }; }
      return enterSession(res.data.session).then(function () { return { needsConfirmation: false }; });
    }).catch(function (err) { expectingSignIn = false; quiet = false; throw new Error(friendly(err)); });
  }

  function sendReset(email) {
    needClient();
    return sb.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() }).then(function (res) {
      if (res.error) throw res.error;
    }).catch(function (err) { throw new Error(friendly(err)); });
  }

  function updatePassword(password) {
    needClient();
    return sb.auth.updateUser({ password: password }).then(function (res) {
      if (res.error) throw res.error;
    }).catch(function (err) { throw new Error(friendly(err)); });
  }

  // Signing out removes this account's projects from the browser (they are
  // safe in the account), so the next person at a shared computer can't
  // open them. Resolves false if the user chose to stay signed in.
  function signOut() {
    if (!sb || !user) return Promise.resolve(true);
    return flushAndWait(8000).then(function () {
      if (pendingCount() && !window.confirm("Some changes haven't reached your account yet (you may be offline). Signing out now removes them from this browser. Sign out anyway?")) {
        return false;
      }
      forgetAccountData(true);
      user = null;
      return withTimeout(sb.auth.signOut(), NETWORK_TIMEOUT).catch(function () {}).then(function () { return true; });
    });
  }

  // Answer to "importNeeded": add these browser-only projects to the
  // account, or keep them on this browser only.
  function adopt(ids) {
    ids.forEach(function (id) { patchMeta(id, { dirty: true, rev: 1, localOnly: false }); });
    flushDirty();
  }
  function keepLocal(ids) {
    ids.forEach(function (id) { patchMeta(id, { localOnly: true }); });
  }

  // "cloud" | "pending" | "local" for a project, or null when not signed in.
  function syncState(id) {
    if (!enabled || !user) return null;
    var m = getMeta(id);
    if (!m || m.localOnly) return "local";
    return m.dirty ? "pending" : "cloud";
  }

  TB.cloud = {
    enabled: function () { return enabled; },
    status: status, on: on,
    signIn: signIn, signUp: signUp, sendReset: sendReset, updatePassword: updatePassword, signOut: signOut,
    adopt: adopt, keepLocal: keepLocal, syncState: syncState, flush: flushDirty
  };
})();

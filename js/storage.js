// ═══════════════════════════════════════════════════════
// STORAGE — Supabase cloud + localStorage fallback
// ═══════════════════════════════════════════════════════

// An item's updatedAt must mean "the last time THIS item's own content
// changed", not "the last time this device saved anything". Otherwise a stale
// device that merely pans the canvas re-stamps everything as newer and wins
// every merge. We fingerprint each item's own fields (children excluded, they
// get their own fingerprints) and only bump updatedAt when it differs from the
// fingerprint recorded at the previous save.
const SKIP_KEYS = new Set(['updatedAt','updated_at','_fp','_edge','__remoteUpdatedAt',
  '_remoteUpdatedAt','deletedIds','systems','connectors','wires','splices']);
function fingerprint(item) {
  return JSON.stringify(item, (k, v) => SKIP_KEYS.has(k) ? undefined : v);
}
function touchUpdated(obj) {
  if (!obj) return;
  const fp = fingerprint(obj);
  if (obj.updatedAt === undefined) {
    obj.updatedAt = Date.now();            // brand-new item
  } else if (obj._fp !== undefined && obj._fp !== fp) {
    obj.updatedAt = Date.now();            // content changed since last save
  }                                         // legacy item with no _fp: just baseline it
  obj._fp = fp;
  obj.updated_at = obj.updatedAt;
}
// Record fingerprints WITHOUT bumping any timestamps. Called after loading or
// merging data so the first real edit afterwards is detected as a change.
function baselineFingerprints(node) {
  if (!node) return;
  node._fp = fingerprint(node);
  ['systems','connectors','wires','splices'].forEach(k => (node[k] || []).forEach(baselineFingerprints));
}

function touchProjectTree(node) {
  if (!node) return;
  touchUpdated(node);
  (node.systems || []).forEach(sys => {
    touchProjectTree(sys);
  });
  (node.connectors || []).forEach(conn => {
    touchUpdated(conn);
  });
  (node.wires || []).forEach(wire => {
    touchUpdated(wire);
  });
  (node.splices || []).forEach(splice => {
    touchUpdated(splice);
  });
}

// Save current project locally only. The final publish step is explicit via
// the top-right Push button, so local edits are not silently overwritten by
// an automatic cloud merge while the user is still authoring.
function save() {
  if (activeProjId) {
    const proj = ST.projects.find(p => p.id === activeProjId);
    if (proj && navStack.length > 0) {
      // Persist the live scope back into its parent object, then mirror the
      // root project arrays. The app can be inside a subsystem view, and the
      // previous implementation only saved navStack[0], which left the live
      // current scope stale and let older project data overwrite newer edits.
      for (let i = navStack.length - 1; i >= 0; i--) {
        const scopeEntry = navStack[i];
        if (scopeEntry.parentSys && scopeEntry.parentScope) {
          scopeEntry.parentSys.systems    = scopeEntry.systems || [];
          scopeEntry.parentSys.connectors = scopeEntry.connectors || [];
          scopeEntry.parentSys.wires      = scopeEntry.wires || [];
          scopeEntry.parentSys.splices    = scopeEntry.splices || [];
        }
      }

      const root = navStack[0];
      proj.systems    = root.systems;
      proj.connectors = root.connectors;
      proj.wires      = root.wires;
      proj.splices    = root.splices || [];
    }
  }

  ST.projects.forEach(proj => {
    if (proj) touchProjectTree(proj);
  });

  try {
    localStorage.setItem('rw3', JSON.stringify(ST));
    if (activeProjId) localStorage.setItem('rw3_proj', activeProjId);
    localStorage.setItem('rw3_page', currentPage);
    localStorage.setItem('rw3_nav', JSON.stringify(
      navStack.map(sc => ({label:sc.label, sysId:sc.sysId||null}))
    ));
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════
// CLOUD SYNC
// ═══════════════════════════════════════════════════════
// Model (deliberately simple, no timestamp merging):
//   Push : this device's copy of every project you CHANGED overwrites the
//          cloud copy. Whoever pushes last wins.
//   Pull : the cloud copy replaces this device's copy. Runs on login, on page
//          load, when the tab is re-focused, and on the Sync button.
//   Safety: a project with unpushed local edits is never overwritten silently.
//          Auto-pull skips it; the Sync button asks first.
// "Changed" = the project's content hash differs from the hash recorded the
// last time it was pulled or pushed (ST.syncedHashes). Panning/zooming and
// other non-data actions never count.

const RW_SYNC_BUILD = 'sync-2026-09-19e';
console.log('[RocketWire] storage.js loaded, build', RW_SYNC_BUILD);

const HASH_SKIP = new Set(['updatedAt','updated_at','_fp','_edge','__remoteUpdatedAt','_remoteUpdatedAt']);
// Canonical JSON: sorted keys (Postgres jsonb does not keep key order), and
// trailing default values in channels/colors ignored (the UI pads those
// arrays just by viewing a connector, which is not a user edit).
function canonJSON(v, key) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) {
    let n = v.length;
    if (key === 'channels') { while (n > 0 && (v[n-1] === '' || v[n-1] == null)) n--; }
    else if (key === 'colors') { while (n > 0 && (v[n-1] === 'red' || v[n-1] == null)) n--; }
    return '[' + v.slice(0, n).map(x => canonJSON(x)).join(',') + ']';
  }
  return '{' + Object.keys(v).filter(k => !HASH_SKIP.has(k) && v[k] !== undefined).sort()
    .map(k => JSON.stringify(k) + ':' + canonJSON(v[k], k)).join(',') + '}';
}
function cyrb53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
function projHash(p) { return cyrb53(canonJSON(p)); }
function syncedHashes() { if (!ST.syncedHashes) ST.syncedHashes = {}; return ST.syncedHashes; }
function dirtyProjects() {
  const h = syncedHashes();
  return ST.projects.filter(p => projHash(p) !== h[p.id]);
}
function persistLocal() { try { localStorage.setItem('rw3', JSON.stringify(ST)); } catch(e) {} }

// Upload projects that exist only on this device and were never synced
// (used right after "New project"). Never touches already-synced projects.
async function saveToCloud() {
  if (!sbUser || !ST.projects.length) return;
  try {
    const { data: existing } = await sb.from('projects').select('id').eq('user_id', sbUser.id);
    const inCloud = new Set((existing || []).map(r => r.id));
    const h = syncedHashes();
    const fresh = ST.projects.filter(p => !inCloud.has(p.id) && !(p.id in h));
    if (!fresh.length) return;
    const now = new Date().toISOString();
    const { error } = await sb.from('projects').upsert(
      fresh.map(p => ({ id: p.id, user_id: sbUser.id, name: p.name, data: p, updated_at: now })));
    if (error) throw error;
    fresh.forEach(p => { h[p.id] = projHash(p); });
    persistLocal();
  } catch(e) {
    console.warn('Cloud save failed:', e);
  }
}

// PUSH: overwrite the cloud copy of every project changed on this device.
async function pushChanges() {
  if (!sbUser) {
    if (ST.isLoggedIn) {
      notify('Push needs a Supabase account. Log out, then log in with your email account.', 'err');
    } else {
      notify('Log in to push changes to all devices', 'err');
      reqAuth(pushChanges);
    }
    return;
  }
  save(); // flush the live canvas scope into its project first
  const toPush = dirtyProjects();
  if (!toPush.length) { notify('Nothing to push — no changes since last sync', 'warn'); return; }

  const btn = document.getElementById('push-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Pushing…'; }
  try {
    const now = new Date().toISOString();
    const payload = toPush.map(p => ({ id: p.id, user_id: sbUser.id, name: p.name, data: p, updated_at: now }));
    // .select() returns the rows the database really wrote, so a write that
    // RLS or a key mismatch drops can't masquerade as success.
    const { data: written, error } = await sb.from('projects').upsert(payload).select('id');
    if (error) throw error;
    if (!written || written.length !== payload.length) {
      throw new Error('Cloud saved ' + (written ? written.length : 0) + ' of ' + payload.length + ' projects (check RLS policies)');
    }
    const h = syncedHashes();
    toPush.forEach(p => { h[p.id] = projHash(p); });
    persistLocal();
    notify('Pushed ' + toPush.length + ' project(s) as ' + sbUser.email, 'ok');
  } catch (e) {
    console.warn('Push failed:', e);
    notify('Push failed: ' + (e && e.message ? e.message : 'unknown error'), 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Push'; }
  }
}

// Record that an item was deleted, so future merges don't resurrect it.
// Stored on the project itself (proj.deletedIds) so it travels with save/load/merge.
function markDeleted(ids) {
  if (!activeProjId || !ids || !ids.length) return;
  const proj = ST.projects.find(p => p.id === activeProjId);
  if (!proj) return;
  if (!proj.deletedIds) proj.deletedIds = [];
  const now = Date.now();
  ids.forEach(id => { if (id) proj.deletedIds.push({ id, ts: now }); });
}

// Strip any tombstoned ids out of a project's arrays, recursing into
// nested subsystems (each system node has its own systems/connectors/wires/splices).
function pruneDeletedTree(node, delSet) {
  if (!node || !delSet.size) return;
  node.systems    = (node.systems    || []).filter(s => !delSet.has(s.id));
  node.connectors = (node.connectors || []).filter(c => !delSet.has(c.id));
  node.wires      = (node.wires      || []).filter(w => !delSet.has(w.id));
  node.splices    = (node.splices    || []).filter(s => !delSet.has(s.id));
  node.systems.forEach(sys => pruneDeletedTree(sys, delSet));
}

// After ST.projects is replaced by a pull, the live navStack still points at
// the OLD arrays. Re-point every level at the new objects.
function rebindNavStack() {
  if (!activeProjId || !navStack.length) return;
  const proj = ST.projects.find(p => p.id === activeProjId);
  if (!proj) return;
  Object.assign(navStack[0], {
    label: proj.name, systems: proj.systems, connectors: proj.connectors,
    wires: proj.wires, splices: proj.splices || []
  });
  for (let i = 1; i < navStack.length; i++) {
    const sys = (navStack[i-1].systems || []).find(x => x.id === navStack[i].sysId);
    if (!sys) { navStack = navStack.slice(0, i); break; } // subsystem deleted elsewhere
    Object.assign(navStack[i], {
      label: sys.name, systems: sys.systems, connectors: sys.connectors,
      wires: sys.wires, splices: sys.splices || [],
      parentSys: sys, parentScope: navStack[i-1]
    });
  }
}

// PULL: cloud replaces local, except projects with unpushed edits.
//   manual   : Sync button — reports the outcome, asks before discarding edits
//   takeCloud: discard unpushed edits without asking (rwForcePull)
let _syncBusy = false, _lastAutoPull = 0;
async function pullFromCloud({ manual = false, takeCloud = false } = {}) {
  if (!sbUser) {
    if (manual) notify('Sync needs a Supabase account. Log out, then log in with your email account.', 'err');
    return false;
  }
  if (_syncBusy) return false;
  _syncBusy = true;
  try {
    const { data, error } = await sb.from('projects').select('*').eq('user_id', sbUser.id);
    if (error || !data) {
      if (manual) notify('Sync failed: ' + (error && error.message ? error.message : 'no data returned'), 'err');
      return false;
    }
    const h = syncedHashes();
    const byId = new Map(ST.projects.map(p => [p.id, p]));
    const cloudIds = new Set(data.map(r => r.id));
    const isDirty = p => projHash(p) !== h[p.id];

    // Projects where cloud differs from this device AND this device has unpushed edits
    const conflicts = data.map(r => byId.get(r.id))
      .filter((p, i) => p && isDirty(p) && projHash(data[i].data) !== projHash(p));
    let useCloudForConflicts = takeCloud;
    if (conflicts.length && !takeCloud) {
      if (manual) {
        useCloudForConflicts = confirm(
          'These projects have changes on this device that were never pushed:\n\n  ' +
          conflicts.map(p => p.name).join('\n  ') +
          '\n\nOK = discard them and use the cloud version.\nCancel = keep mine (Push will overwrite the cloud).');
      } else {
        notify('The cloud has a different version of "' + conflicts[0].name + '". Click Sync to review, or Push to overwrite it.', 'warn');
      }
    }

    let changed = false;
    const next = [];
    for (const r of data) {
      const local = byId.get(r.id);
      if (!local) { next.push(r.data); h[r.id] = projHash(r.data); changed = true; continue; }
      const same = projHash(r.data) === projHash(local);
      if (same) { next.push(local); h[r.id] = projHash(local); continue; }
      if (!isDirty(local) || useCloudForConflicts) {
        next.push(r.data); h[r.id] = projHash(r.data); changed = true;
      } else {
        next.push(local); // keep unpushed edits
      }
    }
    // Local projects the cloud doesn't have
    for (const p of ST.projects) {
      if (cloudIds.has(p.id)) continue;
      if (p.id in h) {
        // It was synced before, so it was deleted on another device.
        if (!isDirty(p) || useCloudForConflicts) { delete h[p.id]; changed = true; continue; }
        delete h[p.id]; // keep the unpushed edits; Push will re-create it
      }
      next.push(p);
    }
    ST.projects = next;
    ST.projects.forEach(baselineFingerprints);
    persistLocal();

    if (changed) {
      if (activeProjId && !ST.projects.find(p => p.id === activeProjId)) {
        navStack = []; activeProjId = null; goPage('pg-home');
      } else if (currentPage === 'pg-canvas' && navStack.length) {
        rebindNavStack(); buildBC(currentPage); redraw();
      } else if (currentPage === 'pg-home') {
        renderHome();
      }
    }
    if (manual) notify(changed ? 'Synced — updated from the cloud' : 'Already up to date', 'ok');
    else if (changed) notify('Updated from the cloud', 'ok');
    return true;
  } catch (e) {
    console.warn('Cloud pull failed:', e);
    if (manual) notify('Sync failed: ' + (e && e.message ? e.message : 'unknown error'), 'err');
    return false;
  } finally {
    _syncBusy = false;
  }
}
// Sync button
function loadFromCloud() { return pullFromCloud({ manual: true }); }

// Automatic pulls (login, page load, tab re-focus). Never while the user is
// in the middle of editing a connector / splice / new system.
function autoPull() {
  if (!sbUser) return;
  if (['pg-conn', 'pg-add', 'pg-splice'].includes(currentPage)) return;
  if (Date.now() - _lastAutoPull < 3000) return;
  _lastAutoPull = Date.now();
  pullFromCloud();
}
sb.auth.onAuthStateChange((event, session) => {
  if (session && session.user) sbUser = session.user;
  if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') setTimeout(autoPull, 0); // never await supabase calls inside this callback
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoPull(); });

// ── DIAGNOSTICS (run in the browser console) ──────────────────────────
// rwDebug(): who am I to the cloud, what does each side think every
// connector's type is, and which projects count as "changed" locally?
async function rwDebug() {
  const desc = c => '#' + c.num + ' ' + c.type;
  const out = {
    build: RW_SYNC_BUILD,
    loggedInFlag: ST.isLoggedIn,
    supabaseUser: sbUser ? sbUser.email : null,
    supabaseUserId: sbUser ? sbUser.id : null,
    unpushedProjects: dirtyProjects().map(p => p.name),
    local: ST.projects.map(p => ({ id: p.id, name: p.name, connectors: collectAllConnectors(p).map(desc) }))
  };
  if (sbUser) {
    const { data, error } = await sb.from('projects').select('id,name,user_id,updated_at,data').eq('user_id', sbUser.id);
    out.cloudError = error ? error.message : null;
    out.cloud = (data || []).map(r => ({ id: r.id, name: r.name, updated_at: r.updated_at, connectors: collectAllConnectors(r.data).map(desc) }));
  }
  console.log(JSON.stringify(out, null, 2));
  return out;
}
// rwForcePull(): make this device match the cloud, discarding unpushed edits.
function rwForcePull() { return pullFromCloud({ manual: true, takeCloud: true }); }

// Poll for changes every 30 seconds when logged in
let _pollTimer = null;
function startPolling() {
  // Disabled by design: use explicit Push / Sync actions instead of
  // automatically pulling remote state mid-edit.
  return;
}
function stopPolling() {
  return;
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem('rw3') || 'null');
    if (d) {
      ST.isLoggedIn = !!d.isLoggedIn; ST.projects = d.projects || [];
      ST.syncedHashes = d.syncedHashes || {};
      ST.projects.forEach(baselineFingerprints);
    }
    const savedProjId = localStorage.getItem('rw3_proj');
    if (savedProjId && ST.projects.find(p => p.id === savedProjId)) {
      activeProjId = savedProjId;
    }
  } catch(e) {}
}

// Current scope
function scope() { return navStack[navStack.length - 1] || null; }

// ═══════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════
let currentPage = 'pg-home';
function goPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  currentPage = id;
  addTopbarSyncButton(); // no-op if it already exists
  const syncBtnEl = document.getElementById('sync-btn');
  if (syncBtnEl) syncBtnEl.style.display = (id === 'pg-canvas') ? '' : 'none';
  // Always persist current page immediately so refresh knows where to return
  try { localStorage.setItem('rw3_page', id); } catch(e) {}
  buildBC(id);
  if (id === 'pg-canvas') { setTimeout(initCanvas, 30); }
  if (id === 'pg-conn') { renderConnPage(); }
  if (id === 'pg-add') { initAdd(); }
  if (id === 'pg-splice') { initSplicePage(); }
}

function buildBC(pageId) {
  const bc = document.getElementById('bc'); bc.innerHTML = '';
  if (pageId === 'pg-home') return;
  const p = ST.projects.find(x => x.id === activeProjId);

  function btn(label, isCur, fn) {
    const b = document.createElement('button');
    b.className = 'bc-btn' + (isCur ? ' cur' : '');
    b.textContent = label;
    if (!isCur && fn) b.onclick = fn;
    return b;
  }
  const sep = () => { const s = document.createElement('span'); s.className = 'bc-sep'; s.textContent = '›'; return s; };

  bc.appendChild(btn('Home', false, () => { navStack = []; goPage('pg-home'); }));

  if (p) {
    bc.appendChild(sep());
    if (pageId === 'pg-canvas') {
      navStack.forEach((sc, i) => {
        if (i > 0) bc.appendChild(sep());
        const isCur = (i === navStack.length - 1);
        bc.appendChild(btn(sc.label, isCur, isCur ? null : () => {
          navStack = navStack.slice(0, i + 1);
          goPage('pg-canvas');
        }));
      });
    } else {
      navStack.forEach((sc, i) => {
        bc.appendChild(sep());
        bc.appendChild(btn(sc.label, false, () => { navStack = navStack.slice(0, i + 1); goPage('pg-canvas'); }));
      });
      bc.appendChild(sep());
      const labels = { 'pg-conn': 'Connector', 'pg-add': 'Add system', 'pg-splice': 'Splice' };
      bc.appendChild(btn(labels[pageId] || pageId, true, null));
    }
  }
}

function goAdd() { goPage('pg-add'); }

// ═══════════════════════════════════════════════════════
// AUTH — Supabase email/password
// ═══════════════════════════════════════════════════════
async function doLogin() {
  const email = document.getElementById('l-user').value.trim();
  const pass  = document.getElementById('l-pass').value;
  const err   = document.getElementById('l-err');

  // Try Supabase auth first. If a shared team Supabase account is configured
  // (TEAM_SUPABASE_EMAIL in constants.js), the "rocketteam" username maps to
  // it, so that login can sync across devices instead of being local-only.
  const loginEmail = (email === CREDS.user && TEAM_SUPABASE_EMAIL) ? TEAM_SUPABASE_EMAIL : email;
  const { data, error } = await sb.auth.signInWithPassword({ email: loginEmail, password: pass });
  if (!error && data.user) {
    sbUser = data.user;
    ST.isLoggedIn = true; save(); applyLogin();
    closeM('m-login'); notify('Logged in', 'ok');
    if (authCb) { authCb(); authCb = null; }
    return;
  }

  // Fallback: original hardcoded credentials
  if (email === CREDS.user && pass === CREDS.pass) {
    ST.isLoggedIn = true; save(); applyLogin();
    closeM('m-login'); notify('Logged in', 'ok');
    if (authCb) { authCb(); authCb = null; }
    return;
  }

  err.style.display = 'block';
}

async function doSignup() {
  const email = document.getElementById('l-user').value.trim();
  const pass  = document.getElementById('l-pass').value;
  const { data, error } = await sb.auth.signUp({ email, password: pass });
  if (error) { notify('Sign up failed: ' + error.message, 'err'); return; }
  notify('Check your email to confirm your account!', 'ok');
}

function applyLogin() {
  document.getElementById('area-login').style.display = 'none';
  document.getElementById('push-wrap').style.display = 'flex';
  const ua = document.getElementById('area-user'); ua.style.display = 'flex'; ua.style.alignItems = 'center';
  document.getElementById('udisp').textContent = sbUser ? sbUser.email : CREDS.user;
}

async function doLogout() {
  stopPolling();
  if (sbUser) await sb.auth.signOut();
  sbUser = null;
  ST.isLoggedIn = false; save();
  document.getElementById('area-login').style.display = 'flex';
  document.getElementById('push-wrap').style.display = 'none';
  document.getElementById('area-user').style.display = 'none';
  notify('Logged out');
}

function reqAuth(fn) {
  if (ST.isLoggedIn) { fn(); return; }
  authCb = fn; openM('m-login');
}

// ═══════════════════════════════════════════════════════
// MODAL / NOTIF / CTX
// ═══════════════════════════════════════════════════════
function openM(id) { document.getElementById(id).style.display = 'flex'; }
function closeM(id) { document.getElementById(id).style.display = 'none'; }
let _nt;
function notify(msg, type = '') {
  const n = document.getElementById('notif');
  n.textContent = msg; n.className = 'notif show' + (type ? ' ' + type : '');
  clearTimeout(_nt); _nt = setTimeout(() => n.classList.remove('show'), 2800);
}
function showCtx(x, y, items) {
  const m = document.getElementById('ctx'); m.innerHTML = '';
  items.forEach(it => {
    if (it.header) { const d = document.createElement('div'); d.className = 'cx-hdr'; d.textContent = it.header; m.appendChild(d); return; }
    if (it.divider) { const d = document.createElement('div'); d.className = 'cx-div'; m.appendChild(d); return; }
    if (it.prop !== undefined) {
      const d = document.createElement('div'); d.className = 'cx-prop';
      const l = document.createElement('span'); l.className = 'cx-pl'; l.textContent = it.prop;
      const v = document.createElement('span'); v.className = 'cx-pv'; v.textContent = it.val || '—';
      if (it.editFn) { const e = document.createElement('span'); e.className = 'cx-ed'; e.textContent = '✏️'; e.onclick = () => { hideCtx(); it.editFn(); }; v.appendChild(e); }
      d.appendChild(l); d.appendChild(v); m.appendChild(d); return;
    }
    const d = document.createElement('div'); d.className = 'cx-it' + (it.danger ? ' danger' : '');
    d.innerHTML = `<span class="cx-ico">${it.icon || ''}</span>${it.label}`;
    d.onclick = () => { hideCtx(); it.fn(); }; m.appendChild(d);
  });
  m.style.display = 'block';
  const mw = 190, mh = m.scrollHeight;
  m.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
  m.style.top  = Math.min(y, window.innerHeight - mh - 8) + 'px';
}
function hideCtx() { document.getElementById('ctx').style.display = 'none'; }
document.addEventListener('click', e => { if (!document.getElementById('ctx').contains(e.target)) hideCtx(); });

// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// TOP-BAR SYNC BUTTON (next to Push, project/canvas page only)
// ═══════════════════════════════════════════════════════
// Created here so index.html doesn't need to change. It lives inside
// #push-wrap, so it is only available while logged in, exactly like Push.
async function syncFromTopbar() {
  const btn = document.getElementById('sync-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  try { await loadFromCloud(); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '↻ Sync'; } }
}
function addTopbarSyncButton() {
  if (document.getElementById('sync-btn')) return;
  const pushBtn = document.getElementById('push-btn');
  const wrap = document.getElementById('push-wrap');
  if (!pushBtn && !wrap) return; // top bar not in the DOM yet; goPage() will retry
  const b = document.createElement('button');
  b.id = 'sync-btn';
  b.className = 'btn btn-ol btn-sm';
  b.textContent = '↻ Sync';
  b.title = 'Pull the latest pushed version from the cloud';
  b.style.cssText = 'margin-right:6px;min-width:72px;display:' + (currentPage === 'pg-canvas' ? '' : 'none');
  b.onclick = syncFromTopbar;
  if (pushBtn && pushBtn.parentNode) pushBtn.parentNode.insertBefore(b, pushBtn);
  else wrap.insertBefore(b, wrap.firstChild);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addTopbarSyncButton);
else addTopbarSyncButton();

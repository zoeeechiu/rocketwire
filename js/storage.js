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

async function saveToCloud() {
  if (!sbUser || !ST.projects.length) return;
  try {
    for (const proj of ST.projects) {
      const { data: existing } = await sb.from('projects')
        .select('data, updated_at')
        .eq('id', proj.id)
        .single();

      let dataToSave = proj;

      if (existing && existing.data) {
        // On manual publish, merge the current local project with the latest
        // remote row, but do not keep reloading the cloud while the user is
        // still making edits. This preserves the final local draft as the main
        // source of truth for the push.
        dataToSave = mergeProjectData(proj, existing.data);
        const idx = ST.projects.findIndex(p => p.id === proj.id);
        if (idx >= 0) ST.projects[idx] = dataToSave;
      }

      await sb.from('projects').upsert({
        id: proj.id,
        user_id: sbUser.id,
        name: dataToSave.name,
        data: dataToSave,
        updated_at: new Date().toISOString()
      });
    }
  } catch(e) {
    console.warn('Cloud save failed:', e);
  }
}

async function pushChanges() {
  if (!sbUser) {
    if (ST.isLoggedIn) {
      // Signed in locally ("rocketteam" login, or a Supabase session that has
      // expired) but there is no cloud identity, so nothing can be pushed.
      // Calling reqAuth here would just re-invoke pushChanges forever.
      notify('Push needs a Supabase account. Log out, then log in with your email account.', 'err');
    } else {
      notify('Log in to push changes to all devices', 'err');
      reqAuth(pushChanges);
    }
    return;
  }
  if (!ST.projects.length) {
    notify('No projects to push', 'warn');
    return;
  }

  const btn = document.getElementById('push-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Pushing…';
  }

  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: cloudRows, error: selErr } = await sb.from('projects').select('*').eq('user_id', sbUser.id);
      if (selErr) throw selErr;
      const remoteById = new Map((cloudRows || []).map(row => [row.id, row.data]));

      const mergedProjects = ST.projects.map(proj => {
        const remote = remoteById.get(proj.id);
        return remote ? mergeProjectData(proj, remote) : proj;
      });

      for (const row of cloudRows || []) {
        if (!mergedProjects.some(proj => proj.id === row.id)) {
          mergedProjects.push(row.data);
        }
      }

      ST.projects = mergedProjects;
      ST.projects.forEach(baselineFingerprints);
      rebindNavStack();

      const payload = ST.projects.map(proj => ({
        id: proj.id,
        user_id: sbUser.id,
        name: proj.name,
        data: proj,
        updated_at: new Date().toISOString()
      }));

      // .select() returns the rows the database actually wrote. A write that
      // RLS or a key mismatch drops would otherwise look like success.
      const { data: written, error } = await sb.from('projects').upsert(payload).select('id');
      if (error) throw error;
      if (!written || written.length !== payload.length) {
        throw new Error('Cloud saved ' + (written ? written.length : 0) + ' of ' + payload.length + ' projects (check RLS policies)');
      }
      break;
    }

    save();
    notify('Pushed ' + ST.projects.length + ' project(s) as ' + sbUser.email, 'ok');
  } catch (e) {
    console.warn('Manual push failed:', e);
    notify('Push failed: ' + (e && e.message ? e.message : 'unknown error'), 'err');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Push';
    }
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

// mergeProjectData lives in project-sync.js (single, recursive, ID-based merge).

// After ST.projects is replaced by a merge, the live navStack still points at
// the OLD arrays. Re-point every level at the merged objects.
function rebindNavStack() {
  if (!activeProjId || !navStack.length) return;
  const proj = ST.projects.find(p => p.id === activeProjId);
  if (!proj) return;
  Object.assign(navStack[0], {
    systems: proj.systems, connectors: proj.connectors,
    wires: proj.wires, splices: proj.splices || []
  });
  for (let i = 1; i < navStack.length; i++) {
    const sys = (navStack[i-1].systems || []).find(x => x.id === navStack[i].sysId);
    if (!sys) { navStack = navStack.slice(0, i); break; } // subsystem deleted elsewhere
    Object.assign(navStack[i], {
      systems: sys.systems, connectors: sys.connectors,
      wires: sys.wires, splices: sys.splices || [],
      parentSys: sys, parentScope: navStack[i-1]
    });
  }
}

async function loadFromCloud() {
  if (!sbUser) {
    notify('Sync needs a Supabase account. Log out, then log in with your email account.', 'err');
    return;
  }
  try {
    const { data, error } = await sb.from('projects').select('*').eq('user_id', sbUser.id);
    if (error || !data) {
      notify('Sync failed: ' + (error && error.message ? error.message : 'no data returned'), 'err');
      return;
    }
    // Merge cloud state with local state rather than blindly overwriting it.
    // save() debounces the actual cloud upload by ~800ms (plus network round
    // trip), so a poll landing in that window would otherwise see a stale
    // server copy and wipe out whatever edit is still waiting to go out --
    // worst case for a brand-new project, which doesn't exist server-side
    // yet at all and would simply vanish. Merging (local wins per-item,
    // same logic as saveToCloud already uses) means an in-flight local edit
    // is never silently dropped, while genuinely remote changes (e.g. from
    // another device) still come through.
    const cloudProjects = data.map(row => row.data);
    const localById = new Map(ST.projects.map(p => [p.id, p]));
    const merged = [];
    const seen = new Set();
    for (const cloudProj of cloudProjects) {
      const localProj = localById.get(cloudProj.id);
      merged.push(localProj ? mergeProjectData(localProj, cloudProj) : cloudProj);
      seen.add(cloudProj.id);
    }
    for (const localProj of ST.projects) {
      if (!seen.has(localProj.id)) merged.push(localProj); // local-only, not yet uploaded
    }
    ST.projects = merged;
    ST.projects.forEach(baselineFingerprints);
    // Defensive: strip anything tombstoned, in case a stale unmerged row
    // slipped a deleted item back in
    ST.projects.forEach(p => {
      const delSet = new Set((p.deletedIds || []).map(d => d.id));
      if (delSet.size) pruneDeletedTree(p, delSet);
    });
    try { localStorage.setItem('rw3', JSON.stringify(ST)); } catch(e) {}

    // If currently viewing a project canvas, re-point the live scopes at the merged data
    if (activeProjId && currentPage === 'pg-canvas' && navStack.length > 0) {
      rebindNavStack();
      redraw();
    } else {
      renderHome();
    }
    notify('Synced ' + data.length + ' cloud project(s) as ' + sbUser.email, 'ok');
  } catch(e) {
    console.warn('Cloud load failed:', e);
    notify('Sync failed: ' + (e && e.message ? e.message : 'unknown error'), 'err');
  }
}

// ── DIAGNOSTICS (run in the browser console) ──────────────────────────
const RW_SYNC_BUILD = 'sync-2026-09-19b';
console.log('[RocketWire] storage.js loaded, build', RW_SYNC_BUILD);

// rwDebug(): who am I to the cloud, and what does each side think every
// connector's type is (with its edit stamp)?
async function rwDebug() {
  const desc = c => '#' + c.num + ' ' + c.type + ' @' + (c.updatedAt || 0);
  const out = {
    build: RW_SYNC_BUILD,
    loggedInFlag: ST.isLoggedIn,
    supabaseUser: sbUser ? sbUser.email : null,
    supabaseUserId: sbUser ? sbUser.id : null,
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

// rwForcePull(): make this device match the cloud for every project the cloud
// has (cloud wins, no merging). Local-only projects are kept.
async function rwForcePull() {
  if (!sbUser) { notify('Not signed in to Supabase', 'err'); return; }
  const { data, error } = await sb.from('projects').select('*').eq('user_id', sbUser.id);
  if (error || !data) { notify('Pull failed: ' + (error && error.message ? error.message : 'no data'), 'err'); return; }
  const cloudIds = new Set(data.map(r => r.id));
  ST.projects = [...data.map(r => r.data), ...ST.projects.filter(p => !cloudIds.has(p.id))];
  ST.projects.forEach(baselineFingerprints);
  try { localStorage.setItem('rw3', JSON.stringify(ST)); } catch(e) {}
  rebindNavStack();
  if (currentPage === 'pg-canvas') redraw(); else renderHome();
  notify('Replaced local copy with ' + data.length + ' cloud project(s)', 'ok');
}

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
    if (d) { ST.isLoggedIn = !!d.isLoggedIn; ST.projects = d.projects || []; ST.projects.forEach(baselineFingerprints); }
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

  // Try Supabase auth first
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
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

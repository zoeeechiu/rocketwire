// ═══════════════════════════════════════════════════════
// STORAGE — Supabase cloud + localStorage fallback
// ═══════════════════════════════════════════════════════

// Save current project to Supabase (debounced)
let _saveTimer = null;
function save() {
  // Sync navStack data back into ST.projects before saving
  // (ensures wire drag positions, box positions etc are captured)
  if (activeProjId) {
    const proj = ST.projects.find(p => p.id === activeProjId);
    if (proj && navStack.length > 0) {
      const root = navStack[0];
      proj.systems    = root.systems;
      proj.connectors = root.connectors;
      proj.wires      = root.wires;
      proj.splices    = root.splices || [];
    }
  }

  // Always keep localStorage in sync
  try {
    localStorage.setItem('rw3', JSON.stringify(ST));
    if (activeProjId) localStorage.setItem('rw3_proj', activeProjId);
    localStorage.setItem('rw3_page', currentPage);
    localStorage.setItem('rw3_nav', JSON.stringify(
      navStack.map(sc => ({label:sc.label, sysId:sc.sysId||null}))
    ));
  } catch(e) {}

  // Debounce cloud saves — 800ms is fast enough without hammering API
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveToCloud, 800);
}

// Attempt sync on page unload (best-effort)
window.addEventListener('beforeunload', () => {
  if (sbUser && ST.projects.length) {
    const rows = ST.projects.map(proj => ({
      id: proj.id, user_id: sbUser.id,
      name: proj.name, data: proj,
      updated_at: new Date().toISOString()
    }));
    // Use sendBeacon for reliable unload saves
    const payload = JSON.stringify({ rows });
    navigator.sendBeacon &&
      navigator.sendBeacon(
        `${SUPABASE_URL}/rest/v1/projects`,
        new Blob([payload], {type:'application/json'})
      );
    // Also try sync XHR as fallback
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${SUPABASE_URL}/rest/v1/projects?on_conflict=id`, false);
      xhr.setRequestHeader('apikey', SUPABASE_KEY);
      xhr.setRequestHeader('Authorization', `Bearer ${SUPABASE_KEY}`);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Prefer', 'resolution=merge-duplicates');
      xhr.send(JSON.stringify(rows));
    } catch(e) {}
  }
});

async function saveToCloud() {
  if (!sbUser || !ST.projects.length) return;
  try {
    for (const proj of ST.projects) {
      // Fetch current cloud version before saving to detect conflicts
      const { data: existing } = await sb.from('projects')
        .select('data, updated_at')
        .eq('id', proj.id)
        .single();

      let dataToSave = proj;

      if (existing && existing.data) {
        // Merge: combine connectors, systems, wires by ID from both versions
        // so simultaneous edits from two users don't overwrite each other
        dataToSave = mergeProjectData(proj, existing.data);
        // Also update our local copy with the merge result
        const idx = ST.projects.findIndex(p => p.id === proj.id);
        if (idx >= 0) ST.projects[idx] = dataToSave;
        // Hot-reload canvas if open
        if (activeProjId === proj.id && currentPage === 'pg-canvas' && navStack.length > 0) {
          navStack[0].systems    = dataToSave.systems;
          navStack[0].connectors = dataToSave.connectors;
          navStack[0].wires      = dataToSave.wires;
          navStack[0].splices    = dataToSave.splices || [];
          redraw();
        }
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

// Merge two versions of a project — combine arrays by ID, local wins for conflicts,
// and anything tombstoned in either version's deletedIds is removed from both.
function mergeProjectData(local, remote) {
  function mergeById(localArr, remoteArr) {
    const merged = [...(remoteArr || [])];
    for (const localItem of (localArr || [])) {
      const idx = merged.findIndex(r => r.id === localItem.id);
      if (idx >= 0) {
        // Both have it — local wins (user's own edit takes priority)
        merged[idx] = localItem;
      } else {
        // Local has something remote doesn't — add it (new item)
        merged.push(localItem);
      }
    }
    return merged;
  }

  // Union tombstones from both sides, keeping the most recent record per id
  const delMap = new Map();
  [...(remote.deletedIds || []), ...(local.deletedIds || [])].forEach(d => {
    const prev = delMap.get(d.id);
    if (!prev || d.ts > prev.ts) delMap.set(d.id, d);
  });
  const mergedDeletedIds = [...delMap.values()];
  const delSet = new Set(mergedDeletedIds.map(d => d.id));

  const result = {
    ...local,
    systems:    mergeById(local.systems,    remote.systems),
    connectors: mergeById(local.connectors, remote.connectors),
    wires:      mergeById(local.wires,      remote.wires),
    splices:    mergeById(local.splices,    remote.splices),
    deletedIds: mergedDeletedIds,
  };
  pruneDeletedTree(result, delSet);
  return result;
}

async function loadFromCloud() {
  if (!sbUser) return;
  try {
    const { data, error } = await sb.from('projects').select('*').eq('user_id', sbUser.id);
    if (error || !data) return;
    // Replace local projects with cloud state (source of truth)
    ST.projects = data.map(row => row.data);
    // Defensive: strip anything tombstoned, in case a stale unmerged row
    // (e.g. from the beforeunload beacon path) slipped a deleted item back in
    ST.projects.forEach(p => {
      const delSet = new Set((p.deletedIds || []).map(d => d.id));
      if (delSet.size) pruneDeletedTree(p, delSet);
    });
    try { localStorage.setItem('rw3', JSON.stringify(ST)); } catch(e) {}

    // If currently viewing a project canvas, hot-reload the canvas data
    if (activeProjId && currentPage === 'pg-canvas' && navStack.length > 0) {
      const proj = ST.projects.find(p => p.id === activeProjId);
      if (proj) {
        // Update root navStack entry with fresh cloud data
        navStack[0].systems    = proj.systems;
        navStack[0].connectors = proj.connectors;
        navStack[0].wires      = proj.wires;
        navStack[0].splices    = proj.splices || [];
        // Re-resolve subsystem references if deeper in nav
        for (let i = 1; i < navStack.length; i++) {
          const parentScope = navStack[i-1];
          const sys = parentScope.systems.find(s => s.id === navStack[i].sysId);
          if (sys) {
            navStack[i].systems    = sys.systems;
            navStack[i].connectors = sys.connectors;
            navStack[i].wires      = sys.wires;
            navStack[i].splices    = sys.splices || [];
          }
        }
        redraw();
      }
    } else {
      renderHome();
    }
  } catch(e) {
    console.warn('Cloud load failed:', e);
  }
}

// Poll for changes every 30 seconds when logged in
let _pollTimer = null;
function startPolling() {
  if (_pollTimer) return;
  _pollTimer = setInterval(async () => {
    if (sbUser) await loadFromCloud();
  }, 20000);
}
function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem('rw3') || 'null');
    if (d) { ST.isLoggedIn = !!d.isLoggedIn; ST.projects = d.projects || []; }
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
    loadFromCloud();
    startPolling();
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
  const ua = document.getElementById('area-user'); ua.style.display = 'flex'; ua.style.alignItems = 'center';
  document.getElementById('udisp').textContent = sbUser ? sbUser.email : CREDS.user;
}

async function doLogout() {
  stopPolling();
  if (sbUser) await sb.auth.signOut();
  sbUser = null;
  ST.isLoggedIn = false; save();
  document.getElementById('area-login').style.display = 'flex';
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

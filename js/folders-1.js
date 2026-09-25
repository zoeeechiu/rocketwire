// ═══════════════════════════════════════════════════════
// FOLDERS — nested folders on the home page
// ═══════════════════════════════════════════════════════
//
// Data model
//   ST.folders          = [{id, name, parentId|null, updatedAt}]
//   ST.deletedFolderIds = [{id, ts}]   tombstones, so a sync can't resurrect
//   project.folderId    = id of the folder it lives in (absent = Home)
//
// A folder only stores its PARENT. "What's inside folder X" is computed
// (folders whose parentId is X, projects whose folderId is X). So a move is
// a single field change, and there's no children list that can get out of
// sync with the rest.
//
// Cloud sync
//   Projects sync as rows in the Supabase `projects` table. Folders ride in
//   the SAME table as one reserved row per user (id "rw_folders_<userId>"),
//   so there's no new table, SQL or RLS policy to set up. That row is kept in
//   ST.projects as a hidden "project", so storage.js syncs it like any other
//   project. See "Cloud sync" below.
//
// Load order: after storage.js, undo.js and home.js; BEFORE export.js
// (boot() runs there and calls load() / renderHome()).

const FOLDER_ROW_PREFIX = 'rw_folders_';
let currentFolderId = null;         // folder shown on the home page (null = Home)
let folderModal = { mode: 'create', id: null };
let moveTarget  = { kind: 'project', id: null };

if (!ST.folders) ST.folders = [];
if (!ST.deletedFolderIds) ST.deletedFolderIds = [];

// ── Lookups ────────────────────────────────────────────
function folderById(id) { return id ? ST.folders.find(f => f.id === id) || null : null; }

// A parent that no longer exists (e.g. deleted on another device) means Home
function folderParent(f) { return f && f.parentId && folderById(f.parentId) ? f.parentId : null; }

// Same idea for projects: a folderId pointing at a missing folder = Home
function projFolderId(p) { return p && p.folderId && folderById(p.folderId) ? p.folderId : null; }

function isFolderIndexRow(p) {
  return !!p && (p.isFolderIndex || String(p.id || '').startsWith(FOLDER_ROW_PREFIX));
}
function realProjects() { return ST.projects.filter(p => !isFolderIndexRow(p)); }

function childFolders(parentId) {
  return ST.folders
    .filter(f => folderParent(f) === (parentId || null))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
function projectsIn(folderId) {
  return realProjects().filter(p => projFolderId(p) === (folderId || null));
}

// Root → … → folderId, as folder objects. `seen` guards against a cycle,
// which could only come from a bad merge (sanitizeFolders fixes those).
function folderPath(folderId) {
  const out = [], seen = new Set();
  let f = folderById(folderId);
  while (f && !seen.has(f.id)) { seen.add(f.id); out.unshift(f); f = folderById(folderParent(f)); }
  return out;
}
function folderPathLabel(folderId) {
  const p = folderPath(folderId);
  return p.length ? p.map(f => f.name).join(' / ') : 'Home';
}

// The folder plus everything nested under it. Moving a folder into any of
// these would create a loop, so they're excluded as move targets.
function folderSubtree(folderId) {
  const out = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    ST.folders.forEach(f => {
      if (!out.has(f.id) && f.parentId && out.has(f.parentId)) { out.add(f.id); grew = true; }
    });
  }
  return out;
}

function folderCountLabel(folderId) {
  const nf = childFolders(folderId).length, np = projectsIn(folderId).length;
  const parts = [];
  if (nf) parts.push(`${nf} folder${nf === 1 ? '' : 's'}`);
  if (np) parts.push(`${np} project${np === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : 'Empty';
}

// ── Persistence ────────────────────────────────────────
function persistHome() {
  try {
    localStorage.setItem('rw3', JSON.stringify(ST));
    localStorage.setItem('rw3_folder', currentFolderId || '');
  } catch (e) {}
}

// Fix structural problems a merge of two devices' edits could introduce:
// parents that no longer exist, and cycles (A inside B inside A).
function sanitizeFolders() {
  const ids = new Set(ST.folders.map(f => f.id));
  ST.folders.forEach(f => { if (f.parentId && !ids.has(f.parentId)) f.parentId = null; });
  ST.folders.forEach(f => {
    const seen = new Set([f.id]);
    let p = f.parentId;
    while (p) {
      if (seen.has(p)) { f.parentId = null; break; }
      seen.add(p);
      p = folderById(p)?.parentId || null;
    }
  });
  if (currentFolderId && !folderById(currentFolderId)) currentFolderId = null;
}

// Merge another copy of the folder list into ST.folders: per folder, the
// newer updatedAt wins; anything tombstoned after its last edit is removed.
function mergeFoldersInto(remoteFolders, remoteDeleted) {
  const del = new Map();
  [...(ST.deletedFolderIds || []), ...(remoteDeleted || [])].forEach(d => {
    const prev = del.get(d.id);
    if (!prev || d.ts > prev.ts) del.set(d.id, d);
  });
  const byId = new Map(ST.folders.map(f => [f.id, f]));
  (remoteFolders || []).forEach(rf => {
    const lf = byId.get(rf.id);
    if (!lf || Number(rf.updatedAt || 0) > Number(lf.updatedAt || 0)) byId.set(rf.id, { ...rf });
  });
  ST.folders = [...byId.values()].filter(f => {
    const d = del.get(f.id);
    return !d || Number(f.updatedAt || 0) > d.ts;
  });
  ST.deletedFolderIds = [...del.values()];
}

// ── Cloud sync, via storage.js's own sync engine ────────
// The folder tree is stored as a hidden "project" in ST.projects (id
// rw_folders_<userId>, isFolderIndex: true), so Push / Sync / auto-pull on
// login handle it EXACTLY like a real project: same hashing, same "changed
// on this device?" check, same conflict rules. It's never shown as a card
// (realProjects() filters it out).
//
// ST.folders is the working copy the UI edits. The hidden row is its synced
// snapshot:
//   • after any pull  → ingestFolderIndex() merges the row INTO ST.folders
//                        (per folder, newest edit wins; deletes stick)
//   • right before a Push from the home page → stageFolderIndex() writes
//                        ST.folders INTO the row, so it counts as changed and
//                        gets pushed with the projects.
// Between pushes the row stays untouched ("clean"), so a pull can always
// refresh it from the cloud without a conflict prompt, and unpushed local
// folder edits survive because the merge keeps whichever edit is newer.

function folderIndexId() { return sbUser ? FOLDER_ROW_PREFIX + sbUser.id : null; }
function folderIndexRow() {
  const id = folderIndexId();
  return id ? ST.projects.find(p => p.id === id) || null : null;
}

let _lastIngestKey = null;
function ingestFolderIndex() {
  let changed = false;
  if (sbUser) {
    // Folders on this device belong to a DIFFERENT account (someone else
    // logged in here before): don't mix them into this account's tree.
    if (ST.foldersOwner && ST.foldersOwner !== sbUser.id) {
      ST.folders = []; ST.deletedFolderIds = []; currentFolderId = null;
      changed = true;
    }
    if (ST.foldersOwner !== sbUser.id) { ST.foldersOwner = sbUser.id; changed = true; }
    // Hidden rows from another account can't be pushed by this one (RLS),
    // so drop them from this device instead of letting Push fail on them.
    const mine = folderIndexId();
    const stale = ST.projects.filter(p => isFolderIndexRow(p) && p.id !== mine);
    if (stale.length) {
      ST.projects = ST.projects.filter(p => !stale.includes(p));
      const h = ST.syncedHashes || {};
      stale.forEach(p => { delete h[p.id]; });
      changed = true;
    }
  }
  const row = folderIndexRow();
  if (row) {
    // Skip the merge when the row hasn't changed since the last ingest
    // (renderHome calls this on every render).
    const key = JSON.stringify([row.folders, row.deletedFolderIds]);
    if (key !== _lastIngestKey) {
      _lastIngestKey = key;
      const before = JSON.stringify([ST.folders, ST.deletedFolderIds]);
      mergeFoldersInto(row.folders, row.deletedFolderIds);
      if (JSON.stringify([ST.folders, ST.deletedFolderIds]) !== before) changed = true;
    }
  }
  sanitizeFolders();
  if (changed) persistHome();
  return changed;
}

// Copy ST.folders into the hidden row so the next Push uploads it. Creates
// the row the first time this account has any folders.
function stageFolderIndex() {
  if (!sbUser) return;
  let row = folderIndexRow();
  if (!row) {
    if (!ST.folders.length && !ST.deletedFolderIds.length) return; // nothing to sync yet
    const id = folderIndexId();
    // name + empty arrays: a teammate still running old cached code sees this
    // row as a project card; this keeps it harmless if they click it.
    row = { id, name: 'Folder index (refresh RocketWire to hide)', isFolderIndex: true,
            systems: [], connectors: [], wires: [], splices: [] };
    ST.projects.push(row);
  }
  row.folders = JSON.parse(JSON.stringify(ST.folders));
  row.deletedFolderIds = JSON.parse(JSON.stringify(ST.deletedFolderIds));
  _lastIngestKey = JSON.stringify([row.folders, row.deletedFolderIds]);
  persistHome();
}

function homeSearchValue() { return document.getElementById('home-search')?.value || ''; }

// ── Hooks into storage.js (no edits to storage.js needed) ──
// Same technique as undo.js: top-level function declarations are writable
// globals, so every existing caller (autoPull on login / tab focus, the
// top-bar Sync / Sync all button, the old home Sync button, Push) goes
// through these wrappers.

// load(): also restore folders + the folder you were last viewing
const _loadNoFolders = load;
load = function () {
  const r = _loadNoFolders.apply(this, arguments);
  try {
    const d = JSON.parse(localStorage.getItem('rw3') || 'null');
    ST.folders = (d && d.folders) || [];
    ST.deletedFolderIds = (d && d.deletedFolderIds) || [];
    ST.foldersOwner = (d && d.foldersOwner) || null;
    currentFolderId = localStorage.getItem('rw3_folder') || null;
  } catch (e) {}
  return r;
};

// Login (and page load with a saved session): switch the folder tree to THIS
// account right away, then pull its latest pushed state. The automatic pull
// that storage.js fires on sign-in is throttled to one per 3 s, so logging
// out and straight into another account could skip it and leave the
// previous account's view on screen. Calling pullFromCloud() directly here
// avoids that. If a pull is already running, storage.js's busy flag makes
// this one a no-op.
const _applyLoginNoFolders = applyLogin;
applyLogin = function () {
  const r = _applyLoginNoFolders.apply(this, arguments);
  if (sbUser) {
    ingestFolderIndex();
    if (currentPage === 'pg-home') renderHome(homeSearchValue());
    setTimeout(() => pullFromCloud(), 0);
  }
  return r;
};

// Every pull (login, page load, tab re-focus, Sync, Sync all) — this is the
// entry point they all share. storage.js only re-renders the home page when
// a PROJECT changed; re-render after every pull so folder changes show too.
const _pullFromCloudNoFolders = pullFromCloud;
pullFromCloud = async function () {
  const r = await _pullFromCloudNoFolders.apply(this, arguments);
  ingestFolderIndex();
  if (currentPage === 'pg-home') renderHome(homeSearchValue());
  return r;
};

// Push from the home page (Push all): first merge in whatever folder changes
// other devices pushed since our last pull, so we never overwrite them, then
// stage the result so storage.js pushes it along with changed projects. A
// Push from a project page only uploads that one project, so folders are
// left alone there.
const _pushChangesNoFolders = pushChanges;
pushChanges = async function (projId) {
  const pushingAll = typeof projId !== 'string' && currentPage === 'pg-home';
  if (sbUser && pushingAll) {
    try {
      const { data } = await sb.from('projects').select('data').eq('id', folderIndexId()).maybeSingle();
      if (data && data.data) mergeFoldersInto(data.data.folders, data.data.deletedFolderIds);
      sanitizeFolders();
    } catch (e) { console.warn('[RocketWire] could not fetch cloud folders before push:', e); }
    stageFolderIndex();
  }
  const r = await _pushChangesNoFolders.apply(this, arguments);
  if (currentPage === 'pg-home') renderHome(homeSearchValue());
  return r;
};

// ── Navigation ─────────────────────────────────────────
function openFolder(id) {
  currentFolderId = id && folderById(id) ? id : null;
  const s = document.getElementById('home-search');
  if (s) s.value = '';
  persistHome();
  renderHome();
}

// ── <select> of Home + the whole folder tree, indented ──
function fillFolderSelect(sel, selectedId, excludeSet) {
  if (!sel) return;
  sel.innerHTML = '';
  const home = document.createElement('option');
  home.value = ''; home.textContent = '🏠 Home (no folder)';
  sel.appendChild(home);
  const walk = (parentId, depth) => {
    childFolders(parentId).forEach(f => {
      if (excludeSet && excludeSet.has(f.id)) return; // also skips its subtree
      const o = document.createElement('option');
      o.value = f.id;
      o.textContent = '    '.repeat(depth) + '📁 ' + f.name;
      sel.appendChild(o);
      walk(f.id, depth + 1);
    });
  };
  walk(null, 0);
  sel.value = selectedId && [...sel.options].some(o => o.value === selectedId) ? selectedId : '';
}

// ── Create / rename folder ─────────────────────────────
function openNewFolder() {
  folderModal = { mode: 'create', id: null };
  document.getElementById('mf-title').textContent = 'New folder';
  document.getElementById('mf-ok').textContent = 'Create';
  document.getElementById('mf-name').value = '';
  document.getElementById('mf-loc-wrap').style.display = 'block';
  fillFolderSelect(document.getElementById('mf-loc'), currentFolderId);
  openM('m-folder');
  setTimeout(() => document.getElementById('mf-name').focus(), 0);
}

function openRenameFolder(id) {
  const f = folderById(id); if (!f) return;
  folderModal = { mode: 'rename', id };
  document.getElementById('mf-title').textContent = 'Rename folder';
  document.getElementById('mf-ok').textContent = 'Rename';
  const nameEl = document.getElementById('mf-name');
  nameEl.value = f.name;
  document.getElementById('mf-loc-wrap').style.display = 'none';
  openM('m-folder');
  setTimeout(() => { nameEl.focus(); nameEl.select(); }, 0);
}

function doFolderModal() {
  if (!ST.isLoggedIn) { reqAuth(doFolderModal); return; }
  const name = document.getElementById('mf-name').value.trim();
  if (!name) { notify('Enter a folder name', 'err'); return; }
  if (folderModal.mode === 'rename') {
    const f = folderById(folderModal.id);
    if (f) { f.name = name; f.updatedAt = Date.now(); }
    notify('Folder renamed', 'ok');
  } else {
    const parentId = document.getElementById('mf-loc').value || null;
    ST.folders.push({ id: 'f' + Date.now(), name, parentId, updatedAt: Date.now() });
    currentFolderId = parentId; // show the folder where it was created
    notify('Folder created', 'ok');
  }
  closeM('m-folder');
  persistHome();
  renderHome();
}

// ── Move (projects and folders) ────────────────────────
function openMove(kind, id) {
  const item = kind === 'folder' ? folderById(id) : ST.projects.find(p => p.id === id);
  if (!item) return;
  moveTarget = { kind, id };
  document.getElementById('mv-title').textContent = `Move "${item.name}"`;
  const cur = kind === 'folder' ? folderParent(item) : projFolderId(item);
  fillFolderSelect(document.getElementById('mv-dest'), cur,
    kind === 'folder' ? folderSubtree(id) : null);
  openM('m-move');
}

function doMove() {
  if (!ST.isLoggedIn) { reqAuth(doMove); return; }
  const dest = document.getElementById('mv-dest').value || null;
  if (moveTarget.kind === 'folder') {
    const f = folderById(moveTarget.id);
    if (!f) { closeM('m-move'); return; }
    if (dest && folderSubtree(f.id).has(dest)) { notify("Can't move a folder into itself", 'err'); return; }
    f.parentId = dest; f.updatedAt = Date.now();
  } else {
    const p = ST.projects.find(x => x.id === moveTarget.id);
    if (!p) { closeM('m-move'); return; }
    if (dest) p.folderId = dest; else delete p.folderId;
    touchUpdated(p); // newer stamp → this folderId wins the merge on Push
  }
  closeM('m-move');
  persistHome();
  renderHome(homeSearchValue());
  notify(`Moved to ${dest ? folderById(dest).name : 'Home'}`, 'ok');
}

// ── Delete folder: contents move up to its parent, nothing is lost ──
function deleteFolder(id) {
  const f = folderById(id); if (!f) return;
  const parent = folderParent(f);
  const nf = childFolders(id).length, np = projectsIn(id).length;
  const dest = parent ? `"${folderById(parent).name}"` : 'Home';
  const msg = (nf || np)
    ? `Delete folder "${f.name}"?\n\nIts contents (${folderCountLabel(id)}) will be moved to ${dest}. No projects are deleted.`
    : `Delete folder "${f.name}"?`;
  if (!confirm(msg)) return;
  const now = Date.now();
  ST.folders.forEach(c => { if (folderParent(c) === id) { c.parentId = parent; c.updatedAt = now; } });
  ST.projects.forEach(p => {
    if (!isFolderIndexRow(p) && projFolderId(p) === id) {
      if (parent) p.folderId = parent; else delete p.folderId;
      touchUpdated(p);
    }
  });
  ST.folders = ST.folders.filter(x => x.id !== id);
  ST.deletedFolderIds.push({ id, ts: now });
  // Subfolders were re-parented, not deleted, so only the folder itself can
  // disappear from under the current view.
  if (currentFolderId === id) currentFolderId = parent;
  persistHome();
  renderHome();
  notify('Folder deleted');
}

function showFolderMenu(x, y, id) {
  showCtx(x, y, [
    { label: 'Open', icon: '📂', fn: () => openFolder(id) },
    { label: 'Rename', icon: '✏️', fn: () => reqAuth(() => openRenameFolder(id)) },
    { label: 'Move to…', icon: '➡️', fn: () => reqAuth(() => openMove('folder', id)) },
    { divider: true },
    { label: 'Delete folder', icon: '🗑', danger: true, fn: () => reqAuth(() => deleteFolder(id)) },
  ]);
}

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
//   so there's no new table, SQL or RLS policy to set up. Pull (Sync) and
//   Push both fetch every row for the user, so that row comes along
//   automatically. absorbFolderIndex() then lifts it out of ST.projects into
//   ST.folders before anything renders it as a project.
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

// Pull the reserved folder row(s) out of ST.projects into ST.folders.
function absorbFolderIndex() {
  const rows = ST.projects.filter(isFolderIndexRow);
  if (rows.length) {
    ST.projects = ST.projects.filter(p => !isFolderIndexRow(p));
    rows.forEach(r => mergeFoldersInto(r.folders, r.deletedFolderIds));
  }
  sanitizeFolders();
  persistHome();
  return rows.length > 0;
}

async function pushFolderIndex() {
  if (!sbUser) return;
  const id = FOLDER_ROW_PREFIX + sbUser.id;
  const name = 'Folder index (refresh RocketWire to hide)';
  // name + empty arrays: a teammate still running old cached code sees this
  // row as a project card; this keeps it harmless if they click it.
  const data = {
    id, name, isFolderIndex: true,
    folders: ST.folders, deletedFolderIds: ST.deletedFolderIds,
    systems: [], connectors: [], wires: [], splices: [],
    updatedAt: Date.now()
  };
  const { error } = await sb.from('projects').upsert({
    id, user_id: sbUser.id, name, data, updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

function homeSearchValue() { return document.getElementById('home-search')?.value || ''; }

// ── Hooks into storage.js (no edits to storage.js needed) ──
// Same technique as undo.js: top-level function declarations are writable
// globals, so every existing caller goes through these wrappers.

// load(): also restore folders + the folder you were last viewing
const _loadNoFolders = load;
load = function () {
  const r = _loadNoFolders.apply(this, arguments);
  try {
    const d = JSON.parse(localStorage.getItem('rw3') || 'null');
    ST.folders = (d && d.folders) || [];
    ST.deletedFolderIds = (d && d.deletedFolderIds) || [];
    currentFolderId = localStorage.getItem('rw3_folder') || null;
  } catch (e) {}
  absorbFolderIndex();
  return r;
};

// Sync (pull): merge the cloud folder tree in
const _loadFromCloudNoFolders = loadFromCloud;
loadFromCloud = async function () {
  const r = await _loadFromCloudNoFolders.apply(this, arguments);
  absorbFolderIndex();
  if (currentPage === 'pg-home') renderHome(homeSearchValue());
  return r;
};

// Push: after the projects are pushed (that fetch also pulled the latest
// cloud folder row, absorbed below), publish the merged folder tree.
const _pushChangesNoFolders = pushChanges;
pushChanges = async function () {
  const r = await _pushChangesNoFolders.apply(this, arguments);
  if (sbUser) {
    absorbFolderIndex();
    try { await pushFolderIndex(); }
    catch (e) { console.warn('Folder push failed:', e); notify('Folders failed to push — try again', 'err'); }
    if (currentPage === 'pg-home') renderHome(homeSearchValue());
  }
  return r;
};

// mergeProjectData() builds its result as {...local, ...remote, …}, so for
// top-level fields the REMOTE copy always wins. For folderId that would undo
// a move the moment you pressed Push. Instead, take folderId from whichever
// copy was edited more recently.
const _mergeProjectDataNoFolders = mergeProjectData;
mergeProjectData = function (local, remote) {
  const r = _mergeProjectDataNoFolders.apply(this, arguments);
  if (!local || !remote || !r) return r;
  const ls = Number(local.updatedAt || local.updated_at || 0);
  const rs = Number(remote.updatedAt || remote.updated_at || remote.__remoteUpdatedAt || 0);
  const src = ls >= rs ? local : remote;
  if (src.folderId) r.folderId = src.folderId; else delete r.folderId;
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
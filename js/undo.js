// ═══════════════════════════════════════════════════════
// UNDO / REDO  (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Ctrl+Y)
// ═══════════════════════════════════════════════════════
//
// How it works — snapshot history, not per-action inverse functions:
//
//   Every edit in the app (delete, drag, rename, add, splice, connector
//   save…) already ends with a call to save(). So save() is the single
//   "commit point" for a change. We wrap save() so that, after it runs, we
//   serialize the active project's data and compare it to the last
//   snapshot. If it changed, the old snapshot goes on the undo stack.
//
//       undoStack: [s0, s1]   current: s2   redoStack: []
//       Cmd+Z  →   undoStack: [s0]  current: s1  redoStack: [s2]
//
//   Undo restores the previous snapshot into the project and rebuilds
//   navStack so the canvas (and any subsystem you're inside) points at the
//   restored objects.
//
// Why snapshots: a new kind of edit gets undo for free as long as it calls
// save(), with no inverse function to write for each action.
//
// Timestamps (updatedAt etc.) are left out of snapshots, because
// touchProjectTree() re-stamps everything on every save and would make
// every snapshot look "different" even when nothing changed (e.g. a pan).
//
// deletedIds (tombstones) ARE part of the snapshot, so undoing a delete
// also removes its tombstone; otherwise the next merge would prune the
// restored items right back out.
//
// Load order: this file must come AFTER storage.js (it wraps save/goPage).

const UNDO_LIMIT = 100;
const HIST = { projId: null, undo: [], redo: [], current: null };
let _restoring = false;

const _STAMP_KEYS = new Set(['updatedAt', 'updated_at', '__remoteUpdatedAt', '_remoteUpdatedAt']);

function snapProject(proj) {
  if (!proj) return null;
  return JSON.stringify({
    systems:    proj.systems    || [],
    connectors: proj.connectors || [],
    wires:      proj.wires      || [],
    splices:    proj.splices    || [],
    deletedIds: proj.deletedIds || [],
  }, (k, v) => (_STAMP_KEYS.has(k) ? undefined : v));
}

function activeProj() {
  return activeProjId ? ST.projects.find(p => p.id === activeProjId) : null;
}

// Start a fresh history when a (different) project is opened.
function ensureHistory() {
  const proj = activeProj();
  if (!proj) return;
  if (HIST.projId === proj.id && HIST.current !== null) return;
  HIST.projId = proj.id;
  HIST.undo = [];
  HIST.redo = [];
  HIST.current = snapProject(proj);
}

// Called after every save(): record a history step if the data changed.
function recordHistory() {
  if (_restoring) return;
  const proj = activeProj();
  if (!proj) return;
  if (HIST.projId !== proj.id) { ensureHistory(); return; }
  const s = snapProject(proj);
  if (s === HIST.current) return;          // nothing changed (pan, enter subsystem…)
  HIST.undo.push(HIST.current);
  if (HIST.undo.length > UNDO_LIMIT) HIST.undo.shift();
  HIST.current = s;
  HIST.redo = [];                          // a new edit invalidates redo
}

// Point navStack at the freshly restored objects. Same idea as the
// hot-reload in loadFromCloud(), but it also fixes parentSys/parentScope,
// because save() writes each scope back through parentSys.
function rebuildNavStack(proj) {
  if (!navStack.length) return;
  const root = navStack[0];
  root.systems    = proj.systems;
  root.connectors = proj.connectors;
  root.wires      = proj.wires;
  root.splices    = proj.splices || [];
  for (let i = 1; i < navStack.length; i++) {
    const parentScope = navStack[i - 1];
    const sys = (parentScope.systems || []).find(s => s.id === navStack[i].sysId);
    if (!sys) { navStack = navStack.slice(0, i); break; } // subsystem no longer exists
    if (!sys.systems)    sys.systems = [];
    if (!sys.connectors) sys.connectors = [];
    if (!sys.wires)      sys.wires = [];
    if (!sys.splices)    sys.splices = [];
    Object.assign(navStack[i], {
      label: sys.name,
      systems: sys.systems, connectors: sys.connectors,
      wires: sys.wires, splices: sys.splices,
      parentSys: sys, parentScope,
    });
  }
}

function applySnapshot(snap) {
  const proj = activeProj();
  if (!proj || !snap) return;
  const d = JSON.parse(snap);
  proj.systems    = d.systems;
  proj.connectors = d.connectors;
  proj.wires      = d.wires;
  proj.splices    = d.splices;
  proj.deletedIds = d.deletedIds;
  rebuildNavStack(proj);
  _restoring = true;
  try { save(); } finally { _restoring = false; } // persist + fresh timestamps
  if (currentPage === 'pg-canvas') {
    const hint = document.getElementById('empty-hint');
    const sc = scope();
    if (hint) hint.style.display = (sc && sc.systems.length) ? 'none' : 'flex';
    redraw();
  }
  buildBC(currentPage);
}

function undo() {
  ensureHistory();
  if (!HIST.undo.length) { notify('Nothing to undo'); return; }
  HIST.redo.push(HIST.current);
  HIST.current = HIST.undo.pop();
  applySnapshot(HIST.current);
  notify('Undo');
}

function redo() {
  ensureHistory();
  if (!HIST.redo.length) { notify('Nothing to redo'); return; }
  HIST.undo.push(HIST.current);
  HIST.current = HIST.redo.pop();
  applySnapshot(HIST.current);
  notify('Redo');
}

// ── Hook into existing functions (no edits to storage.js needed) ──
// Function declarations are writable globals, so every existing call to
// save()/goPage() from any file now goes through these wrappers.
const _saveNoHistory = save;
save = function () {
  const r = _saveNoHistory.apply(this, arguments);
  recordHistory();
  return r;
};
const _goPageNoHistory = goPage;
goPage = function (id) {
  const r = _goPageNoHistory.apply(this, arguments);
  if (activeProjId) ensureHistory();
  return r;
};

// ── Keyboard shortcut ──
document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  const isUndo = k === 'z' && !e.shiftKey;
  const isRedo = (k === 'z' && e.shiftKey) || (k === 'y' && e.ctrlKey);
  if (!isUndo && !isRedo) return;

  // Let text fields keep their own native undo
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;

  // Only on the canvas: the connector/splice pages edit a draft copy, so
  // swapping the data underneath them mid-edit would be confusing.
  if (currentPage !== 'pg-canvas') return;
  if (drag && drag.on) return;             // not mid-drag
  if (!ST.isLoggedIn) return;              // editing requires login

  e.preventDefault();
  hideCtx();
  isUndo ? undo() : redo();
});
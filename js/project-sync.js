// Single source of truth for merging a local project with its cloud copy.
// Recursive and ID-based at every level (systems -> connectors/wires/splices
// -> nested systems ...), so items inside subsystems merge correctly too.
//
// Rules:
//  - Per item, the newer `updatedAt` wins as a whole; ties go to local.
//  - Local order is the base for every list (connector position along a box
//    edge is driven by array order); items only the remote has are appended.
//  - Anything tombstoned in either side's deletedIds is dropped.
(function(global) {
  const CHILD_KEYS = ['systems', 'connectors', 'wires', 'splices'];

  function getStamp(x) {
    return x ? Math.max(Number(x.updatedAt) || 0, Number(x.updated_at) || 0) : 0;
  }

  function mergeNode(local, remote, delSet) {
    const out = getStamp(remote) > getStamp(local)
      ? { ...local, ...remote }
      : { ...remote, ...local };
    CHILD_KEYS.forEach(k => {
      if (local[k] || remote[k]) out[k] = mergeList(local[k], remote[k], delSet);
    });
    return out;
  }

  function mergeList(localArr, remoteArr, delSet) {
    const remoteMap = new Map((remoteArr || []).map(x => [x.id, x]));
    const seen = new Set();
    const out = [];
    for (const li of (localArr || [])) {
      seen.add(li.id);
      if (delSet.has(li.id)) continue;
      const ri = remoteMap.get(li.id);
      out.push(ri ? mergeNode(li, ri, delSet) : li);
    }
    for (const ri of (remoteArr || [])) {
      if (!seen.has(ri.id) && !delSet.has(ri.id)) out.push(ri);
    }
    return out;
  }

  function mergeProjectData(local, remote) {
    if (!local) return remote || null;
    if (!remote) return local;
    const del = new Map();
    [...(remote.deletedIds || []), ...(local.deletedIds || [])].forEach(d => {
      const p = del.get(d.id);
      if (!p || d.ts > p.ts) del.set(d.id, d);
    });
    const out = mergeNode(local, remote, new Set(del.keys()));
    out.deletedIds = [...del.values()];
    delete out.__remoteUpdatedAt;
    return out;
  }

  global.mergeProjectData = mergeProjectData;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { mergeProjectData };
  }
})(typeof window !== 'undefined' ? window : globalThis);

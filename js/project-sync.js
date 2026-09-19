(function(global) {
  function mergeById(localArr, remoteArr) {
    const merged = [...(localArr || [])];
    const localIds = new Set(merged.map(x => x.id));
    for (const remoteItem of (remoteArr || [])) {
      if (!localIds.has(remoteItem.id)) merged.push(remoteItem);
    }
    return merged;
  }

  function pruneDeletedTree(node, delSet) {
    if (!node || !delSet.size) return;
    node.systems = (node.systems || []).filter(s => !delSet.has(s.id));
    node.connectors = (node.connectors || []).filter(c => !delSet.has(c.id));
    node.wires = (node.wires || []).filter(w => !delSet.has(w.id));
    node.splices = (node.splices || []).filter(s => !delSet.has(s.id));
    node.systems.forEach(sys => pruneDeletedTree(sys, delSet));
  }

  function mergeProjectData(local, remote) {
    if (!local) return remote || null;
    if (!remote) return local;

    const delMap = new Map();
    [...(remote.deletedIds || []), ...(local.deletedIds || [])].forEach(d => {
      const prev = delMap.get(d.id);
      if (!prev || d.ts > prev.ts) delMap.set(d.id, d);
    });
    const mergedDeletedIds = [...delMap.values()];
    const delSet = new Set(mergedDeletedIds.map(d => d.id));

    const result = {
      ...local,
      systems: mergeById(local.systems, remote.systems),
      connectors: mergeById(local.connectors, remote.connectors),
      wires: mergeById(local.wires, remote.wires),
      splices: mergeById(local.splices, remote.splices),
      deletedIds: mergedDeletedIds
    };

    pruneDeletedTree(result, delSet);
    return result;
  }

  global.mergeProjectData = mergeProjectData;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { mergeProjectData };
  }
})(typeof window !== 'undefined' ? window : globalThis);

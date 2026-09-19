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

  function getStamp(item) {
    if (!item) return 0;
    const vals = [item.updatedAt, item.updated_at, item.__remoteUpdatedAt, item._remoteUpdatedAt];
    const nums = vals.filter(v => v !== undefined && v !== null && !Number.isNaN(Number(v))).map(v => Number(v));
    return nums.length ? Math.max(...nums) : 0;
  }

  function mergeItemValues(localItem, remoteItem) {
    const result = { ...localItem, ...remoteItem };
    for (const key of new Set([...Object.keys(localItem || {}), ...Object.keys(remoteItem || {})])) {
      const lv = localItem?.[key];
      const rv = remoteItem?.[key];
      if (Array.isArray(lv) && Array.isArray(rv)) {
        const merged = Array.from({ length: Math.max(lv.length, rv.length) }, (_, i) => {
          const a = lv[i];
          const b = rv[i];
          if (a === undefined || a === null || a === '') return b ?? a;
          if (b === undefined || b === null || b === '') return a;
          if (a !== b) {
            const aFilled = String(a ?? '').trim().length;
            const bFilled = String(b ?? '').trim().length;
            return bFilled > aFilled ? b : a;
          }
          return a;
        });
        result[key] = merged;
      } else if (lv && rv && typeof lv === 'object' && !Array.isArray(lv) && typeof rv === 'object' && !Array.isArray(rv)) {
        result[key] = mergeItemValues(lv, rv);
      }
    }
    return result;
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
    const localProjectStamp = Number(local.updatedAt || local.updated_at || 0);
    const remoteProjectStamp = Number(remote.updatedAt || remote.updated_at || remote.__remoteUpdatedAt || 0);
    const projectPrefersLocal = localProjectStamp >= remoteProjectStamp;

    function mergeById(localArr, remoteArr) {
      const merged = [...(localArr || [])];
      const localMap = new Map((localArr || []).map(x => [x.id, x]));
      const remoteMap = new Map((remoteArr || []).map(x => [x.id, x]));
      const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);
      for (const id of allIds) {
        const localItem = localMap.get(id);
        const remoteItem = remoteMap.get(id);
        if (!localItem && remoteItem) { merged.push(remoteItem); continue; }
        if (!remoteItem) continue;
        const idx = merged.findIndex(item => item && item.id === id);
        const localStamp = getStamp(localItem);
        const remoteStamp = getStamp(remoteItem);
        if (remoteStamp > localStamp) {
          if (idx >= 0) merged[idx] = remoteItem;
          else merged.push(remoteItem);
        } else if (remoteStamp < localStamp) {
          continue;
        } else if (idx >= 0) {
          merged[idx] = projectPrefersLocal ? { ...localItem, ...mergeItemValues(localItem, remoteItem) } : mergeItemValues(localItem, remoteItem);
        }
      }
      return merged;
    }

    const result = {
      ...local,
      ...remote,
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

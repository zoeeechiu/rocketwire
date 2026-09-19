const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeProjectData } = require('../js/project-sync.js');

test('mergeProjectData keeps local changes and appends remote-only items', () => {
  const local = {
    id: 'p1',
    name: 'Local Project',
    systems: [{ id: 's1', name: 'Local Box', systems: [], connectors: [], wires: [], splices: [] }],
    connectors: [{ id: 'c1', systemId: 's1', type: 'XT60', pins: 2, channels: ['V+', 'GND'], colors: ['red', 'black'] }],
    wires: [],
    splices: [],
    deletedIds: []
  };

  const remote = {
    id: 'p1',
    name: 'Remote Project',
    systems: [
      { id: 's1', name: 'Local Box', systems: [], connectors: [], wires: [], splices: [] },
      { id: 's2', name: 'Remote Box', systems: [], connectors: [], wires: [], splices: [] }
    ],
    connectors: [
      { id: 'c1', systemId: 's1', type: 'XT60', pins: 2, channels: ['V+', 'GND'], colors: ['red', 'black'] },
      { id: 'c2', systemId: 's2', type: 'Molex', pins: 4, channels: ['A', 'B', 'C', 'D'], colors: ['red', 'blue', 'green', 'black'] }
    ],
    wires: [{ id: 'w1', fromConn: 'c1', toConn: 'c2', length: 10 }],
    splices: [],
    deletedIds: []
  };

  const merged = mergeProjectData(local, remote);

  assert.equal(merged.systems.length, 2);
  assert.deepEqual(
    merged.systems.map(s => s.id).sort(),
    ['s1', 's2']
  );
  assert.equal(merged.connectors.length, 2);
  assert.equal(merged.wires.length, 1);
  assert.equal(merged.name, 'Local Project');
});

test('mergeProjectData preserves local edits when ids match', () => {
  const local = {
    id: 'p2',
    name: 'Local',
    systems: [{ id: 's1', name: 'Local changed', systems: [], connectors: [], wires: [], splices: [] }],
    connectors: [],
    wires: [],
    splices: [],
    deletedIds: []
  };

  const remote = {
    id: 'p2',
    name: 'Remote',
    systems: [{ id: 's1', name: 'Remote changed', systems: [], connectors: [], wires: [], splices: [] }],
    connectors: [],
    wires: [],
    splices: [],
    deletedIds: []
  };

  const merged = mergeProjectData(local, remote);
  assert.equal(merged.systems[0].name, 'Local changed');
});

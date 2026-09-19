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

test('mergeProjectData keeps the newest connector type and pin count when timestamps match', () => {
  const local = {
    id: 'p3',
    name: 'Local',
    systems: [],
    connectors: [{ id: 'c1', systemId: 's1', type: 'DSUB-15', pins: 15, channels: ['A', 'B', 'C'], colors: ['red', 'black', 'blue'], updatedAt: 100 }],
    wires: [],
    splices: [],
    deletedIds: [],
    updatedAt: 100
  };

  const remote = {
    id: 'p3',
    name: 'Remote',
    systems: [],
    connectors: [{ id: 'c1', systemId: 's1', type: 'Amphenol 9-35', pins: 6, channels: ['GND', 'PWR'], colors: ['black', 'red'], updatedAt: 100 }],
    wires: [],
    splices: [],
    deletedIds: [],
    updatedAt: 100
  };

  const merged = mergeProjectData(local, remote);
  assert.equal(merged.connectors[0].type, 'DSUB-15');
  assert.equal(merged.connectors[0].pins, 15);
});

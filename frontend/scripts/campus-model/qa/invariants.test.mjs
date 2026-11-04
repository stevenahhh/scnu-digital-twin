import assert from 'node:assert/strict';
import test from 'node:test';
import { wallsOf } from '../lib/anchors.mjs';
import { assertBuildInvariants, BuildInvariantError } from './invariants.mjs';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
function fixture() {
  const footprint = { polygons: [[rect(0, 0, 10, 10)]] };
  footprint.walls = wallsOf('BLD_A', footprint);
  return {
    groundFootprints: [{ id: 'BLD_A', actualParts: [rect(0, 0, 10, 10)], expectedParts: [rect(0, 0, 10, 10)] }],
    anchors: [{ id: 'door-A', anchor: { building: 'BLD_A', wall: 'W00', sM: 2 }, estimated: true }],
    footprints: { BLD_A: footprint },
    evidenceRecords: [{ id: 'paint-A', estimated: false, evidence: { tier: 'T1', refs: ['ortho:2025/chip-A'] } }],
    parcels: [
      { id: 'road', ring: rect(-5, -5, 5, 5), holes: [], precedence: 1, paintAllowed: true },
      { id: 'lawn', ring: rect(5, -5, 10, 5), holes: [], precedence: 1, paintAllowed: false },
    ],
    paintPieces: [{ id: 'paint-A', triangles: [[[0, 0], [1, 0], [0, 1]]] }],
    packApplications: [{ id: 'BLD_A/W00', requested: ['wall', 'edge'], applied: ['wall', 'edge'] }],
    determinism: { id: 'raw', firstHash: 'same-raw', secondHash: 'same-raw' },
  };
}

test('valid production-boundary fixture passes without changing its inputs', () => {
  const input = fixture();
  const before = structuredClone(input);
  const report = assertBuildInvariants(input);
  assert.equal(report.pass, true);
  assert.equal(report.checked, 6);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(input, before);
});

const cases = [
  ['ground footprint shifted 0.051 m', 'BLD_A', 'groundFootprint', f => {
    f.groundFootprints[0].actualParts = [rect(0.051, 0, 10.051, 10)];
  }],
  ['missing snapshot', 'door-A', 'anchor', f => { delete f.footprints.BLD_A.walls; }],
  ['stale snapshot', 'door-A', 'anchor', f => { f.footprints.BLD_A.walls[0].A[0] += 1; }],
  ['anchor outside wall', 'door-A', 'anchor', f => { f.anchors[0].anchor.sM = 10.001; }],
  ['T3 claimed measured', 'paint-A', 'evidence', f => { f.evidenceRecords[0].evidence.tier = 'T3'; }],
  ['empty refs claimed measured', 'paint-A', 'evidence', f => { f.evidenceRecords[0].evidence.refs = []; }],
  ['blank ref claimed measured', 'paint-A', 'evidence', f => { f.evidenceRecords[0].evidence.refs = [' ']; }],
  ['paint on lawn', 'paint-A', 'paint', f => { f.paintPieces[0].triangles = [[[6, 0], [7, 0], [6, 1]]]; }],
  ['road centre but lawn end', 'paint-A', 'paint', f => { f.paintPieces[0].triangles = [[[0, 0], [6, 0], [0, 1]]]; }],
  ['lawn island inside paint with all vertices on road', 'paint-A', 'paint', f => {
    f.parcels.push({ id: 'island', ring: rect(0.2, 0.2, 0.3, 0.3), holes: [], precedence: 2, paintAllowed: false });
  }],
  ['parcel hole inside paint', 'paint-A', 'paint', f => { f.parcels[0].holes = [rect(0.2, 0.2, 0.3, 0.3)]; }],
  ['missing packed edge application', 'BLD_A/W00', 'packApplication', f => { f.packApplications[0].applied = ['wall']; }],
  ['different second raw hash', 'raw', 'determinism', f => { f.determinism.secondHash = 'different'; }],
  ['missing emitted geometry', 'paint-A', 'paint', f => { f.paintPieces[0].triangles = []; }],
  ['zero area emitted triangle', 'paint-A', 'paint', f => { f.paintPieces[0].triangles = [[[0, 0], [1, 0], [2, 0]]]; }],
];
for (const [name, id, check, mutate] of cases) {
  test(`rejects ${name} with the original id`, () => {
    const input = fixture();
    mutate(input);
    assert.throws(() => assertBuildInvariants(input), error => {
      assert.ok(error instanceof BuildInvariantError);
      assert.equal(error.report.pass, false);
      assert.deepEqual(error.report.findings.map(f => [f.id, f.check]), [[id, check]]);
      assert.ok(error.message.includes(id));
      return true;
    });
  });
}

test('adjacent allowed parcels cover a triangle crossing their shared boundary', () => {
  const input = fixture();
  input.parcels[1].paintAllowed = true;
  input.paintPieces[0].triangles = [[[0, 0], [6, 0], [0, 1]]];
  assert.equal(assertBuildInvariants(input).pass, true);
});

test('higher precedence road covers a lower precedence lawn island', () => {
  const input = fixture();
  input.parcels.push({ id: 'island', ring: rect(0.2, 0.2, 0.3, 0.3), holes: [], precedence: 0, paintAllowed: false });
  assert.equal(assertBuildInvariants(input).pass, true);
});

test('ground check uses the combined split footprint instead of the mass bbox', () => {
  const input = fixture();
  input.groundFootprints[0].actualParts = [rect(0, 0, 4, 10), rect(6, 0, 10, 10)];
  input.groundFootprints[0].massBbox = [0, 0, 30, 30];
  assert.equal(assertBuildInvariants(input).pass, true);
});

test('returns every failing original id in one error report', () => {
  const input = fixture();
  delete input.footprints.BLD_A.walls;
  input.determinism.secondHash = 'different';
  assert.throws(() => assertBuildInvariants(input), error => {
    assert.deepEqual(error.report.findings.map(f => f.id), ['door-A', 'raw']);
    return true;
  });
});

test('small lawn island at campus TM coordinates cannot disappear through cancellation', () => {
  const input = fixture();
  const translate = ([x, y]) => [x + 243000, y + 263000];
  input.parcels.push({ id: 'island', ring: rect(0.2, 0.2, 0.201, 0.201), holes: [], precedence: 2, paintAllowed: false });
  input.parcels = input.parcels.map(p => ({ ...p, ring: p.ring.map(translate) }));
  input.paintPieces[0].triangles = input.paintPieces[0].triangles.map(t => t.map(translate));
  assert.throws(() => assertBuildInvariants(input), error =>
    error instanceof BuildInvariantError && error.report.findings.some(f => f.id === 'paint-A' && f.check === 'paint'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { finalPaintReceipt, PaintReceiptError } from './paintReceipt.mjs';
import { assertBuildInvariants, BuildInvariantError } from './invariants.mjs';

test('a simplified face spanning two pieces retains both contributing source IDs', () => {
  const positions = Float32Array.from([0, 0, 0, 2, 0, 0, 2, 0, 2, 0, 0, 2]);
  const receipt = finalPaintReceipt({
    primitive: { positions, indices: [0, 3, 1, 1, 3, 2] },
    sourcePositions: positions,
    sourcePieces: [{ id: 'a', faces: [[0, 1, 2]] }, { id: 'b', faces: [[0, 2, 3]] }],
  });
  const triangles = [[[0, 0], [0, 2], [2, 0]], [[2, 0], [0, 2], [2, 2]]];
  assert.deepEqual(receipt, [{ id: 'a', triangles }, { id: 'b', triangles }]);
});

test('a degenerate final face reaches the invariant with its source ID', () => {
  const positions = Float32Array.from([0, 0, 0, 2, 0, 0, 2, 0, 2]);
  const paintPieces = finalPaintReceipt({
    primitive: { positions, indices: [0, 1, 1] }, sourcePositions: positions,
    sourcePieces: [{ id: 'collapsed', faces: [[0, 1, 2]] }],
  });
  assert.throws(() => assertBuildInvariants({
    groundFootprints: [], anchors: [], footprints: {}, evidenceRecords: [], parcels: [],
    paintPieces, packApplications: [], determinism: { id: 'raw', firstHash: 'same', secondHash: 'same' },
  }), error => error instanceof BuildInvariantError && error.report.findings.length === 1 &&
    error.report.findings[0].id === 'collapsed' && error.report.findings[0].reason.includes('malformed'));
});

test('a final face without source provenance fails rather than being omitted', () => {
  assert.throws(() => finalPaintReceipt({
    primitive: { positions: Float32Array.from([0, 0, 0, 2, 0, 0, 2, 0, 2]), indices: [0, 1, 2] },
    sourcePositions: new Float32Array(), sourcePieces: [],
  }), PaintReceiptError);
});

test('a collapsed Float32 boundary face retains the common provenance of its three surviving vertices', () => {
  // Captured from the real build: decimation joins three nearly collinear
  // boundary vertices outside the original faces (twice area 2.7939677e-9).
  const points = [
    [453.5950927734375, -165.8518829345703],
    [453.59490966796875, -165.85116577148438],
    [453.5947265625, -165.8504638671875],
    [453.7369689941406, -165.8150634765625],
    [453.7367858886719, -165.81434631347656],
  ];
  const positions = Float32Array.from(points.flatMap(([x, z]) => [x, 0, z]));
  const receipt = finalPaintReceipt({
    primitive: { positions, indices: [0, 1, 2] }, sourcePositions: positions,
    sourcePieces: [{ id: 'boundary', faces: [[3, 0, 1], [4, 1, 2], [3, 4, 1]] }],
  });
  assert.deepEqual(receipt, [{ id: 'boundary', triangles: [points.slice(0, 3)] }]);
});

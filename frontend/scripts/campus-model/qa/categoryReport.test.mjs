import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCategoryReport } from './categoryReport.mjs';
import { D4_ANCHOR_TM, LOCAL_TO_GRID_MATRIX } from '../../../src/geo/epsg5186.mjs';

const run = { runHash: 'run', sourceRevision: 'revision', inputHashes: { source: 'hash' },
  rawHash: 'raw', packedHash: 'packed' };
const input = () => ({
  gltf: {
    nodes: [{ name: 'Topography_0', mesh: 0 },
      { name: 'Trees_pine', extras: { treeSpecies: 'pine', instances: 7 } },
      { name: 'Trees_pine_crown', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [{ count: 3 }, { count: 3 }],
  },
  network: { features: [{ id: 'ND_TEST', geometry: { type: 'Point', coordinates: [12, 34] } }] },
  transform: { epsg5186_anchor: { E: D4_ANCHOR_TM[0], N: D4_ANCHOR_TM[1] },
    epsg5186_local_to_grid: [...LOCAL_TO_GRID_MATRIX] },
  rawPath: 'candidate/campus-v2.raw.glb',
  networkPath: 'backend/simulation/data/campus_transport_network.geojson',
  transformPath: 'backend/simulation/data/coordinate_transform.json',
  markings: { pieces: [] },
  markingsPath: 'candidate/markings.report.json',
});

test('category report counts actual terrain meshes and tree instances without claiming photo accuracy', () => {
  const report = buildCategoryReport(run, input());
  const terrain = report.checks.find(c => c.id === 'Topography');
  assert.equal(terrain.findings.find(f => f.metric === 'meshNodes').value, 1);
  assert.equal(terrain.findings.find(f => f.metric === 'triangles').value, 1);
  assert.equal(terrain.unknown, 1);
  assert.equal(terrain.accepted, false);
  const trees = report.checks.find(c => c.id === '수목');
  assert.equal(trees.findings.find(f => f.metric === 'instances').value, 7);
});

test('missing terrain geometry is a failed inventory check, not an invented generated count', () => {
  const data = input();
  data.gltf.nodes = [];
  const terrain = buildCategoryReport(run, data).checks.find(c => c.id === 'Topography');
  assert.equal(terrain.status, 'fail');
  assert.equal(terrain.findings.find(f => f.metric === 'meshNodes').value, 0);
});

test('traffic report compares every coordinate against the saved transform and exposes drift', () => {
  const data = input();
  data.transform.epsg5186_anchor.E += 5;
  const traffic = buildCategoryReport(run, data).checks.find(c => c.id === '교통 네트워크 좌표');
  const residual = traffic.findings.find(f => f.metric === 'maxTransformResidualM');
  assert.equal(traffic.status, 'fail');
  assert.equal(residual.value, 5);
  assert.equal(residual.evidence, data.transformPath);
  assert.equal(traffic.findings.find(f => f.metric === 'coordinates').value, 1);
});

test('category inventories keep traffic signals out of signs and no-parking kerbs out of stalls', () => {
  const data = input();
  data.gltf.nodes.push({ name: 'Furniture', extras: { counts: {
    traffic_signal_pole: { surveyed: 6, estimated: 0 },
    signboard: { surveyed: 2, estimated: 0 },
  } } });
  data.markings.pieces = [{ kind: 'kerb_no_parking' }, { kind: 'parking_line' }];
  const report = buildCategoryReport(run, data);
  assert.equal(report.checks.find(c => c.id === '간판·현판·LED').findings.find(f => f.metric === 'signs').value, 2);
  assert.equal(report.checks.find(c => c.id === '주차 디바이더·장애인 구역·휠스톱').findings.find(f => f.metric === 'pieces').value, 1);
});

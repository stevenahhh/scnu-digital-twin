// Inventory of the actual raw candidate, not the coverage mapping table.
// Generation/coordinate checks are deliberately separate from photographic accuracy.
import { simulationToTm } from '../../../src/geo/epsg5186.mjs';
import { reduceQaReport } from './reportPolicy.mjs';

export function buildCategoryReport(run, input) {
  const { gltf, network, transform, rawPath, networkPath, transformPath } = input;
  const nodes = gltf.nodes ?? [];
  const furnitureIndex = nodes.findIndex(n => n.name === 'Furniture');
  const furniture = nodes[furnitureIndex]?.extras ?? {};
  const furnitureEvidence = `${rawPath}#/nodes/${furnitureIndex}/extras`;
  const measured = (metric, value, evidence) => ({
    id: metric, metric, value, threshold: 1, operator: 'gte', status: 'measured', evidence,
    reason: value === 0 ? 'No generated instance of this subcategory was found in the candidate.' : null,
  });
  const meshes = pattern => {
    const selected = nodes.flatMap((n, i) => pattern.test(n.name ?? '') && Number.isInteger(n.mesh)
      ? [{ node: i, mesh: n.mesh, name: n.name }] : []);
    const triangles = selected.reduce((sum, n) => sum + gltf.meshes[n.mesh].primitives.reduce((total, p) =>
      total + (gltf.accessors[p.indices ?? p.attributes.POSITION].count / 3), 0), 0);
    return [
      { ...measured('meshNodes', selected.length, `${rawPath}#/nodes`), objects: selected },
      measured('triangles', triangles, `${rawPath}#/meshes`),
    ];
  };
  const kinds = pattern => Object.entries(furniture.counts ?? {})
    .filter(([kind]) => pattern.test(kind))
    .map(([kind, count]) => ({ kind, count: count.surveyed + count.estimated }));
  const objects = (metric, pattern) => {
    const selected = kinds(pattern);
    return { ...measured(metric, selected.reduce((sum, c) => sum + c.count, 0), furnitureEvidence),
      objects: selected };
  };
  const buildings = nodes.filter(n => /^BLD_/.test(n.name ?? '') && Number.isInteger(n.mesh));
  const metadata = (metric, field) => ({
    ...measured(metric, buildings.filter(n => n.extras?.[field] !== undefined).length, `${rawPath}#/nodes`),
    objects: buildings.filter(n => n.extras?.[field] !== undefined).map(n => ({ name: n.name, value: n.extras[field] })),
  });
  const paintKinds = pattern => {
    const pieces = input.markings.pieces.filter(p => pattern.test(p.kind));
    return { ...measured('pieces', pieces.length, input.markingsPath),
      byKind: Object.fromEntries([...new Set(pieces.map(p => p.kind))].map(kind =>
        [kind, pieces.filter(p => p.kind === kind).length])) };
  };
  const trees = nodes.filter(n => n.extras?.treeSpecies && n.extras.treeSpecies !== 'hedge');
  const rows = [
    ['BLD_* 위치·발자국', [...meshes(/^BLD_/), metadata('footprintSources', 'footprintSource')]],
    ['BLD_* 매스·날개·코어', [...meshes(/^BLD_/), metadata('massReceipts', 'formMasses')]],
    ['지붕 색·태양광', [metadata('roofColours', 'roofColourSource'), metadata('solarModuleReceipts', 'solarPanelModules')]],
    ['입면(창·출입구·악센트)', [metadata('facadeReceipts', 'facadeSource'), metadata('appliedWallReceipts', 'facadeGridAppliedWalls')]],
    ['출입구·캐노피', [
      { ...measured('canopies', nodes.filter(n => n.extras?.entranceId && Number.isInteger(n.mesh)).length, `${rawPath}#/nodes`) },
      ...meshes(/\/doors$/),
    ]],
    ['Topography', meshes(/^Topography_/)],
    ['Ground_* 지면 클래스', meshes(/^Ground_(?!Context_)/)],
    ['Kerbs, 촉지, 단차', [
      ...meshes(/^Kerbs$/), { ...measured('tactileMeshes', nodes.filter(n => /^Ground_Tactile/.test(n.name ?? '') && Number.isInteger(n.mesh)).length, `${rawPath}#/nodes`) },
      measured('droppedCrossings', nodes.find(n => n.name === 'Kerbs')?.extras?.droppedAt?.length ?? 0, `${rawPath}#/nodes`),
    ]],
    ['주차 디바이더·장애인 구역·휠스톱', [
      paintKinds(/^(parking|stall|disabled|accessible)/), objects('wheelStops', /^wheel_stop$/),
    ]],
    ['차선·중앙선·가장자리선·연석선', [paintKinds(/lane|centre|center|edge|kerb/)]],
    ['정지선·횡단보도·화살표·글자·과속방지턱', [paintKinds(/stop|cross|zebra|arrow|text/),
      ...meshes(/^Ground_.*[Hh]ump/)]],
    ['광장 가구·쉼터·정자·정문 구조물·관람석', [objects('furniture', /bench|shelter|pavilion|pergola|gate|grandstand|plaza_structure/)]],
    ['가로등·신호등', [objects('lamps', /^street_lamp/), objects('signals', /signal/)]],
    ['수목', [...meshes(/^Trees_(?!hedge)/),
      { ...measured('instances', trees.reduce((sum, n) => sum + n.extras.instances, 0), `${rawPath}#/nodes`),
        objects: trees.map(n => ({ name: n.name, instances: n.extras.instances, source: n.extras.source })) }]],
    ['생울타리·화단', [objects('plantersAndHedges', /hedge|planter|shrub/), ...meshes(/^Trees_hedge/)]],
    ['간판·현판·LED', [objects('signs', /^(sign|gate_sign|plaque|led)/), ...meshes(/^Furniture_Screen$/)]],
    ['캠퍼스 밖 건물·도로·외곽 지형', [
      ...meshes(/^(Context_|Ground_Context_|OuterTerrain)/),
      measured('outerTerrainMeshes', nodes.filter(n => n.name === 'OuterTerrain' && Number.isInteger(n.mesh)).length, `${rawPath}#/nodes`),
    ]],
  ];
  // Every persisted network coordinate is compared with the exported affine
  // transform, independently of the network generator's own metadata.
  let coordinates = 0;
  let invalidCoordinates = 0;
  let maxResidual = 0;
  for (const feature of network.features) {
    const points = feature.geometry.type === 'Point' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const point of points) {
      coordinates += 1;
      if (point.length !== 2 || !point.every(Number.isFinite)) { invalidCoordinates += 1; continue; }
      const [x, z] = point;
      const [a, b, c, d] = transform.epsg5186_local_to_grid;
      const actual = [transform.epsg5186_anchor.E + a * x + b * z, transform.epsg5186_anchor.N + c * x + d * z];
      const expected = simulationToTm({ x, z });
      maxResidual = Math.max(maxResidual, Math.hypot(actual[0] - expected[0], actual[1] - expected[1]));
    }
  }
  rows.push(['교통 네트워크 좌표', [
    measured('coordinates', coordinates, networkPath),
    { ...measured('invalidCoordinates', invalidCoordinates, networkPath), threshold: 0, operator: 'eq', reason: null },
    { ...measured('maxTransformResidualM', maxResidual, transformPath), threshold: 0.001, operator: 'lte',
      reason: 'Saved simulation-to-TM transform compared against the shared frame for every network coordinate.' },
  ]]);
  const checks = rows.map(([id, entries]) => ({
    ...run, id, kind: 'invariants', status: 'complete', entries: [
      ...entries,
      { id: 'photoAccuracy', metric: 'photoAccuracy', value: null, threshold: null, status: 'unknown',
        evidence: rawPath, reason: 'Generation inventory and coordinate consistency only; photographic position, shape and colour accuracy are not measured by this check.' },
    ],
  }));
  return { ...reduceQaReport(run, checks), scope: 'generated category inventory and traffic transform consistency' };
}

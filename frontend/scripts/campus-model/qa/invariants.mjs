// Pure build boundary, design 10.3. All geometry supplied here is EPSG:5186 metres.
// The caller supplies final emitted triangles, saved snapshots, and actual pack application receipts.
// No file loading, snapshot regeneration, mesh emission, or exception baselines happen here.
import { AnchorError, resolveAnchor } from '../lib/anchors.mjs';
import { topParcelAt } from '../lib/parcels.mjs';
import { splitByLine } from '../lib/partition.mjs';

const text = value => typeof value === 'string' && value.trim().length > 0;
const pair = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
const box = points => points.reduce((b, [x, y]) =>
  [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)],
[Infinity, Infinity, -Infinity, -Infinity]);
const centre = bounds => [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
const overlaps = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

export class BuildInvariantError extends Error {
  constructor(report) {
    super(report.findings.map(f => `${f.id}: ${f.check}: ${f.reason}`).join('; '));
    this.name = 'BuildInvariantError';
    this.report = report;
  }
}

// Split each triangle by every intersecting parcel boundary line. Within each resulting convex cell,
// parcel membership is constant, so its interior point classifies the WHOLE cell, including islands
// and holes. Uses the ground partition's existing 1e-8 m2 numerical area floor, not a sampling grid.
function forbiddenPaint(pieces, parcels) {
  const at = topParcelAt(parcels);
  const parcelBounds = parcels.map(p => box(p.ring));
  const violations = [];
  for (const piece of pieces) {
    if (!Array.isArray(piece.triangles) || piece.triangles.length === 0 ||
        piece.triangles.some(t => t.length !== 3 || !t.every(pair) ||
          Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) -
            (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) <= 2e-8)) {
      violations.push({ id: piece.id, reason: 'Missing or malformed emitted TM triangles', parcel: null });
      continue;
    }
    let bad = null;
    for (const triangle of piece.triangles) {
      const bounds = box(triangle);
      const relevant = parcels.filter((p, i) => overlaps(bounds, parcelBounds[i]));
      let cells = [triangle];
      for (const parcel of relevant) {
        for (const ring of [parcel.ring, ...parcel.holes]) {
          for (let i = 0; i < ring.length; i += 1) {
            const a = ring[i], b = ring[(i + 1) % ring.length];
            if (a[0] === b[0] && a[1] === b[1]) continue;
            cells = cells.flatMap(cell => {
              const { inside, outside } = splitByLine(cell, p =>
                (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
              return [inside, outside].filter(Boolean);
            });
          }
        }
      }
      for (const cell of cells) {
        const sample = cell.reduce((s, p) => [s[0] + p[0] / cell.length, s[1] + p[1] / cell.length], [0, 0]);
        const parcel = at(sample);
        if (parcel?.paintAllowed === true) continue;
        bad = { id: piece.id, parcel: parcel?.id ?? null, reason: `Paint area on ${parcel?.id ?? 'unassigned ground'} does not allow paint` };
        break;
      }
      if (bad) break;
    }
    if (bad) violations.push(bad);
  }
  return violations;
}

/**
 * Input is an explicit projection of domain records, never a recursive scan of arbitrary booleans.
 * groundFootprints: [{id, actualParts, expectedParts}] (ground rings, NOT the LOD4 mass bbox).
 * anchors/footprints/parcels: existing resolveAnchor and parcel contracts; snapshots must be saved.
 * evidenceRecords: [{id, estimated, evidence:{tier, refs}}], refs already validated by source schemas.
 * paintPieces: [{id, triangles:[[[E,N],[E,N],[E,N]], ...]}], actual emitted geometry.
 * packApplications: [{id, requested:string[], applied:string[]}].
 * determinism: {id, firstHash, secondHash}, both made with identical source and AO inputs.
 * Throws BuildInvariantError with a complete report; successful calls return that same report shape.
 */
export function assertBuildInvariants(input) {
  const { groundFootprints, anchors, footprints, evidenceRecords, parcels, paintPieces, packApplications, determinism } = input;
  const findings = [];
  const fail = (id, check, metric, value, threshold, reason) =>
    findings.push({ id, check, metric, value, threshold, reason, evidence: `invariants/${check}/${id}`, severity: 'error' });
  for (const record of groundFootprints) {
    const actual = record.actualParts.flat(), expected = record.expectedParts.flat();
    const valid = actual.length > 0 && expected.length > 0 && [...actual, ...expected].every(pair);
    const a = valid ? centre(box(actual)) : [NaN, NaN];
    const b = valid ? centre(box(expected)) : [NaN, NaN];
    const shift = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (!Number.isFinite(shift) || shift > 0.05 + 1e-9) {
      fail(record.id, 'groundFootprint', 'centreShiftM', Number.isFinite(shift) ? shift : null, 0.05, 'Generated GIS ground footprint centre exceeds 0.05 m or is missing');
    }
  }
  const parcelMap = Object.fromEntries(parcels.map(p => [p.id, p]));
  for (const record of anchors) {
    if (record.anchor?.building && !footprints[record.anchor.building]?.walls?.length) {
      fail(record.id, 'anchor', 'savedSnapshot', null, 'required', `Missing saved wall snapshot for ${record.anchor.building}`);
      continue;
    }
    try {
      resolveAnchor(record, footprints, parcelMap);
    } catch (error) {
      if (!(error instanceof AnchorError)) throw error;
      fail(record.id, 'anchor', 'resolution', false, true, error.message);
    }
  }
  for (const record of evidenceRecords) {
    if (record.estimated !== false) continue;
    const evidence = record.evidence;
    // Source validators own the domain-specific shape of a ref. Reject empty ref shells here too.
    const refs = evidence?.refs;
    const referenced = Array.isArray(refs) && refs.some(ref => text(ref) ||
      (ref && typeof ref === 'object' && Object.values(ref).some(value => text(value) || Number.isFinite(value))));
    if (!['T0', 'T1', 'T2'].includes(evidence?.tier) || !referenced) {
      fail(record.id, 'evidence', 'evidenceTier', evidence?.tier ?? null, 'T0-T2 with ref', 'estimated:false requires a T0-T2 reference');
    }
  }
  for (const violation of forbiddenPaint(paintPieces, parcels)) {
    fail(violation.id, 'paint', 'paintAllowed', false, true, violation.reason);
  }
  for (const record of packApplications) {
    const missing = record.requested.filter(id => !record.applied.includes(id));
    if (missing.length) fail(record.id, 'packApplication', 'missingApplications', missing, [], `Pack did not apply ${missing.join(', ')}`);
  }
  if (!text(determinism.firstHash) || !text(determinism.secondHash) || determinism.firstHash !== determinism.secondHash) {
    fail(determinism.id, 'determinism', 'rawHash', determinism.secondHash ?? null, determinism.firstHash ?? null, 'Two raw builds with identical inputs must have the same hash');
  }
  const report = {
    pass: findings.length === 0, status: findings.length ? 'error' : 'pass',
    checked: groundFootprints.length + anchors.length + evidenceRecords.length + paintPieces.length + packApplications.length + 1,
    unknown: 0, findings,
  };
  if (!report.pass) throw new BuildInvariantError(report);
  return report;
}

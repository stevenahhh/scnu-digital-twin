// Pure build boundary, design 10.3. All geometry supplied here is EPSG:5186 metres.
// The caller supplies final emitted triangles, saved snapshots, and actual pack application receipts.
// No file loading, snapshot regeneration, mesh emission, or exception baselines happen here.
import { AnchorError, resolveAnchor } from '../lib/anchors.mjs';
import { topParcelAt } from '../lib/parcels.mjs';
import { splitByLine } from '../lib/partition.mjs';
import { PAINT_FACE_AREA2_FLOOR_M2 } from '../lib/decimate.mjs';

const text = value => typeof value === 'string' && value.trim().length > 0;
const pair = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
const box = points => points.reduce((b, [x, y]) =>
  [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)],
[Infinity, Infinity, -Infinity, -Infinity]);
const overlaps = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

function areaCentre(parts) {
  if (!parts.length || parts.some(r => r.length < 3 || !r.every(pair))) return [NaN, NaN];
  const origin = parts[0][0];
  let area = 0, east = 0, north = 0;
  for (const ring of parts) {
    let twiceArea = 0, momentX = 0, momentY = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i].map((v, k) => v - origin[k]);
      const b = ring[(i + 1) % ring.length].map((v, k) => v - origin[k]);
      const cross = a[0] * b[1] - b[0] * a[1];
      twiceArea += cross;
      momentX += (a[0] + b[0]) * cross;
      momentY += (a[1] + b[1]) * cross;
    }
    if (twiceArea === 0) return [NaN, NaN];
    // Ground parts are separate outer rings; winding must not subtract a part.
    const weight = Math.abs(twiceArea);
    area += weight;
    east += momentX / (3 * twiceArea) * weight;
    north += momentY / (3 * twiceArea) * weight;
  }
  return [origin[0] + east / area, origin[1] + north / area];
}

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
  const parcelBounds = parcels.map(p => box(p.ring));
  const violations = [];
  for (const piece of pieces) {
    if (!Array.isArray(piece.triangles) || piece.triangles.length === 0 ||
        piece.triangles.some(t => t.length !== 3 || !t.every(pair) ||
          Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) -
            (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) <= PAINT_FACE_AREA2_FLOOR_M2)) {
      violations.push({ id: piece.id, reason: 'Missing or malformed emitted TM triangles', parcel: null });
      continue;
    }
    let bad = null;
    for (const triangle of piece.triangles) {
      const bounds = box(triangle);
      // A triangle-local origin keeps splitByLine's 1e-8 m2 area test away
      // from the cancellation of ~243000 * 263000 absolute-coordinate terms.
      // Translate classification too, including holes, so boundary samples agree.
      const origin = triangle[0];
      const local = p => [p[0] - origin[0], p[1] - origin[1]];
      const relevant = parcels.filter((p, i) => overlaps(bounds, parcelBounds[i])).map(p => ({
        ...p, ring: p.ring.map(local), holes: p.holes.map(r => r.map(local)),
      }));
      const at = topParcelAt(relevant);
      let cells = [triangle.map(local)];
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
        const areaM2 = Math.abs(cell.reduce((s, p, i) => {
          const q = cell[(i + 1) % cell.length];
          return s + p[0] * q[1] - q[0] * p[1];
        }, 0)) / 2;
        bad = { id: piece.id, parcel: parcel?.id ?? null, reason: `Paint area on ${parcel?.id ?? 'unassigned ground'} does not allow paint`,
          areaM2, pointTM: [sample[0] + origin[0], sample[1] + origin[1]] };
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
    const a = areaCentre(record.actualParts);
    const b = areaCentre(record.expectedParts);
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
    const where = violation.areaM2 === undefined ? ''
      : ` (${violation.areaM2.toPrecision(3)} m2 near EPSG:5186 ${violation.pointTM.map(v => v.toFixed(3)).join(', ')})`;
    fail(violation.id, 'paint', 'paintAllowed', false, true, violation.reason + where);
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

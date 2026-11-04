// Design §16: roof geometry in metres along the footprint's oriented box axes.
// Absolute coordinates remain a compatibility snapshot; roofRelative is authoritative after a refetch.
import { AnchorError, resolveAnchor } from "./anchors.mjs";
import { pointInRing, segmentDistance } from "./geometry.mjs";

export function mapRoofGeometry(record, point) {
  const ring = r => r.map(point);
  return {
    ...(record.outer ? { outer: ring(record.outer) } : {}),
    ...(record.holes ? { holes: record.holes.map(ring) } : {}),
    ...(record.columns ? { columns: record.columns.map(ring) } : {}),
    ...(record.triangles ? { triangles: record.triangles.map(t => t.map(([e, n, h]) => [...point([e, n]), h])) } : {}),
    ...(record.plan ? { plan: ring(record.plan) } : {}),
    ...(record.at ? { at: point(record.at) } : {}),
    ...(record.round ? { round: { ...record.round, centre: point(record.round.centre) } } : {}),
  };
}

function frameOf(id, footprint, polygon) {
  const ring = footprint?.polygons?.[polygon]?.[0];
  if (!ring) throw new AnchorError(id, id, `missing footprint polygon ${polygon}`);
  return resolveAnchor({ id, estimated: true, anchor: { parcel: id, uM: 0, vM: 0 } }, {}, { [id]: { ring } });
}

export function encodeRoofGeometry(id, record, footprint) {
  if (!footprint?.polygons?.length) throw new AnchorError(id, id, "missing footprint");
  const points = record.outer ?? record.plan ?? [record.at];
  const centre = [0, 1].map(axis => points.reduce((s, p) => s + p[axis], 0) / points.length);
  const distance = ([outer]) => pointInRing(centre, outer) ? 0 :
    Math.min(...outer.map((p, i) => segmentDistance(centre, p, outer[(i + 1) % outer.length])));
  const polygon = footprint.polygons.map((p, index) => ({ index, distance: distance(p) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)[0].index;
  const f = frameOf(id, footprint, polygon);
  const project = ([e, n]) => [f.a, f.n].map(axis => (e - f.origin[0]) * axis[0] + (n - f.origin[1]) * axis[1]);
  return { version: 1, polygon, estimated: true, ...mapRoofGeometry(record, project) };
}

export function resolveRoofGeometry(id, record, footprint) {
  const relative = record.roofRelative;
  if (relative.version !== 1 || !Number.isInteger(relative.polygon) || relative.polygon < 0 || relative.estimated !== true) {
    throw new AnchorError(id, id, "invalid roofRelative version, polygon or estimated flag");
  }
  const f = frameOf(id, footprint, relative.polygon);
  const point = p => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) throw new AnchorError(id, id, "roof coordinates must be finite pairs");
    return f.origin.map((v, i) => v + p[0] * f.a[i] + p[1] * f.n[i]);
  };
  return { ...record, ...mapRoofGeometry(relative, point), estimated: true };
}

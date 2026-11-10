import { sceneToTm } from "../../../src/geo/epsg5186.mjs";
import { roadObjectInventory } from "./roadObjects.mjs";

// The planned ring supplies station directions only. Cross-section endpoints
// and their midpoint come from the emitted triangles, so displaced output
// cannot silently inherit an unchanged planned centreline.
export function emittedCentreline(piece, triangles) {
  const ring = piece.rings[0], n = ring.length / 2;
  if (piece.rings.length !== 1 || !Number.isInteger(n) || n < 2) throw new TypeError(`${piece.partId}: expected canonical stroke ring`);
  return ring.slice(0, n).map((left, i) => {
    const right = ring[ring.length - 1 - i];
    const origin = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
    const width = Math.hypot(left[0] - right[0], left[1] - right[1]);
    const normal = [(left[0] - right[0]) / width, (left[1] - right[1]) / width];
    const hits = [];
    for (const triangle of triangles) for (let j = 0; j < 3; j++) {
      const a = triangle[j], b = triangle[(j + 1) % 3];
      const da = -(a[0] - origin[0]) * normal[1] + (a[1] - origin[1]) * normal[0];
      const db = -(b[0] - origin[0]) * normal[1] + (b[1] - origin[1]) * normal[0];
      if (Math.abs(da) < 1e-7) hits.push((a[0] - origin[0]) * normal[0] + (a[1] - origin[1]) * normal[1]);
      if (da * db < 0) {
        const t = da / (da - db);
        hits.push((a[0] + t * (b[0] - a[0]) - origin[0]) * normal[0] + (a[1] + t * (b[1] - a[1]) - origin[1]) * normal[1]);
      }
    }
    if (!hits.length) return null;
    const mid = (Math.min(...hits) + Math.max(...hits)) / 2;
    return sceneToTm(origin[0] + mid * normal[0], origin[1] + mid * normal[1]);
  });
}

// Geometry comes from the real mesh-emission report. Missing emitted parts
// are never replaced by their planned polygons.
export function roadMapObjects(pieces, emission) {
  const emitted = new Map(emission.parts.map(p => [p.partId, p]));
  const groups = roadObjectInventory(pieces.filter(p => emitted.has(p.partId)), []).objects;
  const objects = [];
  for (const group of groups) {
    const first = group.pieces[0];
    const meta = { objectId: group.id, ownerId: group.ownerId, estimated: group.pieces.some(p => p.estimated), evidence: first.evidence };
    const polygons = parts => parts.flatMap(p => emitted.get(p.partId).triangles.map(t => [t.map(q => sceneToTm(...q))]));
    if (group.id === `${group.ownerId}/crossing`) {
      objects.push({ ...meta, id: group.id, kind: "crossing", colour: "white", geometry: { type: "area", polygons: polygons(group.pieces) } });
      const bars = new Map();
      for (const p of group.pieces) {
        const id = p.partId.slice(0, p.partId.lastIndexOf("/part/"));
        if (!bars.has(id)) bars.set(id, []);
        bars.get(id).push(p);
      }
      for (const [id, parts] of bars) objects.push({ ...meta, id, kind: "zebra_bar", colour: "white", geometry: { type: "area", polygons: polygons(parts) } });
      continue;
    }
    if (/^(centre_line|lane_line|edge_line|guide_|kerb)/.test(first.kind)) {
      const reconstructed = group.pieces.map(p => emittedCentreline(p, emitted.get(p.partId).triangles));
      const parts = reconstructed.map(part => part.filter(p => p !== null));
      const missingStation = reconstructed.some(part => part.some(p => p === null));
      const clipped = group.pieces.some(p => {
        const e = emitted.get(p.partId);
        return Math.abs(e.sourceAreaScene - e.emittedAreaScene) > Math.max(1e-7, e.sourceAreaScene * 1e-6);
      });
      objects.push({ ...meta, id: group.id, kind: first.kind, colour: first.colour, geometry: { type: "line", parts },
        ...(clipped || missingStation ? { unmeasurableReason: "clipped or missing emitted line cross-section" } : {}) });
      continue;
    }
    for (const colour of [...new Set(group.pieces.map(p => p.colour))].sort()) {
      const parts = group.pieces.filter(p => p.colour === colour);
      objects.push({ ...meta, id: `${group.id}/colour/${colour}`, kind: first.kind, colour, geometry: { type: "area", polygons: polygons(parts) } });
    }
  }
  return objects;
}

// Independent physical-crossing references can name multiple canonical grids
// (for example two halves). Keep their fixed photo window when a half vanishes.
export function physicalRoadCrossings(objects, references) {
  const byId = new Map(objects.map(o => [o.id, o]));
  return references.map(r => ({
    id: r.id, kind: "crossing", colour: "white",
    geometry: { type: "area", polygons: r.objectIds.flatMap(id => byId.get(id)?.geometry.polygons ?? []), referenceBounds: r.boundsTm },
    missingMemberIds: r.objectIds.filter(id => !byId.has(id)),
    ...(r.expected !== true || !r.refs?.length ? { unmeasurableReason: "physical crossing reference is unconfirmed" } : {}),
  }));
}

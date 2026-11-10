import { sceneToTm, tmToScene } from "../../../src/geo/epsg5186.mjs";
import { parkingPlan } from "../stages/parking.mjs";
import { classify, LINE_STEP_M, parkingObjects } from "./mapCompare.mjs";
import { emittedCentreline } from "./roadMapObjects.mjs";

const area = ring => Math.abs(ring.slice(1, -1).reduce((sum, p, i) => {
  const a = ring[0], q = ring[i + 2];
  return sum + (p[0] - a[0]) * (q[1] - a[1]) - (p[1] - a[1]) * (q[0] - a[0]);
}, 0)) / 2;

// Records define the expected inventory and station directions only. All
// measured coordinates come from the final Float32 paint-emission receipt.
export function parkingMapObjects(doc, receipt, suppressed = []) {
  const expected = parkingObjects(doc);
  const planned = parkingPlan(doc).pieces;
  const emitted = new Map(receipt.map(p => [p.id, p.triangles]));
  const reasons = new Map(suppressed.map(p => [p.id, p.reason]));
  const groups = new Map(expected.map(o => [o.id, []]));
  for (const piece of planned) {
    const id = groups.has(piece.id) ? piece.id : piece.id.replace(/(\/D\d+)[abct]$/, "$1");
    groups.get(id)?.push(piece);
  }
  const objects = [], gaps = [];
  for (const record of expected) {
    const pieces = groups.get(record.id);
    const triangles = pieces.flatMap(p => emitted.get(p.id) ?? []);
    const absent = pieces.filter(p => !emitted.get(p.id)?.length);
    if (!triangles.length) {
      const suppressed = absent.length > 0 && absent.every(p => reasons.has(p.id));
      gaps.push({
        id: record.id, kind: record.kind, tier: classify(record.kind, record.geometry.type, record.colour),
        row: record.row ?? null, notEmitted: true, suppressed, error: !suppressed,
        unmeasurable: true, missing: true, over: true, occluded: false,
        residual_m: null, iou: null, support: null,
        reason: suppressed ? [...new Set(absent.map(p => reasons.get(p.id)))].join("; ")
          : `expected parking paint has no emitted geometry: ${absent.map(p => p.id).join(", ")}`,
      });
      continue;
    }
    if (record.geometry.type === "area") {
      objects.push({ ...record, geometry: { type: "area",
        polygons: triangles.map(t => [t.map(p => sceneToTm(...p))]) } });
      continue;
    }
    const [a, b] = record.geometry.coords;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.max(1, Math.ceil(length / LINE_STEP_M));
    const normal = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
    const stations = Array.from({ length: count + 1 }, (_, i) =>
      [a[0] + (b[0] - a[0]) * i / count, a[1] + (b[1] - a[1]) * i / count]);
    const side = sign => stations.map(p => tmToScene(p[0] + sign * normal[0], p[1] + sign * normal[1]));
    const centres = emittedCentreline({ partId: record.id, rings: [[...side(1), ...side(-1).reverse()]] }, triangles);
    const parts = [];
    let part = [];
    for (const centre of centres) {
      if (centre) part.push(centre);
      else { if (part.length > 1) parts.push(part); part = []; }
    }
    if (part.length > 1) parts.push(part);
    const sourceArea = pieces.reduce((sum, p) => sum + area(p.rings[0]) - p.rings.slice(1).reduce((n, r) => n + area(r), 0), 0);
    const emittedArea = triangles.reduce((sum, t) => sum + area(t), 0);
    // Bound Float32 boundary rounding, not the photographic tolerance. This
    // also detects clipping in the divider ends deliberately trimmed for scoring.
    const roundingArea = pieces.reduce((sum, p) => sum + p.rings.reduce((n, ring) => {
      const perimeter = ring.reduce((length, q, i) => length + Math.hypot(q[0] - ring[(i + 1) % ring.length][0], q[1] - ring[(i + 1) % ring.length][1]), 0);
      const magnitude = Math.max(...ring.flat().map(Math.abs));
      return n + perimeter * magnitude * 2 ** -23;
    }, 0), 0);
    const sourcePoints = pieces.flatMap(p => p.rings.flat());
    const emittedPoints = triangles.flat();
    const origin = tmToScene(...a), end = tmToScene(...b);
    const sceneLength = Math.hypot(end[0] - origin[0], end[1] - origin[1]);
    const along = [(end[0] - origin[0]) / sceneLength, (end[1] - origin[1]) / sceneLength];
    const span = (points, axis) => {
      const values = points.map(p => (p[0] - origin[0]) * axis[0] + (p[1] - origin[1]) * axis[1]);
      return Math.max(...values) - Math.min(...values);
    };
    const roundingLength = Math.max(...sourcePoints.flat().map(Math.abs)) * 2 ** -22;
    const shortened = [along, [-along[1], along[0]]].some(axis =>
      span(sourcePoints, axis) - span(emittedPoints, axis) > Math.max(1e-7, roundingLength));
    const incomplete = absent.length > 0 || centres.some(p => p === null) || shortened || Math.abs(sourceArea - emittedArea) > Math.max(1e-7, roundingArea);
    objects.push({ ...record, geometry: { type: "line", parts },
      ...(incomplete ? { unmeasurableReason: `clipped or missing emitted parking line cross-section${absent.length ? `: ${absent.map(p => `${p.id}${reasons.has(p.id) ? ` (${reasons.get(p.id)})` : ""}`).join(", ")}` : ""}` } : {}) });
  }
  return { objects, gaps };
}

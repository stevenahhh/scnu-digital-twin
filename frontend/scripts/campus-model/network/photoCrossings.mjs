// Painted zebra crossings traced from the NGII 2025 orthophoto (data/photo/evidence/markings.geojson, `kind: zebra_bar`,
// grouped by `crossing_id`) that no digitised CW polygon covers (plan uhf-ground-roads-routing W4 (c): people cross
// only at crossing polygons, so every crossing the paint shows is one). Each group on a road polygon becomes a
// crossing polygon: the bar-aligned rectangle around its bars (ortho-traced paint, estimated: false) plus a kerb
// approach at both ends of the walking direction, out to the kerb when one is within 15 m, else 1 m (estimated: true, 추정).
// Simulation frame.
import { PolygonGrid, dist } from "./geom.mjs";

export const MIN_BARS = 4;
export const APPROACH_M = 1.0;
// the painted run can stop short of a kerb (a car or a shadow over the bars): the approach follows the walking
// direction to the edge of the road polygon, at most EXTENSION_MAX_M (estimated)
export const EXTENSION_MAX_M = 15;

const rectRing = (c, u, v, [a0, a1], [b0, b1]) => [
  [c[0] + u[0] * a0 + v[0] * b0, c[1] + u[1] * a0 + v[1] * b0],
  [c[0] + u[0] * a1 + v[0] * b0, c[1] + u[1] * a1 + v[1] * b0],
  [c[0] + u[0] * a1 + v[0] * b1, c[1] + u[1] * a1 + v[1] * b1],
  [c[0] + u[0] * a0 + v[0] * b1, c[1] + u[1] * a0 + v[1] * b1],
];

// groups: Map crossing_id -> [bar ring (simulation frame)]; crossings: [{ ring }] digitised CW polygons;
// roadPolygons: [{ class, rings }].
export function photoCrossings({ groups, crossings = [], roadPolygons = [] }) {
  const cw = new PolygonGrid(crossings.map((c) => ({ rings: [c.ring] })), 20);
  const roads = new PolygonGrid(roadPolygons.filter((r) => r.class === "road"), 20);
  const out = [];
  const skipped = { fewBars: 0, inCw: 0, offRoad: 0 };
  for (const [id, bars] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    if (bars.length < MIN_BARS) { skipped.fewBars += 1; continue; }
    if (bars.some((ring) => ring.some((p) => cw.contains(p)))) { skipped.inCw += 1; continue; }
    const pts = bars.flat();
    const c = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    if (!roads.contains(c)) { skipped.offRoad += 1; continue; }
    // walking direction = the long side of the bars (a zebra bar runs along the crossing)
    const ring = bars[0];
    const sides = ring.slice(0, -1).map((p, k) => [p, ring[k + 1]]).sort((x, y) => dist(y[0], y[1]) - dist(x[0], x[1]));
    const [p, q] = sides[0];
    const l = dist(p, q) || 1;
    const u = [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
    const v = [-u[1], u[0]];
    const along = pts.map((r) => (r[0] - c[0]) * u[0] + (r[1] - c[1]) * u[1]);
    const across = pts.map((r) => (r[0] - c[0]) * v[0] + (r[1] - c[1]) * v[1]);
    const a = [Math.min(...along), Math.max(...along)];
    const b = [Math.min(...across), Math.max(...across)];
    const onRoad = (t) => roads.contains([c[0] + u[0] * t + v[0] * (b[0] + b[1]) / 2, c[1] + u[1] * t + v[1] * (b[0] + b[1]) / 2]);
    // extended only when a kerb is reached within EXTENSION_MAX_M; still on the road after that (a junction
    // interior) keeps the 1 m approach, so a painted crossing never covers a junction
    const reach = (from, sign) => {
      let t = 0;
      while (t < EXTENSION_MAX_M && onRoad(from + sign * (t + 0.2))) t += 0.2;
      return t >= EXTENSION_MAX_M ? APPROACH_M : Math.max(APPROACH_M, t + 0.5);
    };
    const r0 = reach(a[0], -1);
    const r1 = reach(a[1], 1);
    const source_ref = `data/photo/evidence/markings.geojson ${id} (${bars.length} painted zebra bars, NGII 2025 orthophoto)`;
    out.push({ class: "crossing", id: `PZC_${id}`, source_ref, estimated: false, rings: [rectRing(c, u, v, a, b)] });
    out.push({ class: "crossing", id: `PZC_${id}_A0`, source_ref: `${source_ref} kerb approach`, estimated: true, rings: [rectRing(c, u, v, [a[0] - r0, a[0]], b)] });
    out.push({ class: "crossing", id: `PZC_${id}_A1`, source_ref: `${source_ref} kerb approach`, estimated: true, rings: [rectRing(c, u, v, [a[1], a[1] + r1], b)] });
  }
  return { polygons: out, stats: { crossings: out.length / 3, ...skipped } };
}

// data/photo/evidence/markings.geojson features -> Map crossing_id -> bar rings, via toSim([lon, lat]).
export function zebraGroups(markings, toSim) {
  const groups = new Map();
  for (const f of markings.features) {
    if (f.properties.kind !== "zebra_bar" || !f.properties.crossing_id || f.properties.estimated) continue;
    if (!groups.has(f.properties.crossing_id)) groups.set(f.properties.crossing_id, []);
    groups.get(f.properties.crossing_id).push(f.geometry.coordinates[0].map(toSim));
  }
  return groups;
}

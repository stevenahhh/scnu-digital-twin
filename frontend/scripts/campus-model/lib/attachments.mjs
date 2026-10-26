// Facade attachments (data/facade-attachments.json): details the building masses do not carry, drawn as extra solids
// on a building's node: balcony stacks (slabs, parapet panels, a corner column and a roof frame in a recess of the
// outline), fins standing out of a wall, a rooftop lattice mast with its antenna panels, and blocks (a prism with
// facade cells of another look, e.g. brick end towers proud of a panel facade). Plans and walls are lon/lat, heights
// metres above the building's ground; every value is an estimate read from the SCNU 360 VR tour and the NGII 2025
// orthophoto. Blocks are drawn by stages/buildings.mjs (they need the facade atlas); the rest is built here as plain
// vertex-coloured solids on the parapet primitive, each solid on one AO chart (its faces side by side). A roof record
// draws nothing: it recolours the roof of the building part whose outline holds its point (a green-tiled canopy roof
// the photo samples as grey), applied by stages/buildings.mjs with the other roof colours.
import { metres } from "./frame.mjs";

export const ATTACHMENT_KINDS = Object.freeze(["balconies", "fins", "mast", "block", "roof"]);
const PLAIN_UV = Object.freeze([[0, 0], [0, 0], [0, 0], [0, 0]]);

const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const positive = (v) => Number.isFinite(v) && v > 0;

// Schema errors of one attachment record (empty when valid). `looks` is the set of look ids of scnu-facades.json.
export function attachmentErrors(a, looks) {
  const errors = [];
  if (!ATTACHMENT_KINDS.includes(a.kind)) return [`unknown kind ${a.kind}`];
  if (typeof a.source !== "string" || !a.source.includes("estimated")) errors.push("source must say what it is estimated from (\"estimated\")");
  const plan4 = () => Array.isArray(a.plan) && a.plan.length === 4 && a.plan.every(isPoint);
  if (a.kind === "balconies") {
    if (!plan4()) errors.push("plan needs 4 lon/lat corners");
    if (!Array.isArray(a.open) || !a.open.length || !a.open.every((e) => Number.isInteger(e) && e >= 0 && e < 4)) errors.push("open needs edge indices 0-3");
    if (a.column !== undefined && !(Number.isInteger(a.column) && a.column >= 0 && a.column < 4)) errors.push("column is a corner index 0-3");
    if (!positive(a.storeyMetres) || !Number.isInteger(a.fromStorey) || !Number.isInteger(a.toStorey) || a.fromStorey < 2 || a.toStorey < a.fromStorey) errors.push("storeyMetres > 0 and 2 <= fromStorey <= toStorey");
    if (!positive(a.roofMetres) || a.roofMetres < (a.toStorey - 1) * a.storeyMetres) errors.push("roofMetres must lie above the top slab");
  } else if (a.kind === "fins") {
    if (!Array.isArray(a.wall) || a.wall.length !== 2 || !a.wall.every(isPoint)) errors.push("wall needs 2 lon/lat points");
    if (!Array.isArray(a.offsets) || !a.offsets.length || !a.offsets.every(Number.isFinite)) errors.push("offsets needs metres along the wall");
    if (!positive(a.width) || !positive(a.depth)) errors.push("width and depth > 0");
    if (a.levels !== undefined) {
      if (!Array.isArray(a.levels) || !a.levels.length || !a.levels.every((v) => v >= 0) || !positive(a.thickness)) errors.push("levels needs metres >= 0 and thickness > 0");
    } else if (!(a.topMetres > a.bottomMetres) || !(a.bottomMetres >= 0)) errors.push("0 <= bottomMetres < topMetres (or levels and thickness)");
  } else if (a.kind === "roof") {
    if (!isPoint(a.at)) errors.push("at needs a lon/lat point");
  } else if (a.kind === "mast") {
    if (!isPoint(a.at)) errors.push("at needs a lon/lat point");
    if (!(a.baseMetres >= 0) || !positive(a.heightMetres)) errors.push("baseMetres >= 0 and heightMetres > 0");
  } else if (a.kind === "block") {
    if (!plan4()) errors.push("plan needs 4 lon/lat corners");
    if (!looks.has(a.look)) errors.push(`unknown look ${a.look}`);
    if (a.topMetres !== undefined && !positive(a.topMetres)) errors.push("topMetres > 0 when given");
  }
  if (a.kind !== "block" && !/^#[0-9a-f]{6}$/i.test(a.colour ?? "")) errors.push("colour is #rrggbb");
  return errors;
}

// node -> attachments of the file, every record validated (a bad record stops the build, never a silent skip).
export function attachmentsByNode(file, looks) {
  const byNode = new Map();
  for (const entry of file.buildings) {
    if (!/^BLD_/.test(entry.node ?? "")) throw new Error(`facade-attachments.json: entry without a BLD_* node`);
    if (byNode.has(entry.node)) throw new Error(`facade-attachments.json: ${entry.node} listed twice`);
    for (const [k, a] of entry.attachments.entries()) {
      const errors = attachmentErrors(a, looks);
      if (errors.length) throw new Error(`facade-attachments.json: ${entry.node} attachment ${k} (${a.kind}): ${errors.join("; ")}`);
    }
    byNode.set(entry.node, entry.attachments);
  }
  return byNode;
}

// ---------------------------------------------------------------- solids
const sub = (p, q) => p.map((v, i) => v - q[i]);
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const centreOf = (points) => points[0].map((_, i) => points.reduce((s, p) => s + p[i], 0) / points.length);

// A closed solid of planar quads, each turned to face away from the solid's centre, on one AO chart.
export function addSolid(mesh, faces, charts, colour) {
  const centre = centreOf(faces.flat());
  const chart = charts.open();
  let s = 0;
  let height = 0;
  for (const face of faces) {
    const n = cross(sub(face[1], face[0]), sub(face[3], face[0]));
    const quad = dot(n, sub(centreOf(face), centre)) < 0 ? [face[0], face[3], face[2], face[1]] : face;
    const w = Math.hypot(...sub(quad[1], quad[0]));
    const h = Math.hypot(...sub(quad[3], quad[0]));
    mesh.quad(...quad, PLAIN_UV, colour);
    mesh.ao.push(s, 0, chart, s + w, 0, chart, s + w, h, chart, s, h, chart);
    s += w;
    height = Math.max(height, h);
  }
  charts.close(chart, s, height);
}

// Six faces between two quads of corresponding corners (b bottom, t top), [x, y, z] each.
export function hexahedron(b, t) {
  return [
    [b[0], b[1], t[1], t[0]], [b[1], b[2], t[2], t[1]], [b[2], b[3], t[3], t[2]], [b[3], b[0], t[0], t[3]],
    [t[0], t[1], t[2], t[3]], [b[3], b[2], b[1], b[0]],
  ];
}

// A vertical prism over a 4-corner plan ring ([x, z]) from y0 to y1.
export function addPrism(mesh, ring, y0, y1, charts, colour) {
  addSolid(mesh, hexahedron(ring.map(([x, z]) => [x, y0, z]), ring.map(([x, z]) => [x, y1, z])), charts, colour);
}

const add2 = (p, q, s = 1) => [p[0] + q[0] * s, p[1] + q[1] * s];
const unit2 = (v) => {
  const l = Math.hypot(v[0], v[1]);
  return [v[0] / l, v[1] / l];
};
const centroid2 = (ring) => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];

// Strip of thickness t along edge e of a convex plan, on its inner side.
function edgeStrip(plan, e, t) {
  const p = plan[e];
  const q = plan[(e + 1) % plan.length];
  const u = unit2([q[0] - p[0], q[1] - p[1]]);
  let n = [-u[1], u[0]];
  const c = centroid2(plan);
  if ((c[0] - p[0]) * n[0] + (c[1] - p[1]) * n[1] < 0) n = [-n[0], -n[1]];
  return [p, q, add2(q, n, t), add2(p, n, t)];
}

// ---------------------------------------------------------------- kinds (plans already in model [x, z])
const SLAB = 0.25;
const PANEL = 0.15;
const PANEL_HEIGHT = 1.1;
const COLUMN = 0.5;
const FRAME_BELOW = 0.3;
const FRAME_ABOVE = 0.6;

// Balcony stack: a slab at each storey floor from fromStorey to toStorey, parapet panels along the open edges, a
// column at one corner from the ground to the roof frame, and the roof frame over the plan at roofMetres.
export function addBalconies(mesh, a, ground, charts, { colour, slabColour }) {
  const y = (m) => ground + metres(m);
  for (let storey = a.fromStorey; storey <= a.toStorey; storey += 1) {
    const level = (storey - 1) * a.storeyMetres;
    addPrism(mesh, a.plan, y(level - SLAB), y(level), charts, slabColour);
    for (const e of a.open) addPrism(mesh, edgeStrip(a.plan, e, metres(PANEL)), y(level), y(level + PANEL_HEIGHT), charts, colour);
  }
  addPrism(mesh, a.plan, y(a.roofMetres - FRAME_BELOW), y(a.roofMetres + FRAME_ABOVE), charts, colour);
  if (a.column !== undefined) {
    const c = a.plan[a.column];
    const d1 = unit2(sub(a.plan[(a.column + 1) % 4], c));
    const d2 = unit2(sub(a.plan[(a.column + 3) % 4], c));
    const w = metres(COLUMN);
    addPrism(mesh, [c, add2(c, d1, w), add2(add2(c, d1, w), d2, w), add2(c, d2, w)], y(-0.5), y(a.roofMetres - FRAME_BELOW), charts, colour);
  }
}

// Fins: boxes `width` wide and `depth` deep standing out of the wall at `offsets` metres from wall[0], from
// bottomMetres to topMetres (vertical fins) or `thickness` thick at each of `levels` (horizontal ledges); `outside(p)`
// tells which side of the wall is outside the building.
export function addFins(mesh, a, ground, charts, { colour, outside }) {
  const [p, q] = a.wall;
  const u = unit2([q[0] - p[0], q[1] - p[1]]);
  let n = [-u[1], u[0]];
  const middle = add2(p, [q[0] - p[0], q[1] - p[1]], 0.5);
  if (!outside(add2(middle, n, metres(0.5)))) n = [-n[0], -n[1]];
  for (const offset of a.offsets) {
    const s0 = add2(p, u, metres(offset));
    const s1 = add2(p, u, metres(offset + a.width));
    const ring = [add2(s0, n, -metres(0.05)), add2(s1, n, -metres(0.05)), add2(s1, n, metres(a.depth)), add2(s0, n, metres(a.depth))];
    const spans = a.levels ? a.levels.map((level) => [level, level + a.thickness]) : [[a.bottomMetres, a.topMetres]];
    for (const [bottom, top] of spans) addPrism(mesh, ring, ground + metres(bottom), ground + metres(top), charts, colour);
  }
}

// Lattice mast: a footing, three legs tapering from 1 m to 0.35 m radius up to the antenna platform (68 % of the
// height), braces between the legs, a central pole to the top, the platform, nine antenna panels round it and three
// more on an upper tier.
export function addMast(mesh, a, ground, charts, { colour }) {
  const [cx, cz] = a.at;
  const y0 = ground + metres(a.baseMetres);
  const height = metres(a.heightMetres);
  const platform = y0 + height * 0.68;
  const square = ([x, z], half) => [[x - half, z - half], [x + half, z - half], [x + half, z + half], [x - half, z + half]];
  const at = (r, angle) => [cx + r * Math.cos(angle), cz + r * Math.sin(angle)];
  addPrism(mesh, square([cx, cz], metres(1.1)), y0, y0 + metres(0.3), charts, colour);
  const leg = metres(0.14);
  const angles = [0, 1, 2].map((k) => Math.PI / 6 + (k * 2 * Math.PI) / 3);
  const legPoint = (angle, y) => at(metres(1.0) + (metres(0.35) - metres(1.0)) * ((y - y0) / (platform - y0)), angle);
  for (const angle of angles) {
    const b = square(legPoint(angle, y0), leg / 2).map(([x, z]) => [x, y0, z]);
    const t = square(legPoint(angle, platform), leg / 2).map(([x, z]) => [x, platform, z]);
    addSolid(mesh, hexahedron(b, t), charts, colour);
  }
  for (const f of [0.22, 0.45, 0.68, 0.9]) {
    const y = y0 + (platform - y0) * f;
    for (let k = 0; k < 3; k += 1) {
      const p = legPoint(angles[k], y);
      const q = legPoint(angles[(k + 1) % 3], y);
      const n = unit2([-(q[1] - p[1]), q[0] - p[0]]);
      const w = metres(0.04);
      addPrism(mesh, [add2(p, n, -w), add2(q, n, -w), add2(q, n, w), add2(p, n, w)], y, y + metres(0.08), charts, colour);
    }
  }
  addPrism(mesh, square([cx, cz], metres(0.08)), y0, y0 + height, charts, colour);
  addPrism(mesh, square([cx, cz], metres(1.1)), platform, platform + metres(0.12), charts, colour);
  const panels = (count, radius, from, to, phase) => {
    for (let k = 0; k < count; k += 1) {
      const angle = phase + (k * 2 * Math.PI) / count;
      const c = at(radius, angle);
      const t = [-Math.sin(angle), Math.cos(angle)];
      const r = [Math.cos(angle), Math.sin(angle)];
      const [hw, hd] = [metres(0.16), metres(0.07)];
      const ring = [add2(add2(c, t, -hw), r, -hd), add2(add2(c, t, hw), r, -hd), add2(add2(c, t, hw), r, hd), add2(add2(c, t, -hw), r, hd)];
      addPrism(mesh, ring, from, to, charts, colour);
    }
  };
  panels(9, metres(0.95), platform + metres(0.15), platform + metres(1.55), 0);
  panels(3, metres(0.55), platform + metres(1.75), platform + metres(2.6), Math.PI / 3);
}

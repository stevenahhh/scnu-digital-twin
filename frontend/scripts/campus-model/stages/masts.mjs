// Lattice mast stage: free-standing telecom masts the SCNU 360 VR tour shows off campus (data/lattice-masts.json), each a
// square four-leg lattice tapering from baseWidthMetres to topWidthMetres, cut into panels about PANEL_M tall with a ring
// beam and X braces on every face, painted in `bands` alternating obstruction colours (the first colour at both ends),
// an antenna platform at platformAt of the height carrying six panel antennas, and a lightning rod on top. A mast stands
// on the roof of the context mass (stages/context.mjs) whose outline holds its foot (on a light core block plinthMetres
// tall when given), else on the ground. Vertex-coloured
// beams on one material; one node per mast, Context_Mast_<id> (or Context_Far_Mast_<id> beyond CONTEXT_REACH, like the
// context tiles). Not selectable; every value is an estimate (추정).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENT, geoToModel, metres } from "../lib/frame.mjs";
import { pointInRing } from "../lib/geometry.mjs";
import { MeshData } from "../lib/meshData.mjs";
import { CONTEXT_REACH } from "./context.mjs";

export const MASTS_FILE = process.env.LATTICE_MASTS_FILE ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "lattice-masts.json");
const PANEL_M = 2.5;
const LEG_M = 0.18;
const BRACE_M = 0.07;
const PLATFORM_COLOUR = [176, 180, 184, 255];
const ANTENNA_COLOUR = [232, 233, 230, 255];
const PLINTH_COLOUR = [226, 224, 216, 255];

const hexRgba = (hex) => [...[1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)), 255];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// Square-section beam from a to b (scene units), half width w, flat-shaded faces.
function beam(mesh, a, b, w, colour) {
  const d = unit(sub(b, a));
  const ref = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit(cross(d, ref));
  const e2 = unit(cross(d, e1));
  const corner = (p, s1, s2) => add(add(p, e1, s1 * w), e2, s2 * w);
  const ring = (p) => [corner(p, -1, -1), corner(p, 1, -1), corner(p, 1, 1), corner(p, -1, 1)];
  const [ra, rb] = [ring(a), ring(b)];
  for (let k = 0; k < 4; k += 1) {
    const j = (k + 1) % 4;
    face(mesh, [ra[k], ra[j], rb[j], rb[k]], colour);
  }
  face(mesh, [ra[3], ra[2], ra[1], ra[0]], colour);
  face(mesh, [rb[0], rb[1], rb[2], rb[3]], colour);
}

function face(mesh, [p0, p1, p2, p3], colour) {
  const n = unit(cross(sub(p1, p0), sub(p3, p0)));
  const base = mesh.vertexCount;
  for (const p of [p0, p1, p2, p3]) mesh.vertex(p, n, undefined, colour);
  mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// The mast's mesh (scene units) standing on `base` (y) at the model point `at` [x, z].
export function mastMesh(m, roof, [cx, cz]) {
  const mesh = new MeshData({ uvs: false, colors: true });
  // `plinthMetres`: the light core block the mast stands on, above the roof of its context mass
  const plinth = metres(m.plinthMetres ?? 0);
  if (plinth > 0) beam(mesh, [cx, roof, cz], [cx, roof + plinth, cz], metres(m.baseWidthMetres / 2 + 1), PLINTH_COLOUR);
  const base = roof + plinth;
  const height = metres(m.heightMetres);
  const colours = m.colours.map(hexRgba);
  const bandOf = (y) => colours[Math.min(m.bands - 1, Math.floor(((y - base) / height) * m.bands)) % colours.length];
  const half = (y) => metres(m.baseWidthMetres / 2 + ((m.topWidthMetres - m.baseWidthMetres) / 2) * ((y - base) / height));
  const legAt = (k, y) => {
    const h = half(y);
    const [sx, sz] = [[-1, -1], [1, -1], [1, 1], [-1, 1]][k];
    return [cx + sx * h, y, cz + sz * h];
  };
  const panels = Math.max(2, Math.round(m.heightMetres / PANEL_M));
  for (let i = 0; i < panels; i += 1) {
    const [y0, y1] = [base + (height * i) / panels, base + (height * (i + 1)) / panels];
    const colour = bandOf((y0 + y1) / 2);
    for (let k = 0; k < 4; k += 1) {
      const j = (k + 1) % 4;
      beam(mesh, legAt(k, y0), legAt(k, y1), metres(LEG_M / 2), colour);
      beam(mesh, legAt(k, y1), legAt(j, y1), metres(BRACE_M / 2), colour);
      beam(mesh, legAt(k, y0), legAt(j, y1), metres(BRACE_M / 2), colour);
      beam(mesh, legAt(j, y0), legAt(k, y1), metres(BRACE_M / 2), colour);
    }
  }
  const platform = base + height * m.platformAt;
  const ph = half(platform) + metres(0.6);
  beam(mesh, [cx, platform, cz], [cx, platform + metres(0.15), cz], ph, PLATFORM_COLOUR);
  for (let k = 0; k < 6; k += 1) {
    const t = (k * Math.PI) / 3;
    const r = ph * 0.9;
    const p = [cx + r * Math.cos(t), platform + metres(0.2), cz + r * Math.sin(t)];
    beam(mesh, p, add(p, [0, 1, 0], metres(1.4)), metres(0.16), ANTENNA_COLOUR);
  }
  beam(mesh, [cx, base + height, cz], [cx, base + height + metres(1.5), cz], metres(0.04), colours[0]);
  return mesh;
}

// contextParts / groundAt: as stages/context.mjs buildContext.
export function buildMasts({ glb, parts, groundAt, masts = JSON.parse(readFileSync(MASTS_FILE, "utf8")).masts }) {
  if (!masts.length) return [];
  const material = glb.addMaterial({ name: "Context_Mast", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0.4, roughnessFactor: 0.6 } });
  const [mx, mz] = [(EXTENT.minX + EXTENT.maxX) / 2, (EXTENT.minZ + EXTENT.maxZ) / 2];
  return masts.map((m) => {
    const at = geoToModel(...m.at);
    const part = parts.find((p) => pointInRing(at, p.outer));
    const base = part ? Math.max(...part.outer.map(([x, z]) => groundAt(x, z))) + metres(part.heightMetres) : groundAt(...at);
    const mesh = mastMesh(m, base, at);
    const far = Math.hypot(at[0] - mx, at[1] - mz) > CONTEXT_REACH;
    const name = far ? `Context_Far_Mast_${m.id}` : `Context_Mast_${m.id}`;
    glb.addNode({ name, mesh: glb.addMesh(name, [mesh.toPrimitive(material)]),
      extras: { context: true, selectable: false, estimated: true, name: m.name, heightMetres: m.heightMetres, onRoof: Boolean(part), source: m.source } }, { root: true });
    const stats = { id: m.id, name, onRoof: Boolean(part), roofMetres: part ? +part.heightMetres.toFixed(1) : 0, heightMetres: m.heightMetres, triangles: mesh.indices.length / 3 };
    console.log(`mast ${m.id}: ${name}, ${stats.triangles} triangles, ${m.heightMetres} m (추정) on ${part ? `a ${stats.roofMetres} m context roof` : "the ground"}`);
    return stats;
  });
}

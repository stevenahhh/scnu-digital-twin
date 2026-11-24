// Editable ground nodes: the paved surfaces (stages/surfaces.mjs) and the road markings (stages/markings.mjs) leave the
// generator as one node per parcel, parcel group or marking element instead of one merged mesh per class. Every node
// carries extras.editable = { id, kind, category } like the object nodes of lib/objectNodes.mjs, its vertices relative
// to a base pivot (bbox centre x/z, bbox minimum y) held in the node's translation.
//
// Grouping keeps the draw calls near the furniture split's budget (one node per parcel would add ~4600 primitives):
//   sports, pavers, plaza, red road, bicycle  one node per parcel (each is a distinct painted or patterned surface)
//   hump tops                                 one node per hump (Ground_HumpTop_<id>; Ground_Hump_<id> holds its walls)
//   asphalt, campus lots                      one node per road way, junction, support road/lot or lot: the parcel id
//                                             without its part / row suffix
//   off-campus lots                           one node per OFF_CAMPUS_CELL_M plan cell (EPSG:5186)
//   aprons, walkways, gutters, tactile bands  one node per CELL_M plan cell (EPSG:5186)
//   road markings                             one node per marking object (a crossing, a stop line, an arrow, a text
//                                             glyph group, a lane line of one section); parking paint one node per lot
//
// Pivots are snapped to PIVOT_STEP scene units and the local positions are float32(world) - pivot, which float32 holds
// exactly: pivot + local reproduces the float32 world position bit for bit, so two parcels still meet on the same
// edge (the planar partition checks of check-ground-overlap.mjs and qa/d4Integration.mjs see no crack or overlap).
import { pivotOf } from "./objectNodes.mjs";

export const PIVOT_STEP = 1 / 1024;
export const CELL_M = 80;
export const OFF_CAMPUS_CELL_M = 150;

// three.js PropertyBinding.sanitizeNodeName drops everything else from a node name.
export const nodeName = (prefix, id) => `${prefix}_${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;

export const snapPivot = (pivot) => pivot.map((v) => Math.round(v / PIVOT_STEP) * PIVOT_STEP);

// float32(world) - pivot: exact in float32 for a pivot on the PIVOT_STEP grid near the positions.
export function rebaseExact(positions, pivot) {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 1) out[i] = Math.fround(positions[i]) - pivot[i % 3];
  return out;
}

// mesh class -> [editable kind, rule]
const SURFACE_RULES = {
  Ground_Sports: ["sports", "parcel"],
  Ground_Pavers: ["pavers", "parcel"],
  Ground_Plaza: ["plaza", "parcel"],
  Ground_RedRoad: ["red_road", "parcel"],
  Ground_Bicycle: ["bicycle", "parcel"],
  Ground_Hump: ["hump", "hump"],
  Ground_Asphalt: ["asphalt", "base"],
  Ground_Lot: ["lot", "base"],
  Ground_Apron: ["apron", "cell"],
  Ground_Walkway: ["walkway", "cell"],
  Ground_Gutter: ["gutter", "cell"],
  Ground_Tactile: ["tactile", "cell"],
};
const OFF_CAMPUS_LOT = /^PARCEL_LOT_OFF_CAMPUS_/;

// The parcel id without the suffix of a part (_PART_n), a row (_Rn) or a numbered piece of a way / support polygon.
const baseParcel = (id) => id
  .replace(/_PART_\d+$/, "")
  .replace(/_R\d+$/, "")
  .replace(/^(PARCEL_(?:ASPHALT_WAY|SUPPORT_ROAD|SUPPORT_LOT)_\d+)_\d+$/, "$1");

const cellId = (prefix, ring, size) => {
  const [E, N] = ring.reduce((sum, [e, n]) => [sum[0] + e / ring.length, sum[1] + n / ring.length], [0, 0]);
  return `${prefix}_E${Math.floor(E / size) * size}_N${Math.floor(N / size) * size}`;
};

// layer: a stages/surfaces.mjs layer (mesh class, parcel id, EPSG:5186 rings; humps carry humpId).
// Returns { id (extras.editable.id), kind, name (node and mesh name) }.
export function surfaceGroup(layer) {
  const rule = SURFACE_RULES[layer.mesh];
  if (!rule) throw new Error(`ground nodes: no node rule for the ${layer.mesh} layer ${layer.parcel ?? layer.source_ref ?? ""}`);
  const [kind, how] = rule;
  const prefix = layer.mesh.replace(/^Ground_/, "");
  let id;
  if (how === "hump") return { id: layer.humpId, kind, name: nodeName("Ground_HumpTop", layer.humpId) };
  if (how === "parcel") id = layer.parcel;
  else if (how === "base" && !OFF_CAMPUS_LOT.test(layer.parcel)) id = baseParcel(layer.parcel);
  else if (how === "base") id = cellId("LOT_OFF_CAMPUS", layer.rings[0], OFF_CAMPUS_CELL_M);
  else id = cellId(prefix.toUpperCase(), layer.rings[0], CELL_M);
  return { id, kind, name: nodeName(`Ground_${prefix}`, id) };
}

// piece: a stages/markings.mjs paint piece. Road paint goes by its marking object, parking paint (no object) by its lot;
// null for a piece with neither (the caller falls back to the piece's own paint id).
export function markingGroup(piece) {
  if (piece.objectId) return { id: piece.objectId, parking: false };
  if (piece.record?.startsWith("LOT_")) return { id: piece.record.split("/")[0], parking: true };
  if (piece.record) return { id: piece.record, parking: false };
  return null;
}

const MARKING_KIND = { zebra_bar: "crosswalk" };
// kinds: the piece kinds of one element, in drawing order; the most frequent names it (the first one on a tie).
export function markingKind(kinds, parking) {
  if (parking) return "parking";
  const counts = new Map();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const [top] = [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  return MARKING_KIND[top] ?? top;
}

// primitives: [{ positions (world, scene units), normals, uvs?, uv1? (TEXCOORD_1), indices, material }].
// Adds one root node (named `name`, its mesh too) in `collection` with the pivot as translation; returns the node index,
// or null when no primitive has a triangle.
export function emitGroundNode(glb, { name, id, kind, category, primitives, extras = {}, collection }) {
  const drawn = primitives.filter((p) => p.indices.length > 0);
  if (!drawn.length) return null;
  const pivot = snapPivot(pivotOf(drawn));
  const mesh = glb.addMesh(name, drawn.map((p) => ({
    positions: rebaseExact(p.positions, pivot),
    normals: Float32Array.from(p.normals),
    ...(p.uvs ? { uvs: Float32Array.from(p.uvs) } : {}),
    indices: p.indices,
    material: p.material,
  })));
  drawn.forEach((p, k) => {
    if (p.uv1) glb.json.meshes[mesh].primitives[k].attributes.TEXCOORD_1 = glb.addAccessor(Float32Array.from(p.uv1), "VEC2");
  });
  return glb.addNode({ name, mesh, translation: pivot, extras: { editable: { id, kind, category }, ...extras } }, { root: true, collection });
}

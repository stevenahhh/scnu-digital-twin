// Ground parcels (design §5; plan campus-ground-truth-redesign todo 9): data/ground/parcels.json is the one ground
// class map. stages/ground.mjs, stages/kerbs.mjs (closed kerb lines = walkway parcel boundaries), stages/tactile.mjs (via
// the kerb plan) and stages/surfaces.mjs (the Ground_* decals) read it instead of network/surfaces.mjs buildSurfaces.
//
// - designClass: the §5 class of a parcel (road | lot | sidewalk | plaza | lawn | court | track | water); paint (road
//   markings) is allowed on road and lot only.
// - parcelLayers: parcels -> the layer records the stages draw (rings = [ring, ...holes], the non-geometric layer
//   properties restored from `render`).
// - paintViolations: the §10.3 build invariant. A marking piece lies at its centroid; the topmost parcel there (highest
//   precedence, later record on a tie, as drawn) must allow paint. Pieces on no parcel (natural ground) violate too.
// - supportParcels: the curation step run by fit/parcelsSeed.mjs. Photo-detected paint on natural ground or on an
//   estimated (T4) paving parcel gets a road/lot parcel under it (paint proves pavement, the T4 class was a guess); paint
//   on a surveyed (T0/T1) non-road parcel is rejected and listed for exclusion, never painted over the survey.
// All coordinates are EPSG:5186 [E, N] metres.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PARCELS_PATH = path.join(HERE, "..", "data", "ground", "parcels.json");
export const DESIGN_CLASSES = Object.freeze(["road", "lot", "sidewalk", "plaza", "lawn", "planter", "court", "track", "water"]);
export const PAINT_CLASSES = new Set(["road", "lot"]);
// Supports: lot 4 and road 3 (the LOT and ASPHALT layer precedence, under the A003 sidewalks at 5); over an estimated
// apron or tile layer the support is raised above them (6.2) and kept to the piece's own footprint.
export const SUPPORT_PRECEDENCE = Object.freeze({ lot: 4, road: 3, raised: 6.2 });
const LOT_KINDS = new Set(["parking_line", "disabled_parking"]);
const LINK_M = 6; // pieces whose centroids are this close share one support parcel
const BUFFER_M = 0.5;

export function designClass(parcel) {
  const render = parcel.render ?? {};
  const kind = render.paint?.kind;
  switch (parcel.cls) {
    case "ASPHALT": return render.walkway ? "sidewalk" : "road";
    case "BICYCLE": return "sidewalk";
    case "LOT":
      if (parcel.mesh === "Ground_Apron") return "plaza";
      if (kind === "island") return "lawn";
      if (kind === "roundabout") return "road";
      return "lot";
    case "PAVING":
      if (kind === "tiles" || parcel.mesh === "Ground_Apron" || parcel.mesh === "Ground_Plaza") return "plaza";
      return render.walkway || parcel.mesh === "Ground_Walkway" ? "sidewalk" : "plaza";
    case "SPORTS":
      if (kind === "track") return "track";
      if (kind === "water" || kind === "fountain") return "water";
      return "court";
    default: throw new Error(`parcels: no design class for cls ${parcel.cls} (${parcel.id})`);
  }
}

export const loadParcels = (file = PARCELS_PATH) => JSON.parse(readFileSync(file, "utf8"));

// parcels -> stage layers, in file order (= draw order inside a precedence).
export function parcelLayers(parcels) {
  return parcels.map((p) => ({
    ...(p.render ?? {}),
    parcel: p.id, cls: p.cls, mesh: p.mesh, label: p.label, precedence: p.precedence, source: p.source, source_ref: p.source_ref,
    rings: [p.ring, ...p.holes],
  }));
}

// Kerb lines of the parcel map (stages/kerbs.mjs `outlines`): every ring of a walkway parcel (render.walkway, the A003
// sidewalks) as a closed line, then the open A003 lines the parcel map keeps in `kerbLines` (outline cuts with no area).
export function parcelOutlines(parcels, kerbLines = []) {
  const out = [];
  for (const p of parcels) {
    if (!p.render?.walkway) continue;
    for (const ring of [p.ring, ...p.holes]) out.push({ ufid: p.source_ref.split(";")[0], parcel: p.id, surface: p.render.surface, closed: true, line: [...ring, ring[0]] });
  }
  for (const k of kerbLines) out.push({ ufid: k.ufid, surface: k.surface, closed: false, line: k.line });
  return out;
}

// ---------------------------------------------------------------- geometry
const inRing = ([x, y], ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const bbox = (ring) => ring.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
const centroid = (ring) => ring.reduce((a, [x, y]) => [a[0] + x / ring.length, a[1] + y / ring.length], [0, 0]);
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// Convex hull (counter-clockwise) of points, then pushed out by `buffer` along each vertex's bisector.
function bufferedHull(points, buffer) {
  const pts = [...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out.at(-2), out.at(-1), p) <= 0) out.pop();
      out.push(p);
    }
    return out;
  };
  const lower = half(pts);
  const upper = half([...pts].reverse());
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  const c = centroid(hull);
  return hull.map(([x, y]) => {
    const d = Math.hypot(x - c[0], y - c[1]) || 1;
    return [r4(x + ((x - c[0]) / d) * buffer), r4(y + ((y - c[1]) / d) * buffer)];
  });
}

// ---------------------------------------------------------------- paint invariant
// toTm: piece coordinates -> [E, N] (the stage passes sceneToTm; tests pass identity).
export function pieceKey(piece, toTm) {
  const [E, N] = toTm(centroid(piece.rings[0]));
  return `${piece.id ?? piece.kind}@${E.toFixed(2)},${N.toFixed(2)}`;
}

function topParcelAt(parcels, boxes) {
  return (point) => {
    let top = null;
    parcels.forEach((p, i) => {
      const b = boxes[i];
      if (point[0] < b[0] || point[0] > b[2] || point[1] < b[1] || point[1] > b[3]) return;
      if (!inRing(point, p.ring) || p.holes.some((h) => inRing(point, h))) return;
      if (!top || p.precedence >= top.precedence) top = p;
    });
    return top;
  };
}

// Returns [{ piece: key, kind, parcel: id | null, cls: design class | null }] for every piece not on a paint parcel.
export function paintViolations(pieces, parcels, toTm) {
  const at = topParcelAt(parcels, parcels.map((p) => bbox(p.ring)));
  const out = [];
  for (const piece of pieces) {
    const top = at(toTm(centroid(piece.rings[0])));
    if (top && top.paintAllowed) continue;
    out.push({ piece: pieceKey(piece, toTm), kind: piece.kind, parcel: top?.id ?? null, cls: top ? top.class ?? designClass(top) : null });
  }
  return out;
}

// The build invariant (design §10.3): throws naming every piece on a parcel that does not allow paint, or on none.
// excluded: piece keys data/ground/parcels.json `paintExcluded` lists (paint the photo shows on surveyed non-road
// ground, left undrawn until todo 12/22 replace the photo markings).
export function assertPaintOnParcels(pieces, parcels, toTm, excluded = []) {
  const skip = new Set(excluded);
  const bad = paintViolations(pieces.filter((p) => !skip.has(pieceKey(p, toTm))), parcels, toTm);
  if (bad.length) {
    const list = bad.slice(0, 30).map((v) => `${v.piece} on ${v.parcel ? `${v.parcel} (${v.cls})` : "no parcel (natural ground)"}`).join("; ");
    throw new Error(`paint on ground that does not allow it (design §10.3), ${bad.length} pieces: ${list}${bad.length > 30 ? " ..." : ""}`);
  }
  return { checked: pieces.length, excluded: skip.size };
}

// ---------------------------------------------------------------- curation: support parcels
// pieces: drawn marking pieces; parcels: the current list. Returns { parcels (new support records), rejected (pieces
// on surveyed non-paint ground, as paintViolations entries) }.
export function supportParcels(pieces, parcels, toTm) {
  const at = topParcelAt(parcels, parcels.map((p) => bbox(p.ring)));
  const ground = [];
  const raised = [];
  const rejected = [];
  for (const piece of pieces) {
    const tm = piece.rings[0].map((q) => toTm(q));
    const c = centroid(tm);
    const top = at(c);
    if (top?.paintAllowed) continue;
    const entry = { piece, key: pieceKey(piece, toTm), tm, c };
    // only photo-detected paint proves pavement; an estimated piece on the wrong ground is rejected
    if (piece.estimated) rejected.push({ piece: entry.key, kind: piece.kind, parcel: top?.id ?? null, cls: top ? top.class ?? designClass(top) : null });
    else if (!top) ground.push(entry);
    else if (top.estimated) raised.push(entry);
    else rejected.push({ piece: entry.key, kind: piece.kind, parcel: top.id, cls: top.class ?? designClass(top) });
  }
  // single-linkage clusters of the natural-ground pieces
  const parent = ground.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < ground.length; i += 1) {
    for (let j = i + 1; j < ground.length; j += 1) {
      if (Math.hypot(ground[i].c[0] - ground[j].c[0], ground[i].c[1] - ground[j].c[1]) <= LINK_M) parent[root(j)] = root(i);
    }
  }
  const groups = new Map();
  ground.forEach((e, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), e]));
  const used = new Set(parcels.map((p) => p.id));
  const make = (entries, cls, precedence) => {
    const ring = bufferedHull(entries.flatMap((e) => e.tm), BUFFER_M);
    const [E, N] = centroid(ring);
    const base = `PARCEL_SUPPORT_${cls.toUpperCase()}_${Math.round(E)}_${Math.round(N)}`;
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base}_${n}`;
    used.add(id);
    const keys = entries.map((e) => e.key);
    return {
      id, cls: cls === "lot" ? "LOT" : "ASPHALT", class: cls, ring, holes: [], precedence,
      mesh: cls === "lot" ? "Ground_Lot" : "Ground_Asphalt", // label null: a support is a material layer only, so the label raster the lamps, trees and kerbs read stays as it
      // was (a hull can reach over a lamp root or a planter edge; lamps keep their placement contract)
      label: null,
      source: "photo-paint-support", source_ref: `paint support: ${keys.length} detected pieces (${keys.slice(0, 8).join(" ")}${keys.length > 8 ? " ..." : ""})`,
      evidence: { tier: "T1", refs: keys.slice(0, 40) },
      paintAllowed: true, estimated: true, curated: "todo 9",
    };
  };
  const classOf = (entries) => (entries.some((e) => LOT_KINDS.has(e.piece.kind)) ? "lot" : "road");
  const out = [];
  for (const entries of groups.values()) {
    const cls = classOf(entries);
    out.push(make(entries, cls, SUPPORT_PRECEDENCE[cls]));
  }
  for (const e of raised) out.push(make([e], classOf([e]), SUPPORT_PRECEDENCE.raised));
  return { parcels: out, rejected };
}

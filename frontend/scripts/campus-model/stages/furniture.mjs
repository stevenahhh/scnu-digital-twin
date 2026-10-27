// Furniture stage: every outdoor object of data/photo/objects-campus.geojson (the campus-wide NGII 2025 orthophoto
// survey, data/photo/README.md) at its surveyed position, with shapes, colours and heights estimated from the SCNU
// 360 VR tour (visual reference only), plus the VR-placed plaza benches. Standing poles stand at their photo pole bases
// (data/photo/pole-roots.json). Two merged primitives:
//   Furniture        opaque, vertex colours: walls, planters, the stands and their seats, the 구령대, shelters,
//                    pergolas, gazebos, poles and arms of lamps (stages/lights.mjs), signals, signs and floodlights,
//                    goals, hoops, benches, the footbridge, bins, the pond and the fountain.
//   Furniture_Glass  translucent, vertex colours with alpha, no shadow: shelter glass, translucent canopies, goal nets,
//                    mesh fences and ball-stop nets.
// The lit lenses of the traffic signals go into the Lamps_heads primitive (stages/lights.mjs) so they glow at night.
// loadFurniture() runs before the trees and the ground: it returns the footprints the trees keep out of.
// buildFurniture() runs after the ground, on the drawn terrain surface.
// Every height is an ESTIMATE (height_source per object in the GeoJSON, or the defaults below); the node extras list
// each object with its height and source.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simulationToTm, tmToScene } from "../../../src/geo/epsg5186.mjs";
import { METRES_PER_DEGREE_LAT, METRES_PER_DEGREE_LON, geoToModel, metres, modelToGeo } from "../lib/frame.mjs";
import { pointInRing, ringArea, ringCentroid } from "../lib/geometry.mjs";
import { glyphElements } from "../lib/markingGlyphs.mjs";
import { encodePng } from "../lib/png.mjs";
import { mulberry32 } from "../lib/raster.mjs";
import { Kit, along, bufferLine, frame, lineLength, local, localPlan, offsetLine, orientedRect, rgb, sub, toLocal } from "../lib/solids.mjs";
import { GLOW_UV, POLE_KINDS, appendLampSolids, objectDistance, roadNetwork, towardRoad } from "./lights.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OBJECTS = path.join(HERE, "..", "data", "photo", "objects-campus.geojson");
// VR-located rest spaces and the A19 gate sign (estimated; data/photo/README.md "VR rest spaces", README "Street
// furniture"), read after the survey; REST_SPACES_FILE swaps it (tests).
export const REST_SPACES = process.env.REST_SPACES_FILE ?? path.join(HERE, "..", "data", "photo", "rest-spaces.geojson");
const GROUND_FEATURES = path.join(HERE, "..", "data", "osm-ground.json");
// Standing-pole bases read from the photo (fetch/poleRoots.mjs): every lamp, signal, sign and floodlight pole of the
// survey stands at its root there; a pole the review rejects is left out. POLE_ROOTS_FILE swaps it (tests).
export const POLE_ROOTS = process.env.POLE_ROOTS_FILE ?? path.join(HERE, "..", "data", "photo", "pole-roots.json");
// By-eye outline check of shelters, fences, walls and planters on the photo: shift (offsetM [east, south] m) or reject.
// Main-gate islands and canopy traced on the photo (data/photo/README.md "Gate structures"); GATE_STRUCTURES_FILE swaps it.
export const GATE_STRUCTURES = process.env.GATE_STRUCTURES_FILE ?? path.join(HERE, "..", "data", "photo", "gate-structures.geojson");
// Lamps the VR shows and the photo survey missed (base from the photo shadow root); VR_LAMPS_FILE swaps it.
export const VR_LAMPS = process.env.VR_LAMPS_FILE ?? path.join(HERE, "..", "data", "photo", "vr-lamps.geojson");
// Ground-level site detail the VR stations show within about 40 m and the survey lacks (clipped hedges and shrub masses,
// kerbed lawn islands and tree pits, car-park stall rows and wheel stops, an entrance stair; street furniture: bollards,
// bike and PM stands, bins, handrails, signboards, entrance canopies; the a16 hedge lettering; the F1 LED screen), placed
// on the NGII 2025 photo or cast from registered VR faces with standard dimensions (estimated; data/photo/README.md "VR
// site detail" and its second pass); SITE_DETAIL_FILE swaps it (tests).
export const SITE_DETAIL = process.env.SITE_DETAIL_FILE ?? path.join(HERE, "..", "data", "photo", "site-detail.geojson");
export const OUTLINE_REVIEW = process.env.OUTLINE_REVIEW_FILE ?? path.join(HERE, "..", "data", "photo", "outline-review.json");
const M = metres;

// ---------------------------------------------------------------- decisions taken against the survey
// Each is documented in README "Street furniture"; the build log repeats them.
const EXCLUDED = {
  OC0109: "surveyed as a grey roofed shelter on the arterial's south footway, but VR scene_b1 l shows a long slanted banner board there and the NGII photo shows no roof, only the board's thin pale top edge beside a tree shadow: superseded by SD-B1-S2 (data/photo/site-detail.geojson, signboard)",
  OC0111: "SCNU letter monument: superseded by RS-GATE-A19 (data/photo/rest-spaces.geojson, gate_sign), placed from VR scene_a19 (and scene_001) about 13 m further south at the plaza's road edge; the 2025 photo shows that corner of the gate plaza under construction, so this survey position (VR only, confidence 0.2) is left out",
  OC0102: "E8 courtyard raised bed: superseded by RS0018 and RS0018A-C (data/photo/rest-spaces.geojson, planter); the survey drew one 7.7 x 8.8 m soil bed over the entrance walk and its steps, where VR scene_e8 f and the NGII 2025 photo show two L-shaped brick hedge beds beside the walk and hedge strips at the wing walls",
};
// A retype may carry props (merged over the survey's properties) for the catalogue builder that now draws the object.
const RETYPED = {
  OB0010: {
    kind: "stepped_arc",
    reason: "surveyed as a white roofed pergola, but VR scene_a19 shows no roof there, only the stepped arc of the finished gate plaza, and the photo shows a curved edge with a thin shadow; built as a two-tier curved step (0.45 m)",
  },
  OC0078: {
    kind: "pavilion_hip",
    reason: "VR scene_d4 l (cols 1250-1450): the garden 정자 has a brown square hip roof on four timber columns; drawn by the catalogue pavilion_hip builder (estimated)",
    props: { roofColour: "#6c4b37", trimColour: "#4f3627" },
  },
  OC0119: {
    kind: "terminal_shelter",
    reason: "VR scene_a4 r (cols 1100-2048): the school-bus terminal roof on two rows of white posts with inverted-U ribs, solar panels over its far part and a lattice screen at the back; drawn by the catalogue terminal_shelter builder (estimated)",
    props: { solar_from: 0.7, back_wall: true, dims: { widthM: 7.6, heightM: 3.0, postSpacingM: 4.0 } },
  },
  OC0120: {
    kind: "pavilion_hip",
    reason: "VR scene_a5 d (cols 1300-1900): the walled-garden 정자, silver-grey metal roof panels with blue fascia and hip caps; drawn by the catalogue pavilion_hip builder (estimated); it stands in the roof garden of A1 (roof_m 12.98: the wing roof, VR scene_a5 r/d over the parapet); BLD_A1 form mass 7 (the same 정자 as a 2.9 m box) is drawnBy OC0120",
    props: { roofColour: "#a3abb0", trimColour: "#1d6fe3", roof_m: 12.98 },
  },
  OC0121: {
    kind: "pavilion_octagon",
    reason: "VR scene_a5 r (cols 1450-1650): a teal octagonal cantilever parasol in three stepped tiers on a curved hook mast, a timber deck with a bench beside it; drawn by the catalogue pavilion_octagon builder (estimated); it stands in the roof garden of A1 (roof_m 12.98: the wing roof, VR scene_a5 r/d over the parapet); moved onto its photo disc (data/photo/objects-campus.geojson, position_note)",
    props: { roof_m: 12.98, support: "cantilever", tiers: 3, roofColour: "#1c8f86", trimColour: "#57b3a8", postColour: "#7a5a3c", bearing_deg: 90, deck: { lengthM: 3.2, widthM: 2.2, offsetM: [-2.6, 0.6], benchLengthM: 1.8, colour: "#8a4f36" }, dims: { eaveHeightM: 2.4, apexHeightM: 4.0, floorHeightM: 0 } },
  },
  OC0153: {
    kind: "canopy_shelter_row",
    reason: "VR scene_a6 l (cols 500-1550) and scene_a10 d/f (the 'striped awning' seen from above is this row): two bike shelters under striped blue and light-blue fabric hoods; drawn by the catalogue canopy_shelter_row builder (estimated)",
    props: { colours: ["#1f8be0", "#9fdcf5"], stripe_m: 1.0, dims: { moduleWidthM: 2.2, moduleLengthM: 5.0, heightM: 2.4 } },
  },
};
// The survey gives parasols and the kiosk its generic plaza_structure default of 0.5 m (height_source "kind default").
const SUBTYPE_HEIGHT_M = { parasol: 2.4, kiosk: 2.4 };
// The 3 x 3 lawn squares on the central plaza read almost flush in VR scene_c1 (a low kerb), not 0.5 m planters.
const PLAZA_PLANTER_KERB_M = 0.15;
// Outdoor steps and stepped terraces become steps only where the terrain carries the rise they climb.
const STEPS_MIN_RELIEF_M = 0.6;
const STEP_RISE_M = 0.16;

// ---------------------------------------------------------------- relief lean of the photo
// Roof outlines in the photo are displaced from their footprints (registration.json, gis_buildings lean field):
// lean (m per m of height) = L0 + LE (E - E0) / 100 + LN (N - N0) / 100 per axis, with (E0, N0) at lon 127.48, lat
// 34.969 (EPSG:5186 243835.0, 263761.0). Local metres stand in for the TM offsets (well under 0.1 % over the campus).
const LEAN_FIELD = { origin: [127.48, 34.969], east: [-0.02, -0.01285, -0.00121], north: [-0.0549, -0.01201, -0.06335] };
export function leanOffset([x, z], heightM) {
  const [lon, lat] = modelToGeo(x, z);
  const e = ((lon - LEAN_FIELD.origin[0]) * METRES_PER_DEGREE_LON) / 100;
  const n = ((lat - LEAN_FIELD.origin[1]) * METRES_PER_DEGREE_LAT) / 100;
  const east = LEAN_FIELD.east[0] + LEAN_FIELD.east[1] * e + LEAN_FIELD.east[2] * n;
  const north = LEAN_FIELD.north[0] + LEAN_FIELD.north[1] * e + LEAN_FIELD.north[2] * n;
  return [M(east * heightM), -M(north * heightM)];
}

const ROOFED = new Set(["bus_stop_shelter", "pergola", "gazebo", "bike_rack", "reviewing_stand", "stadium_seating", "trash_station", "pavilion_hip", "pavilion_octagon", "canopy_shelter_row", "terminal_shelter", "awning", "hut", "gate_canopy"]);
const ROOFED_SUBTYPES = new Set(["kiosk", "parasol"]);

// ---------------------------------------------------------------- palette (sRGB, estimated from VR and the photo)
const C = {
  concrete: rgb("#bab7af"), concreteDark: rgb("#8e8b84"), stone: rgb("#aca79c"), slate: rgb("#5f6d79"), white: rgb("#efefeb"),
  offWhite: rgb("#d9d7d0"), brick: rgb("#a5533f"), wood: rgb("#8d5f3c"), timber: rgb("#c38d58"), metal: rgb("#3c4044"),
  galvanised: rgb("#9ea4a8"), signalPole: rgb("#cdc7a3"), black: rgb("#1d1e20"), seatBlue: rgb("#2d80d2"), seatOrange: rgb("#eda036"),
  railBlue: rgb("#2b91c9"), railTeal: rgb("#1f9b9d"), turf: rgb("#4d9b4d"), canopyGreen: rgb("#4f8f63"), doorTeal: rgb("#23807d"),
  window: rgb("#3b4753"), lawn: rgb("#62964a"), soil: rgb("#6c5b46"), water: rgb("#53727b"), bronze: rgb("#6e8b79"), shrub: rgb("#3f7b3b"),
  roofBlue: rgb("#3063a7"), roofGrey: rgb("#8c9298"), roofYellow: rgb("#c9b274"), roofRed: rgb("#a9433b"), roofBrown: rgb("#6c4b37"),
  roofDark: rgb("#4a4f4c"), roofGreen: rgb("#3f6c50"), binBlue: rgb("#2e60a9"), goalWhite: rgb("#f3f3f3"), board: rgb("#70b6e1"),
  signBlue: rgb("#2b5dab"), hoopOrange: rgb("#d5571f"), tan: rgb("#c9aa7c"), brown: rgb("#8f6a4c"), red: rgb("#b4503f"), plazaBench: rgb("#2c4f74"),
  gravel: rgb("#a3927a"),
};
const GLASS = { pane: rgb("#c6dce5", 80), canopy: rgb("#e8eff3", 150), net: rgb("#2f5b3b", 75), mesh: rgb("#207e77", 95), goalNet: rgb("#f5f5f5", 75) };

const openRing = (ring) => {
  const last = ring.at(-1);
  return ring.length > 1 && last[0] === ring[0][0] && last[1] === ring[0][1] ? ring.slice(0, -1) : ring;
};
const disc = ([x, z], radius, n = 8) => Array.from({ length: n }, (_, i) => [x + Math.cos((i / n) * Math.PI * 2) * radius, z + Math.sin((i / n) * Math.PI * 2) * radius]);

function heightOf(p) {
  // Rest-space instances (data/rest-space-catalogue.json kinds) without a height of their own take their type's.
  if (p.height_m === undefined && REST_TYPES[p.kind]) return { heightM: restHeightM(p.kind, p.dims, p.id), heightSource: `catalogue ${p.kind} (estimated)` };
  if (p.height_m === undefined && p.kind === "signboard") return { heightM: (p.clearance_m ?? SIGNBOARD.clearanceM) + (p.panel_m ?? SIGNBOARD.panelM), heightSource: "signboard defaults (estimated)" };
  if (SUBTYPE_HEIGHT_M[p.subtype] && /kind default/.test(p.height_source ?? "")) return { heightM: SUBTYPE_HEIGHT_M[p.subtype], heightSource: `subtype default for a ${p.subtype} (the survey's ${p.height_m} m is its plaza_structure default)` };
  if (p.kind === "plaza_structure" && p.subtype === "planter") return { heightM: PLAZA_PLANTER_KERB_M, heightSource: "VR scene_c1: lawn squares with a low kerb" };
  return { heightM: p.height_m, heightSource: p.height_source ?? "survey" };
}

// ---------------------------------------------------------------- load (before the trees and the ground)
export function loadFurniture() {
  const data = JSON.parse(readFileSync(OBJECTS, "utf8"));
  const rest = existsSync(REST_SPACES) ? JSON.parse(readFileSync(REST_SPACES, "utf8")) : { features: [] };
  const objects = [];
  const excluded = [];
  const ids = new Set();
  const outlineReview = existsSync(OUTLINE_REVIEW) ? JSON.parse(readFileSync(OUTLINE_REVIEW, "utf8")).reviews : {};
  const poleRoots = existsSync(POLE_ROOTS) ? new Map(JSON.parse(readFileSync(POLE_ROOTS, "utf8")).poles.map((q) => [q.id, q])) : new Map();
  const gate = existsSync(GATE_STRUCTURES) ? JSON.parse(readFileSync(GATE_STRUCTURES, "utf8")) : { features: [] };
  const features = [
    ...data.features.map((f) => ({ ...f, source: "survey" })),
    ...rest.features.map((f) => ({ ...f, source: "rest-spaces" })),
    ...(existsSync(SITE_DETAIL) ? JSON.parse(readFileSync(SITE_DETAIL, "utf8")).features : []).map((f) => ({ ...f, source: "site-detail" })),
    ...gate.features.map((f) => ({ ...f, source: "survey" })),
    ...(existsSync(VR_LAMPS) ? JSON.parse(readFileSync(VR_LAMPS, "utf8")).features : []).map((f) => ({ ...f, source: "survey" })),
  ];
  for (const { properties: raw, geometry: g, source } of features) {
    if (ids.has(raw.id)) throw new Error(`furniture: duplicate object id ${raw.id} (${source})`);
    ids.add(raw.id);
    if (EXCLUDED[raw.id]) {
      excluded.push({ id: raw.id, kind: raw.kind, reason: EXCLUDED[raw.id] });
      continue;
    }
    const p = RETYPED[raw.id]?.props ? { ...raw, ...RETYPED[raw.id].props } : raw;
    const outline = outlineReview[raw.id];
    if (outline?.verdict === "reject") {
      excluded.push({ id: raw.id, kind: raw.kind, reason: `outline review: ${outline.note}` });
      continue;
    }
    const [shiftX, shiftZ] = outline?.verdict === "shift" ? [M(outline.offsetM[0]), M(outline.offsetM[1])] : [0, 0];
    const toModel = ([lon, lat]) => {
      const [x, z] = geoToModel(lon, lat);
      return [x + shiftX, z + shiftZ];
    };
    const object = { id: p.id, kind: RETYPED[p.id]?.kind ?? p.kind, surveyKind: p.kind, subtype: p.subtype ?? null, source, p, ...heightOf(p) };
    if (g.type === "Point") object.point = toModel(g.coordinates);
    else if (g.type === "LineString") object.line = g.coordinates.map(toModel);
    else object.ring = openRing(g.coordinates[0].map(toModel));
    const pole = POLE_KINDS.has(object.kind) && g.type === "Point" ? poleRoots.get(p.id) : undefined;
    if (pole?.verdict === "rejected") {
      excluded.push({ id: p.id, kind: p.kind, reason: `pole review: ${pole.note}` });
      continue;
    }
    if (outline) object.outline = { verdict: outline.verdict, offsetM: outline.offsetM ?? [0, 0] };
    if (!pole && p.pole_verdict) object.pole = { verdict: p.pole_verdict, shiftM: 0, residualM: p.residual_m ?? null, site: null };
    if (pole) {
      if (pole.root) object.point = geoToModel(...pole.root);
      object.pole = { verdict: pole.verdict, shiftM: pole.shiftM ?? 0, residualM: pole.residualM ?? null, site: pole.site ?? null };
    }
    // Roofs were outlined on the photo, so they include the relief lean; the footprint is the outline moved back. A rest
    // space placed from the VR alone (photo_support "none") has no photo outline: its outline is the footprint.
    if ((ROOFED.has(object.kind) || ROOFED_SUBTYPES.has(object.subtype)) && (object.ring || object.line) && p.photo_support === "none") {
      object.footprint = object.ring ?? bufferLine(object.line, M((p.width_m ?? 2) / 2));
      if (object.line) object.axis = object.line;
      object.leanM = 0;
    } else if ((ROOFED.has(object.kind) || ROOFED_SUBTYPES.has(object.subtype)) && (object.ring || object.line)) {
      object.photoRing = object.ring ?? bufferLine(object.line, M((p.width_m ?? 2) / 2));
      // on a roof (roof_m) the photo roof stands roof_m higher, so it leans further
      const [dx, dz] = leanOffset(ringCentroid(object.photoRing), object.heightM + (p.roof_m ?? 0));
      object.footprint = object.photoRing.map(([x, z]) => [x - dx, z - dz]);
      if (object.line) object.axis = object.line.map(([x, z]) => [x - dx, z - dz]);
      object.leanM = Math.hypot(dx, dz) / M(1);
    }
    objects.push(object);
  }

  const sun = data.properties.sun_estimate;
  const treeBlock = [
    ...objects.filter((o) => o.footprint).map((o) => o.footprint),
    ...objects.filter((o) => ["pond", "fountain"].includes(o.subtype)).map((o) => o.ring),
  ];
  const stadium = JSON.parse(readFileSync(GROUND_FEATURES, "utf8")).osm.features.find((f) => f.kind === "stadium");
  const fieldCentre = stadium ? ringCentroid(stadium.rings[0].map(([lon, lat]) => geoToModel(lon, lat))) : null;
  // The 구령대 is also a GIS building record (운동장 본부석); the buildings stage leaves its generic mass out for it.
  const detailedStructures = objects.filter((o) => o.kind === "reviewing_stand").map((o) => o.footprint);
  return { objects, excluded, retyped: RETYPED, treeBlock, detailedStructures, fieldCentre, sun };
}

// ---------------------------------------------------------------- building helpers
export function makeContext({ groundAt, objects, roads, sites, fieldCentre }) {
  const solid = new Kit();
  const screen = new Kit({ uvs: true });
  const glass = new Kit();
  const water = new Kit();
  const glow = new Kit({ uvs: true });
  const samples = (ring) => [...ring, ringCentroid(ring), ...ring.map((p, i) => [(p[0] + ring[(i + 1) % ring.length][0]) / 2, (p[1] + ring[(i + 1) % ring.length][1]) / 2])];
  const heights = (ring) => samples(ring).map(([x, z]) => groundAt(x, z)).sort((a, b) => a - b);
  return {
    solid, glass, water, glow, screen, screens: [], groundAt, objects, roads, sites, fieldCentre, colours: C,
    byId: new Map(objects.map((o) => [o.id, o])),
    minGround: (ring) => heights(ring)[0],
    maxGround: (ring) => heights(ring).at(-1),
    medianGround: (ring) => heights(ring)[Math.floor(heights(ring).length / 2)],
    skipped: [],
  };
}

// Resample a polyline so no piece is longer than `maxM` metres (terrain-following parts stay on the ground).
function densify(line, maxM) {
  const out = [line[0]];
  for (let i = 1; i < line.length; i += 1) {
    const [ax, az] = line[i - 1];
    const [bx, bz] = line[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / M(maxM)));
    for (let k = 1; k <= n; k += 1) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

// Wall along a polyline: thickness and height in metres, `offsetM` to the left of the line, top `heightM` above the
// local ground (or above `baseAt` when given), bottom sunk 0.08 m into the ground.
function wall(ctx, kit, line, thicknessM, heightM, paint, { offsetM = 0, closed = false, baseM = 0 } = {}) {
  const points = densify(closed ? [...line, line[0]] : line, 4);
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1e-6) continue;
    const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const v = [-u[1], u[0]];
    const extA = closed || i > 0 ? M(thicknessM / 2) : 0;
    const extB = closed || i + 2 < points.length ? M(thicknessM / 2) : 0;
    const A = [a[0] - u[0] * extA, a[1] - u[1] * extA];
    const B = [b[0] + u[0] * extB, b[1] + u[1] * extB];
    const corner = (p, t, top) => {
      const q = [p[0] + v[0] * M(t), p[1] + v[1] * M(t)];
      const g = ctx.groundAt(q[0], q[1]);
      return [q[0], top ? g + M(baseM + heightM) : g + M(baseM) - (baseM === 0 ? M(0.08) : 0), q[1]];
    };
    const t0 = offsetM - thicknessM / 2;
    const t1 = offsetM + thicknessM / 2;
    kit.hexa([corner(A, t0, false), corner(B, t0, false), corner(B, t1, false), corner(A, t1, false), corner(A, t0, true), corner(B, t0, true), corner(B, t1, true), corner(A, t1, true)], paint);
  }
}

// Posts every `stepM` and horizontal rails at the given fractions of the height, plus an optional translucent panel
// (mesh fences, nets). The base follows the ground (raised by baseM), or sits at the absolute height baseY (scene
// units) on a structure.
function railing(ctx, line, heightM, paint, { stepM = 2, rails = [1, 0.5], postM = 0.07, railM = 0.06, panel = null, baseM = 0, baseY = null } = {}) {
  const posts = along(line, M(stepM)).map(({ p }) => p);
  const top = (p) => baseY ?? ctx.groundAt(p[0], p[1]) + M(baseM);
  const sunk = baseY === null && baseM === 0 ? M(0.1) : 0;
  for (const p of posts) ctx.solid.pole(p, top(p) - sunk, top(p) + M(heightM), postM / 2 + 0.005, postM / 2, paint, { sides: 4 });
  for (let i = 0; i + 1 < posts.length; i += 1) {
    const a = posts[i];
    const b = posts[i + 1];
    for (const k of rails) ctx.solid.beam([a[0], top(a) + M(heightM * k), a[1]], [b[0], top(b) + M(heightM * k), b[1]], railM, railM, paint, { ends: false });
    if (panel) {
      const y0 = M(0.05);
      ctx.glass.face([[a[0], top(a) + y0, a[1]], [b[0], top(b) + y0, b[1]], [b[0], top(b) + M(heightM), b[1]], [a[0], top(a) + M(heightM), a[1]]], [-(b[1] - a[1]), 0, b[0] - a[0]], panel);
    }
  }
}

// Bench in a local frame (u along the seat, +t in front of the sitter), length in metres.
function benchAt(ctx, f, lengthM, { back = true, seat = ctx.colours.wood, legs = ctx.colours.metal, depthM = 0.46 } = {}) {
  const hl = lengthM / 2;
  const d = depthM / 2;
  for (const s of [-hl + 0.15, hl - 0.15]) ctx.solid.box(f, [s - 0.04, s + 0.04], [-d, d - 0.04], [-0.05, 0.4], legs);
  ctx.solid.box(f, [-hl, hl], [-d, d], [0.4, 0.46], seat);
  if (back) {
    for (const s of [-hl + 0.15, hl - 0.15]) ctx.solid.box(f, [s - 0.035, s + 0.035], [-d - 0.06, -d + 0.01], [0.46, 0.84], legs);
    ctx.solid.box(f, [-hl, hl], [-d - 0.08, -d - 0.02], [0.52, 0.84], seat);
  }
}

// Frame on a plan point whose +t side faces `toward` (plan point) — used to face benches, goals and stands.
function facingFrame(ctx, [x, z], u, toward) {
  const f = frame([x, ctx.groundAt(x, z), z], u);
  const [, t] = toLocal(f, toward);
  return t >= 0 ? f : frame([x, ctx.groundAt(x, z), z], [-u[0], -u[1]]);
}

// s-range of a plan ring (local frame) along the line t = tm, or null.
function sRange(localRing, tm) {
  const hits = [];
  for (let i = 0; i < localRing.length; i += 1) {
    const [sa, ta] = localRing[i];
    const [sb, tb] = localRing[(i + 1) % localRing.length];
    if ((ta > tm) !== (tb > tm)) hits.push(sa + ((tm - ta) / (tb - ta)) * (sb - sa));
  }
  return hits.length >= 2 ? [Math.min(...hits), Math.max(...hits)] : null;
}

function clipHalf(poly, n, c) {
  const out = [];
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const dp = p[0] * n[0] + p[1] * n[1] - c;
    const dq = q[0] * n[0] + q[1] * n[1] - c;
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

// Which side of a ring is inside: +1 when the left of its first edge is inside.
function insideSign(ring) {
  const [a, b] = ring;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const probe = [(a[0] + b[0]) / 2 - ((b[1] - a[1]) / length) * M(0.05), (a[1] + b[1]) / 2 + ((b[0] - a[0]) / length) * M(0.05)];
  return pointInRing(probe, ring) ? 1 : -1;
}

const styleColour = (o, fallback) => {
  const text = `${o.p.style?.colour ?? ""} ${o.p.note ?? ""}`.toLowerCase();
  if (/blue/.test(text)) return C.roofBlue;
  if (/red/.test(text)) return C.roofRed;
  if (/yellow/.test(text)) return C.roofYellow;
  if (/brown/.test(text)) return C.roofBrown;
  if (/green/.test(text)) return C.roofGreen;
  if (/grey|gray/.test(text)) return C.roofGrey;
  if (/white/.test(text)) return C.white;
  if (/dark/.test(text)) return C.roofDark;
  return fallback;
};

// ---------------------------------------------------------------- rest spaces (data/rest-space-catalogue.json)
// Parametric pavilions, shelters and garden pieces. An instance (a rest-space feature, or a survey object retyped to a
// catalogue kind) sets `dims` overrides by catalogue name; every other dimension is its type's default. Every value is
// an estimate (추정): KDS 34 50 15 ranges, vendor envelopes and VR reading, named per type in its dimsSource.
const REST_TYPES = JSON.parse(readFileSync(path.join(HERE, "..", "data", "rest-space-catalogue.json"), "utf8")).types;
const clampTo = (value, [lo, hi]) => Math.min(hi, Math.max(lo, value));

export function restDims(kind, given = {}, id = kind) {
  const type = REST_TYPES[kind];
  if (!type) throw new Error(`furniture: ${kind} is not a type of data/rest-space-catalogue.json (${id})`);
  for (const name of Object.keys(given)) if (!type.dims[name]) throw new Error(`furniture: ${id} sets ${name}, not a ${kind} dimension`);
  return Object.fromEntries(Object.entries(type.dims).map(([name, { default: value, range }]) => {
    const v = given[name] ?? value;
    if (!(v >= range[0] && v <= range[1])) throw new Error(`furniture: ${id} ${kind}.${name} ${v} lies outside the catalogue range ${range[0]}-${range[1]}`);
    return [name, v];
  }));
}
const dimsOf = (o) => restDims(o.kind, o.p.dims, o.id);
const HEIGHT_DIMS = ["ridgeHeightM", "apexHeightM", "heightM", "frontHeightM", "seatHeightM", "kerbHeightM"];
function restHeightM(kind, given, id) {
  const dims = restDims(kind, given, id);
  return dims[HEIGHT_DIMS.find((name) => name in dims)];
}

// Centre and long axis of an instance: from its outline (survey footprint or traced roof), else its point and
// bearing_deg (clockwise from north, default 0). lengthM/widthM are the outline's sizes (null for a point). ground is
// the median ground under the outline; dropM (metres) how far the lowest ground lies below it, so bases sunk by it
// reach the ground on a slope or across the raised walkway slab (stages/kerbs.mjs) instead of floating on its low side.
function restPlacement(ctx, o) {
  const ring = o.footprint ?? o.ring;
  if (ring) {
    const r = orientedRect(ring);
    const dropM = (ctx.medianGround(ring) - ctx.minGround(ring)) / M(1);
    if (o.p.bearing_deg === undefined) return { centre: r.centre, u: r.u, lengthM: 2 * r.halfLength, widthM: 2 * r.halfWidth, ground: ctx.medianGround(ring), dropM };
    const b = (o.p.bearing_deg * Math.PI) / 180;
    const u = [Math.sin(b), -Math.cos(b)];
    const along = Math.abs(u[0] * r.u[0] + u[1] * r.u[1]) >= Math.SQRT1_2;
    return { centre: r.centre, u, lengthM: 2 * (along ? r.halfLength : r.halfWidth), widthM: 2 * (along ? r.halfWidth : r.halfLength), ground: ctx.medianGround(ring), dropM };
  }
  if (!o.point) throw new Error(`furniture: ${o.kind} ${o.id} needs a Point or a Polygon`);
  const bearing = ((o.p.bearing_deg ?? 0) * Math.PI) / 180;
  return { centre: o.point, u: [Math.sin(bearing), -Math.cos(bearing)], lengthM: null, widthM: null, ground: ctx.groundAt(...o.point), dropM: 0 };
}

// Instance colours: "#rrggbb" or a palette name (C); absent -> fallback.
function paintOf(value, fallback, id) {
  if (value === undefined || value === null) return fallback;
  if (/^#[0-9a-f]{6}$/i.test(value)) return rgb(value);
  if (C[value]) return C[value];
  throw new Error(`furniture: ${id} colour ${value} is neither #rrggbb nor a palette name`);
}

// Hip roof over the local rectangle |s| <= hs, |t| <= ht from height h0 at the eaves to `top` (a pyramid when square):
// four planes of equal pitch in `paint`, the ridge along the longer side; `band` ({ paint, widthM }) lays an eave
// band along the lower edge of every plane (the blue edge of the scene_a5 roof).
function hipRoof(ctx, f, hs, ht, h0, top, paint, band = null) {
  const alongS = hs >= ht;
  const half = Math.abs(hs - ht);
  const ridgeEnd = ([s, t]) => (alongS ? [Math.sign(s) * half, 0] : [0, Math.sign(t) * half]);
  const corners = [[-hs, -ht], [hs, -ht], [hs, ht], [-hs, ht]];
  const middle = local(f, 0, 0, h0);
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const [ra, rb] = [ridgeEnd(a), ridgeEnd(b)];
    const plan = ra[0] === rb[0] && ra[1] === rb[1] ? [[...a, h0], [...b, h0], [...rb, top]] : [[...a, h0], [...b, h0], [...rb, top], [...ra, top]];
    const points = plan.map(([s, t, h]) => local(f, s, t, h));
    const centre = points.reduce((acc, p) => [acc[0] + p[0] / points.length, acc[1] + p[1] / points.length, acc[2] + p[2] / points.length], [0, 0, 0]);
    ctx.solid.face(points, sub(centre, middle), paint);
    if (band) {
      const k = band.widthM / Math.min(hs, ht);
      const up = (corner, end) => [corner[0] + (end[0] - corner[0]) * k, corner[1] + (end[1] - corner[1]) * k, h0 + (top - h0) * k + 0.01];
      const strip = [[...a, h0 + 0.01], [...b, h0 + 0.01], up(b, rb), up(a, ra)].map(([s, t, h]) => local(f, s, t, h));
      ctx.solid.face(strip, sub(centre, middle), band.paint);
    }
  }
  return { corners, ridgeEnd };
}

// Axis of a rest space drawn along a line (rows, long roofs, awnings).
// Axis of a row kind: its LineString (lean-corrected for roofs), else the long centreline of its outline (a survey roof
// retyped to a row kind).
function axisOf(o) {
  const line = o.axis ?? o.line;
  if (line) return line;
  const ring = o.footprint ?? o.ring;
  if (!ring) throw new Error(`furniture: ${o.kind} ${o.id} needs a LineString axis, not a Point`);
  const r = orientedRect(ring);
  const [dx, dz] = [r.u[0] * M(r.halfLength), r.u[1] * M(r.halfLength)];
  return [[r.centre[0] - dx, r.centre[1] - dz], [r.centre[0] + dx, r.centre[1] + dz]];
}

// Rest-space candidates that would draw an existing object twice: within radiusM of an object of the same class (all
// roofed kinds are one class, the rest go by kind, street lamps included). Returns [{ id, other, kind, distanceM }].
const dedupClass = (kind, subtype) => (ROOFED.has(kind) ? "roofed" : kind === "plaza_structure" ? `${kind}/${subtype}` : kind);
export function duplicatesOf(candidates, existing, radiusM = 3) {
  const found = [];
  for (const o of candidates) {
    const outline = o.footprint ?? o.ring;
    const at = o.point ?? (outline ? ringCentroid(outline) : [(o.line[0][0] + o.line.at(-1)[0]) / 2, (o.line[0][1] + o.line.at(-1)[1]) / 2]);
    for (const other of existing) {
      if (other.id === o.id || dedupClass(other.kind, other.subtype) !== dedupClass(o.kind, o.subtype)) continue;
      const distanceM = objectDistance(at, other) / M(1);
      if (distanceM < radiusM) found.push({ id: o.id, other: other.id, kind: o.kind, distanceM: Number(distanceM.toFixed(2)) });
    }
  }
  return found;
}

// Whole-set duplicate audit: every pair of the same class (roofed kinds one class, the rest by kind) closer than
// radiusM among the drawn objects (survey and rest spaces), the lamps (surveyed and estimated) and the estimated benches.
// Returns [{ id, other, kind, distanceM }] once per pair.
// Survey pairs that touch by design (one structure surveyed in parts) are listed, not counted.
export const AUDIT_COMPOUNDS = {
  "SD-A1RG-T1+SD-A1RG-T6": "a small round-crowned tree between the two boxed trees of the A1 roof garden (VR scene_a5 r)",
  "SD-A1RG-T2+SD-A1RG-T6": "a small round-crowned tree between the two boxed trees of the A1 roof garden (VR scene_a5 r)",
  "SD-A1RG-S3+SD-A1RG-T8": "a clipped shrub under the broadleaf tree beside the parasol (VR scene_a5 r)",
  "SD-A1RG-S6+SD-A1RG-T7": "a clipped shrub mass under the tall broadleaf tree east of the room (VR scene_a5 r)",
  "SD-F1-IS2+SD-F1-IT1": "a low shrub beside the pine on the F1 forecourt island (VR scene_f1 f, photo crowns)",
  "SD-F1-IS2+SD-F1-IT2": "a low shrub beside the small tree on the F1 forecourt island (VR scene_f1 f, photo crowns)",
  "OC0064+OC0065": "the two crossing bars of one X-shaped pergola in the pocket park",
  "SD-E1-B1+SD-E1-B3": "timber block benches grouped on the e1 plaza (VR scene_e1 f)",
  "SD-E1-B2+SD-E1-B3": "timber block benches grouped on the e1 plaza (VR scene_e1 f)",
  "SD-E1-B4+SD-E1-B5": "a pair of timber block benches on the e1 plaza (VR scene_e1 f)",
  "SD-A6-02+SD-A6-W1": "wheel stops added to the stall row beside SD-A6-02 (VR scene_a6 f)",
  "SD-B2-B1+SD-B2-B2": "a bench and a box bench at one planter (VR scene_b2 f)",
  "SD-B4-T1+SD-B4-T2": "two clipped shrub mounds side by side (VR scene_b4 l)",
  "SD-B7-PL1+SD-B7-PL2": "a pair of planter boxes at one door (VR scene_b7 b)",
  "SD-B7-T1+SD-B7-T2": "the conifers of the two planter boxes (VR scene_b7 b)",
  "SD-A6-H1+SD-A6-H2": "the two handrails of one ramp (VR scene_a6 f)",
  "SD-A10-S1+SD-A10-S2": "two hooded notice boards side by side (VR scene_a10 r)",
  "SD-A17-P1+SD-A17-P2": "a pair of bollards at one car park entrance (VR scene_a17 b)",
  "SD-E3-06+SD-E3-07": "a clipped shrub and the small ball beside it (VR scene_e3 d)",
};
export function auditDuplicates(objects, lamps = [], benches = [], radiusM = 3) {
  const items = [
    ...objects.filter((o) => o.kind !== "street_lamp"),
    ...lamps.map((lamp) => ({ id: lamp.id, kind: "street_lamp", point: lamp.at })),
    ...benches.map((bench, i) => ({ id: `EB${String(i + 1).padStart(3, "0")}`, kind: "bench", point: bench.at })),
  ];
  return duplicatesOf(items, items, radiusM).filter(({ id, other }) => id < other && !AUDIT_COMPOUNDS[`${id}+${other}`]);
}

// Fabric stripes across a length: equal bands about widthM wide, colour index alternating 0, 1, 0, ...
export function stripeBands(lengthM, widthM) {
  const n = Math.max(1, Math.round(lengthM / widthM));
  return Array.from({ length: n }, (_, k) => ({ s0: (lengthM * k) / n, s1: (lengthM * (k + 1)) / n, colour: k % 2 }));
}

// A face seen from both sides (canopies and fabric are open underneath).
function twoSided(ctx, points, outward, paint, underPaint = paint) {
  ctx.solid.face(points, outward, paint);
  ctx.solid.face(points, [-outward[0], -outward[1], -outward[2]], underPaint);
}

// ---------------------------------------------------------------- builders, one per kind
export const B = {};

B.low_wall = (ctx, o) => {
  if (o.p.dims !== undefined) {
    // rest-space low wall (VR scene_a9: red-brick planter walls): catalogue thickness and height, colour per instance
    const d = dimsOf(o);
    wall(ctx, ctx.solid, o.line, d.thicknessM, d.heightM, paintOf(o.p.colour, C.concrete, o.id));
    return;
  }
  const curvedPlaza = o.id === "OB0024"; // VR scene_c1: blue-grey coping around the red terrace
  const colour = curvedPlaza ? C.slate : /white/.test(o.p.note ?? "") ? C.white : C.concrete;
  wall(ctx, ctx.solid, o.line, 0.3, o.heightM, colour);
};

B.retaining_wall = (ctx, o) => {
  const stone = /stone/.test(o.p.note ?? "");
  wall(ctx, ctx.solid, o.line, 0.4, o.heightM, stone ? C.stone : C.concreteDark);
  if (/railing/.test(o.p.note ?? "")) railing(ctx, o.line, 1.1, C.galvanised, { baseM: o.heightM, rails: [1, 0.5] });
};

B.fence = (ctx, o) => {
  const h = o.heightM;
  if (o.subtype === "ball_stop_net") railing(ctx, o.line, h, C.galvanised, { stepM: 3, rails: [1, 0.5, 0.02], postM: 0.09, panel: GLASS.net });
  else if (o.subtype === "mesh") railing(ctx, o.line, h, /teal/.test(o.p.note ?? "") ? C.railTeal : C.roofGreen, { stepM: 2.5, rails: [1, 0.03], panel: /teal/.test(o.p.note ?? "") ? GLASS.mesh : GLASS.net });
  else railing(ctx, o.line, Math.min(h, 1.2), C.white, { stepM: 2, rails: [1, 0.55, 0.12] });
};

// Patchy turf on a rest-space planter (site-detail `tones`: sRGB tones; VR scene_a5 r, autumn turf on the A1 roof): one
// shared-vertex grid tone_cell_m (0.6 m) apart, 2 cm over the bed's fill, its vertex colours a smooth blend of the tones
// by two octaves of value noise tone_scale_m (4 m) across, so the patches fade into each other with no cell edges; worn
// turf (wear_tone) within wear_m (0.8 m) of the centre line of a paving_path named in wear_paths, fading out to twice
// that; the grid fades into the bed's own tone over its outer cell. mound_m (VR scene_f1 f: the F1 forecourt island)
// raises the grid into a low mound, mound_m at mound_ramp_m (2.5 m) from the bed's edge and over, a smoothstep between.
export function moundAt(o, inner, q) {
  if (!o.p.mound_m) return 0;
  let edge = Infinity;
  for (let i = 0; i < inner.length; i += 1) edge = Math.min(edge, segmentDistance(q, inner[i], inner[(i + 1) % inner.length]));
  const t = Math.min(1, edge / M(o.p.mound_ramp_m ?? 2.5));
  return M(o.p.mound_m) * t * t * (3 - 2 * t);
}
function segmentDistance(q, a, b) {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dz);
}
const smooth01 = (t) => t * t * (3 - 2 * t);
const lattice = (i, j, seed) => (Math.imul(Math.imul(i + 4096, 73856093) ^ Math.imul(j + 4096, 19349663) ^ seed, 2654435761) >>> 0) / 4294967296;
// value noise in [0, 1]: lattice values at whole multiples of `size`, smoothstep-blended between them
function valueNoise(x, z, size, seed) {
  const [u, v] = [x / size, z / size];
  const [i, j] = [Math.floor(u), Math.floor(v)];
  const [fu, fv] = [smooth01(u - i), smooth01(v - j)];
  const top = lattice(i, j, seed) * (1 - fu) + lattice(i + 1, j, seed) * fu;
  const bottom = lattice(i, j + 1, seed) * (1 - fu) + lattice(i + 1, j + 1, seed) * fu;
  return top * (1 - fv) + bottom * fv;
}
const mixPaint = (a, b, t) => [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * t)).concat(255);
function lawnPatches(ctx, o, inner, fillTop, base) {
  const tones = o.p.tones.map((t) => paintOf(t, C.lawn, o.id));
  const wear = paintOf(o.p.wear_tone, C.soil, o.id);
  const paths = (o.p.wear_paths ?? []).map((id) => {
    const p = ctx.objects.find((q) => q.id === id);
    if (p?.kind !== "paving_path") throw new Error(`furniture: ${o.id} wear path ${id} is not a paving_path`);
    return p.line;
  });
  const wearM = M(o.p.wear_m ?? 0.8);
  const pathDistance = (q) => Math.min(Infinity, ...paths.flatMap((line) => line.slice(1).map((b, i) => segmentDistance(q, line[i], b))));
  const edgeDistance = (q) => Math.min(...inner.map((a, i) => segmentDistance(q, a, inner[(i + 1) % inner.length])));
  const cell = M(o.p.tone_cell_m ?? 0.6);
  const size = M(o.p.tone_scale_m ?? 4);
  const colourAt = (q) => {
    const n = Math.min(0.999, Math.max(0, 0.65 * valueNoise(q[0], q[1], size, 11) + 0.35 * valueNoise(q[0], q[1], size / 2.7, 29)));
    const s = n * (tones.length - 1);
    const k = Math.floor(s);
    let c = mixPaint(tones[k], tones[Math.min(k + 1, tones.length - 1)], smooth01(s - k));
    if (paths.length) c = mixPaint(c, wear, 1 - smooth01(Math.min(1, Math.max(0, (pathDistance(q) - wearM) / wearM))));
    return mixPaint(base, c, Math.min(1, edgeDistance(q) / cell));
  };
  const xs = inner.map((p) => p[0]);
  const zs = inner.map((p) => p[1]);
  const [i0, j0] = [Math.floor(Math.min(...xs) / cell), Math.floor(Math.min(...zs) / cell)];
  const [i1, j1] = [Math.ceil(Math.max(...xs) / cell), Math.ceil(Math.max(...zs) / cell)];
  const nodes = new Map();
  const node = (i, j) => {
    const key = `${i},${j}`;
    if (!nodes.has(key)) {
      const q = [i * cell, j * cell];
      nodes.set(key, ctx.solid.mesh.vertex([q[0], fillTop(...q) + M(0.02) + moundAt(o, inner, q), q[1]], [0, 1, 0], undefined, colourAt(q)));
    }
    return nodes.get(key);
  };
  for (let i = i0; i < i1; i += 1) {
    for (let j = j0; j < j1; j += 1) {
      if (![[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].every(([a, b]) => pointInRing([a * cell, b * cell], inner))) continue;
      const [a, b, c, d] = [node(i, j), node(i + 1, j), node(i + 1, j + 1), node(i, j + 1)];
      ctx.solid.mesh.triangle(a, d, c); // (x0,z0) (x0,z1) (x1,z1): faces up
      ctx.solid.mesh.triangle(a, c, b);
    }
  }
}

B.planter = (ctx, o) => {
  if (o.p.dims !== undefined) {
    // rest-space planter (VR scene_a9 / scene_c1: square tree pits with a stone kerb, gravel or soil inside): a kerb
    // 0.2 m wide and kerbHeightM high round the ring, the fill 0.05 m below its top; along a line, a kerb wall.
    const d = dimsOf(o);
    const kerb = paintOf(o.p.colour, C.stone, o.id);
    if (o.line) {
      wall(ctx, ctx.solid, o.line, 0.3, d.kerbHeightM, kerb);
      return;
    }
    const fill = { lawn: C.lawn, soil: C.soil, gravel: C.gravel, shrub: C.shrub }[o.p.fill ?? "soil"];
    if (!fill) throw new Error(`furniture: planter ${o.id} fill ${o.p.fill} is not lawn, soil, gravel or shrub`);
    const inner = offsetLine([...o.ring, o.ring[0]], insideSign(o.ring) * M(0.2)).slice(0, -1);
    const kerbTop = (x, z) => ctx.groundAt(x, z) + M(d.kerbHeightM);
    const fillTop = (x, z) => ctx.groundAt(x, z) + M(Math.max(0.02, d.kerbHeightM - 0.05));
    ctx.solid.prism(o.ring, ctx.minGround(o.ring) - M(0.1), kerbTop, kerb, { topFace: false });
    ctx.solid.flat(o.ring, [inner], kerbTop, kerb);
    const middle = ringCentroid(inner);
    for (let i = 0; i < inner.length; i += 1) {
      const [p, q] = [inner[i], inner[(i + 1) % inner.length]];
      const toMiddle = [middle[0] - (p[0] + q[0]) / 2, 0, middle[1] - (p[1] + q[1]) / 2];
      ctx.solid.face([[p[0], fillTop(...p), p[1]], [q[0], fillTop(...q), q[1]], [q[0], kerbTop(...q), q[1]], [p[0], kerbTop(...p), p[1]]], toMiddle, kerb);
    }
    // under patchy turf the bed takes its second tone, so the seams between cells and the kerb read as turf
    const bed = o.p.tones ? paintOf(o.p.tones[1] ?? o.p.tones[0], fill, o.id) : fill;
    ctx.solid.flat(inner, [], fillTop, bed);
    if (o.p.tones) lawnPatches(ctx, o, inner, fillTop, bed);
    return;
  }
  if (o.line) {
    wall(ctx, ctx.solid, o.line, 0.3, o.heightM, /red/.test(o.p.note ?? "") ? C.brick : C.stone);
    return;
  }
  const base = ctx.minGround(o.ring) - M(0.1);
  ctx.solid.prism(o.ring, base, (x, z) => ctx.groundAt(x, z) + M(o.heightM), { side: C.stone, top: /tree|lawn|shrub|planted/.test(o.p.note ?? "") ? C.lawn : C.soil });
};

B.bench = (ctx, o) => {
  const [a, b] = [o.line[0], o.line.at(-1)];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) / M(1);
  const u = [(b[0] - a[0]) / (length * M(1)), (b[1] - a[1]) / (length * M(1))];
  const long = /long|stand/.test(o.p.note ?? "");
  // rest-space bench rows (VR scene_c1: long dark box benches beside the tree pits; scene_a9: timber benches): one
  // bench of catalogue lengthM every spacing_m along the line, centred on it; style "box" draws the backless box bench
  const rest = o.p.dims !== undefined ? dimsOf(o) : null;
  const spacing = o.p.spacing_m;
  const count = spacing ? Math.floor(length / spacing + 1e-9) + 1 : long ? 1 : Math.max(1, Math.round(length / 2.4));
  const each = rest ? rest.lengthM : long ? length : Math.min(1.8, length / count - 0.3);
  const style = !rest ? { back: !long, seat: long ? C.white : C.wood }
    : o.p.style === "box" ? { back: false, seat: paintOf(o.p.colour, C.plazaBench, o.id), legs: paintOf(o.p.colour, C.plazaBench, o.id), depthM: rest.depthM }
    : { back: o.p.back ?? true, seat: paintOf(o.p.colour, C.wood, o.id), depthM: rest.depthM };
  for (let k = 0; k < count; k += 1) {
    const pos = spacing ? ((length - (count - 1) * spacing) / 2 + k * spacing) / length : (k + 0.5) / count;
    const c = [a[0] + (b[0] - a[0]) * pos, a[1] + (b[1] - a[1]) * pos];
    const side = [c[0] - u[1] * M(1), c[1] + u[0] * M(1)];
    const paved = ctx.sites.inArea(side) || [ctx.sites.classes.PAVING, ctx.sites.classes.ASPHALT].includes(ctx.sites.labelAt(side));
    const f = facingFrame(ctx, c, u, paved ? side : [c[0] + u[1] * M(1), c[1] - u[0] * M(1)]);
    benchAt(ctx, f, each, style);
  }
  return { benches: count };
};

// Bus shelters (posts, roof, glass back and side panes, bench), court shelters (no glass) and the long school-bus
// canopy (posts every 5 m, translucent roof).
B.bus_stop_shelter = (ctx, o) => {
  const r = orientedRect(o.footprint);
  const g = ctx.medianGround(o.footprint);
  const h = o.heightM;
  if (r.halfLength * r.halfWidth * 4 > 60) {
    const f = frame([r.centre[0], g, r.centre[1]], r.u);
    const hl = r.halfLength;
    const hw = r.halfWidth;
    for (const t of [-hw + 0.3, hw - 0.3]) {
      for (let s = -hl + 0.3; s <= hl - 0.29; s += (2 * hl - 0.6) / Math.max(1, Math.round((2 * hl - 0.6) / 5))) {
        const p = localPlan(f, s, t);
        ctx.solid.pole(p, ctx.groundAt(...p) - M(0.1), g + M(h - 0.15), 0.07, 0.07, C.galvanised, { sides: 6 });
        ctx.solid.box(f, [s - 0.06, s + 0.06], [-hw + 0.2, hw - 0.2], [h - 0.25, h - 0.15], C.galvanised);
      }
      ctx.solid.box(f, [-hl, hl], [t - 0.1, t + 0.1], [h - 0.3, h - 0.12], C.white);
    }
    ctx.glass.face([local(f, -hl, -hw, h - 0.1), local(f, hl, -hw, h - 0.1), local(f, hl, hw, h - 0.1), local(f, -hl, hw, h - 0.1)], [0, 1, 0], GLASS.canopy);
    return;
  }
  const toRoad = towardRoad(r.centre, ctx.roads) ?? [-r.u[1], r.u[0]];
  const f = facingFrame(ctx, r.centre, r.u, [r.centre[0] + toRoad[0] * M(5), r.centre[1] + toRoad[1] * M(5)]);
  f.o[1] = g;
  const hl = r.halfLength;
  const hw = r.halfWidth;
  for (const s of [-hl + 0.15, hl - 0.15]) {
    for (const t of [-hw + 0.15, hw - 0.25]) ctx.solid.box(f, [s - 0.05, s + 0.05], [t - 0.05, t + 0.05], [-0.1, h - 0.12], C.metal);
  }
  ctx.solid.box(f, [-hl, hl], [-hw, hw], [h - 0.14, h], { top: styleColour(o, C.roofGrey), side: C.offWhite, bottom: C.offWhite }, { bottom: true });
  if (o.subtype !== "court_shelter") {
    const pane = (a, b) => ctx.glass.face([local(f, a[0], a[1], 0.15), local(f, b[0], b[1], 0.15), local(f, b[0], b[1], h - 0.3), local(f, a[0], a[1], h - 0.3)], [0, 0, 1], GLASS.pane);
    pane([-hl + 0.2, -hw + 0.15], [hl - 0.2, -hw + 0.15]);
    pane([-hl + 0.15, -hw + 0.2], [-hl + 0.15, 0]);
    pane([hl - 0.15, -hw + 0.2], [hl - 0.15, 0]);
  }
  benchAt(ctx, frame(local(f, 0, -hw + 0.5, 0), f.u), Math.min(2.4, 2 * hl - 0.6), { back: false, seat: C.galvanised, depthM: 0.4 });
};

// Covered rows (VR scene_a6 l: two bike shelters, each a striped blue and light-blue fabric hood with a front valance
// on thin galvanised frames): modules about moduleLengthM long repeated along the axis (its straight chord), each
// moduleWidthM deep on four posts, its roof rising roofPitchDeg from the front (right of the axis) to the back, striped
// across every stripe_m (default 1.0 m) in `colours` [a, b] or plain in roofColour. Returns { modules }.
B.canopy_shelter_row = (ctx, o) => {
  const axis = axisOf(o);
  const d = dimsOf(o);
  const [a, b] = [axis[0], axis.at(-1)];
  const lengthM = lineLength(axis) / M(1);
  const modules = Math.max(1, Math.round(lengthM / d.moduleLengthM));
  const step = lengthM / modules;
  const colours = o.p.colours ? o.p.colours.map((c) => paintOf(c, null, o.id)) : [paintOf(o.p.roofColour, C.roofBlue, o.id)];
  const posts = paintOf(o.p.postColour, C.galvanised, o.id);
  const hw = d.moduleWidthM / 2;
  const rise = d.moduleWidthM * Math.tan((d.roofPitchDeg * Math.PI) / 180);
  const roofAt = (t) => d.heightM + (rise * (t + hw)) / (2 * hw);
  const along0 = frame([a[0], 0, a[1]], [b[0] - a[0], b[1] - a[1]]);
  for (let k = 0; k < modules; k += 1) {
    const [s0, s1] = [k * step + 0.15, (k + 1) * step - 0.15];
    const f = frame([a[0], ctx.groundAt(...localPlan(along0, (s0 + s1) / 2, 0)), a[1]], along0.u);
    for (const s of [s0 + 0.25, s1 - 0.25]) {
      for (const t of [-hw + 0.1, hw - 0.1]) ctx.solid.box(f, [s - 0.03, s + 0.03], [t - 0.03, t + 0.03], [-0.1, roofAt(t)], posts);
    }
    for (const t of [-hw + 0.1, hw - 0.1]) ctx.solid.box(f, [s0, s1], [t - 0.03, t + 0.03], [roofAt(t) - 0.08, roofAt(t)], posts);
    const [front, back] = [-hw - 0.1, hw + 0.1];
    for (const band of stripeBands(s1 - s0, o.p.stripe_m ?? 1.0)) {
      const [sa, sb] = [s0 + band.s0, s0 + band.s1];
      const paint = colours[band.colour % colours.length];
      twoSided(ctx, [local(f, sa, front, roofAt(front)), local(f, sb, front, roofAt(front)), local(f, sb, back, roofAt(back)), local(f, sa, back, roofAt(back))], [0, 1, 0], paint);
      const valance = [local(f, sa, front, roofAt(front)), local(f, sb, front, roofAt(front)), local(f, sb, front - 0.12, roofAt(front) - 0.4), local(f, sa, front - 0.12, roofAt(front) - 0.4)];
      twoSided(ctx, valance, sub(local(f, 0, -1, 0), local(f, 0, 0, 0)), paint);
    }
  }
  return { modules };
};

// Long bus-terminal roof (VR scene_a4 r: two rows of white steel posts, white inverted-U ribs standing proud of a
// translucent white roof, a dark fascia along the front, blue bay plates on the front posts, solar panels over the far
// part and a white lattice screen at the back): posts every postSpacingM along the axis, widthM across, heightM to the
// roof; solar_from (0-1 along the axis) starts the panels, back_wall true adds the screen (left of the axis).
B.terminal_shelter = (ctx, o) => {
  const axis = axisOf(o);
  const d = dimsOf(o);
  const half = d.widthM / 2;
  const h = d.heightM;
  const S = ctx.solid;
  const stations = along(axis, M(d.postSpacingM)).map(({ p, u }) => ({ p, u, n: [-u[1], u[0]], g: ctx.groundAt(...p) }));
  const at = ({ p, n, g }, side, offsetM, hM) => [p[0] + n[0] * M(side * offsetM), g + M(hM), p[1] + n[1] * M(side * offsetM)];
  stations.forEach((st, i) => {
    for (const side of [1, -1]) {
      const post = at(st, side, half - 0.3, 0);
      S.pole([post[0], post[2]], st.g - M(0.1), st.g + M(h), 0.07, 0.07, C.white, { sides: 6 });
    }
    const plate = frame(at(st, -1, half - 0.3, 0), st.u);
    S.box(plate, [-0.15, 0.15], [-0.12, -0.08], [1.6, 2.0], C.signBlue);
    // inverted-U rib above the roof
    const [l0, r0] = [at(st, 1, half + 0.1, h), at(st, -1, half + 0.1, h)];
    const [l1, r1] = [at(st, 1, half + 0.1, h + 0.35), at(st, -1, half + 0.1, h + 0.35)];
    S.beam(l0, l1, 0.08, 0.08, C.white);
    S.beam(r0, r1, 0.08, 0.08, C.white);
    S.beam(l1, r1, 0.08, 0.1, C.white);
    const next = stations[i + 1];
    if (!next) return;
    ctx.glass.face([at(st, 1, half + 0.15, h + 0.04), at(next, 1, half + 0.15, h + 0.04), at(next, -1, half + 0.15, h + 0.04), at(st, -1, half + 0.15, h + 0.04)], [0, 1, 0], GLASS.canopy);
    S.beam(at(st, 1, half - 0.3, h), at(next, 1, half - 0.3, h), 0.1, 0.16, C.white, { ends: false });
    S.beam(at(st, -1, half - 0.3, h), at(next, -1, half - 0.3, h), 0.1, 0.16, C.white, { ends: false });
    S.beam(at(st, -1, half + 0.15, h - 0.05), at(next, -1, half + 0.15, h - 0.05), 0.08, 0.3, C.slate, { ends: false });
    if (o.p.solar_from !== undefined && i / Math.max(1, stations.length - 2) >= o.p.solar_from) {
      // one tilted panel per bay, clear of the ribs
      const inset = (q, r, k) => [q[0] + (r[0] - q[0]) * k, q[1] + (r[1] - q[1]) * k, q[2] + (r[2] - q[2]) * k];
      const [a0, a1, b0, b1] = [at(st, 1, half * 0.7, h + 0.55), at(next, 1, half * 0.7, h + 0.55), at(st, -1, half * 0.7, h + 0.42), at(next, -1, half * 0.7, h + 0.42)];
      S.face([inset(a0, a1, 0.08), inset(a0, a1, 0.92), inset(b0, b1, 0.92), inset(b0, b1, 0.08)], [0, 1, 0], rgb("#26344a"));
    }
  });
  if (o.p.back_wall) railing(ctx, offsetLine(axis, M(half - 0.3)), 1.2, C.white, { stepM: 2, rails: [1, 0.05], panel: rgb("#f4f4f4", 140) });
};

// Striped fabric canopy (VR scene_a10 d/f: a long blue and light-blue striped tent over the walk beside the plaza, its
// ends hipped). profile "gable": the axis is the ridge, both eaves frontHeightM high depthM apart, 25 degree slopes,
// hipped ends, posts every 3 m along both eaves; profile "lean-to" (default): the axis is the facade line, the fabric
// falls 15 degrees from the wall to frontHeightM at depthM to its left, posts along the front. Stripes about
// stripeWidthM wide across the length alternate `colours` [a, b]; a 0.25 m valance hangs from every eave. Returns
// { stripes }.
B.awning = (ctx, o) => {
  const axis = axisOf(o);
  const d = dimsOf(o);
  const [a, b] = [axis[0], axis.at(-1)];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) / M(1);
  const f = frame([a[0], ctx.groundAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), a[1]], [b[0] - a[0], b[1] - a[1]]);
  const colours = (o.p.colours ?? ["#2a86dc", "#a8def4"]).map((c) => paintOf(c, null, o.id));
  const posts = paintOf(o.p.postColour, C.white, o.id);
  const H = d.frontHeightM;
  const bands = stripeBands(L, d.stripeWidthM);
  const outward = (t, h) => sub(local(f, 0, t, h), local(f, 0, 0, 0));
  const gable = o.p.profile === "gable";
  const [tFront, tBack] = gable ? [-d.depthM / 2, d.depthM / 2] : [0, d.depthM];
  const top = gable ? H + (d.depthM / 2) * Math.tan((25 * Math.PI) / 180) : H + d.depthM * Math.tan((15 * Math.PI) / 180);
  const hip = gable ? Math.min(d.depthM / 2, L / 2) : 0;
  // the upper edge of a gable slope at s (the hip line near the ends, the ridge between), as [t-fraction, h]
  const upper = (s) => {
    const k = hip > 0 ? Math.min(1, s / hip, (L - s) / hip) : 1;
    return [1 - k, H + (top - H) * k];
  };
  for (const band of bands) {
    const paint = colours[band.colour];
    if (gable) {
      const breaks = [hip, L - hip].filter((s) => s > band.s0 && s < band.s1).sort((x, y) => y - x);
      for (const side of [-1, 1]) {
        const t0 = side * (d.depthM / 2);
        const ups = [band.s1, ...breaks, band.s0].map((s) => {
          const [k, h] = upper(s);
          return local(f, s, t0 * k, h);
        });
        twoSided(ctx, [local(f, band.s0, t0, H), local(f, band.s1, t0, H), ...ups], outward(side, 1.5), paint);
      }
    } else {
      twoSided(ctx, [local(f, band.s0, tBack, H), local(f, band.s1, tBack, H), local(f, band.s1, tFront, top), local(f, band.s0, tFront, top)], outward(1, 1.5), paint);
    }
    for (const t of gable ? [tFront, tBack] : [tBack]) {
      twoSided(ctx, [local(f, band.s0, t, H), local(f, band.s1, t, H), local(f, band.s1, t, H - 0.25), local(f, band.s0, t, H - 0.25)], outward(Math.sign(t), 0), paint);
    }
  }
  if (gable) {
    twoSided(ctx, [local(f, 0, tFront, H), local(f, 0, tBack, H), local(f, hip, 0, top)], sub(local(f, -1, 0, H + 1), local(f, 0, 0, H)), colours[bands[0].colour]);
    twoSided(ctx, [local(f, L, tFront, H), local(f, L, tBack, H), local(f, L - hip, 0, top)], sub(local(f, L + 1, 0, H + 1), local(f, L, 0, H)), colours[bands.at(-1).colour]);
  }
  const count = Math.max(1, Math.ceil((L - 0.3) / 3));
  for (const t of gable ? [tFront, tBack] : [tBack]) {
    const inset = t > 0 ? t - 0.1 : t + 0.1;
    for (let k = 0; k <= count; k += 1) {
      const s = 0.15 + ((L - 0.3) * k) / count;
      ctx.solid.box(f, [s - 0.035, s + 0.035], [inset - 0.035, inset + 0.035], [-0.1, H - 0.02], posts);
    }
    ctx.solid.box(f, [0.1, L - 0.1], [inset - 0.03, inset + 0.03], [H - 0.08, H - 0.02], posts);
  }
  return { stripes: bands.length };
};

// Small closed booth (VR scene_f3 r: yellow timber siding under a red corrugated low gable roof, a white door and a
// glazed front): walls in wallColour, a door and a window on the front (-t), and a roof of form `roof` ("gable"
// default, "hip", "mono", "flat") in roofColour over a 0.3 m overhang; heightM is the top of the roof and roofRiseM
// its rise above the eaves. A survey outline is the roof seen on the photo: the plan is that outline less the overhang.
B.hut = (ctx, o) => {
  const d = dimsOf(o);
  const at = restPlacement(ctx, o);
  const ov = 0.3;
  const planOf = (roofM, name) => (o.p.dims?.[name] === undefined && roofM ? clampTo(roofM - 2 * ov, REST_TYPES.hut.dims[name].range) : d[name]);
  const hs = planOf(at.lengthM, "planWidthM") / 2;
  const ht = planOf(at.widthM, "planDepthM") / 2;
  const f = frame([at.centre[0], at.ground, at.centre[1]], at.u);
  const S = ctx.solid;
  const wall = paintOf(o.p.wallColour, C.offWhite, o.id);
  const roof = paintOf(o.p.roofColour, styleColour(o, C.roofRed), o.id);
  const top = d.heightM;
  const eave = top - d.roofRiseM;
  const [rs, rt] = [hs + ov, ht + ov];
  const form = o.p.roof ?? "gable";
  let wallTop = eave;
  if (form === "gable") {
    wallTop = eave + (d.roofRiseM * ov) / rt;
    for (const side of [-1, 1]) {
      twoSided(ctx, [local(f, -rs, side * rt, eave), local(f, rs, side * rt, eave), local(f, rs, 0, top), local(f, -rs, 0, top)], sub(local(f, 0, side, 1), local(f, 0, 0, 0)), roof, C.offWhite);
      S.face([local(f, side * hs, -ht, wallTop), local(f, side * hs, ht, wallTop), local(f, side * hs, 0, top)], sub(local(f, side, 0, 0), local(f, 0, 0, 0)), wall);
    }
  } else if (form === "hip") {
    wallTop = eave + (d.roofRiseM * ov) / Math.min(rs, rt);
    hipRoof(ctx, f, rs, rt, eave, top, roof);
  } else if (form === "mono") {
    const roofAt = (t) => eave + (d.roofRiseM * (t + rt)) / (2 * rt);
    wallTop = roofAt(-ht);
    twoSided(ctx, [local(f, -rs, -rt, eave), local(f, rs, -rt, eave), local(f, rs, rt, top), local(f, -rs, rt, top)], [0, 1, 0], roof, C.offWhite);
    for (const side of [-1, 1]) S.face([local(f, side * hs, -ht, wallTop), local(f, side * hs, ht, wallTop), local(f, side * hs, ht, roofAt(ht))], sub(local(f, side, 0, 0), local(f, 0, 0, 0)), wall);
    S.face([local(f, -hs, ht, wallTop), local(f, hs, ht, wallTop), local(f, hs, ht, roofAt(ht)), local(f, -hs, ht, roofAt(ht))], sub(local(f, 0, 1, 0), local(f, 0, 0, 0)), wall);
  } else if (form === "flat") {
    wallTop = top - 0.15;
    S.box(f, [-rs, rs], [-rt, rt], [top - 0.15, top], { top: roof, side: roof, bottom: C.offWhite }, { bottom: true });
  } else {
    throw new Error(`furniture: hut ${o.id} roof ${form} is not gable, hip, mono or flat`);
  }
  S.box(f, [-hs, hs], [-ht, ht], [-0.1 - at.dropM, wallTop], { top: wall, side: wall });
  const doorS = -hs + 0.75;
  S.box(f, [doorS - 0.45, doorS + 0.45], [-ht - 0.04, -ht], [0, Math.min(2.05, wallTop - 0.1)], paintOf(o.p.doorColour, C.white, o.id));
  if (hs - doorS > 1.6) S.box(f, [doorS + 0.8, hs - 0.5], [-ht - 0.04, -ht], [0.9, Math.min(2.0, wallTop - 0.15)], C.window);
};

// Pergolas along an axis (posts both sides, edge beams, slats or a solid roof) or over a polygon (posts along the
// boundary, solid roof).
function pergolaAlong(ctx, o, axis, widthM, { solidRoof, colour, roofColour }) {
  const h = o.heightM;
  const half = M(widthM / 2 - 0.15);
  for (const edge of [offsetLine(axis, half), offsetLine(axis, -half)]) {
    const posts = along(edge, M(3)).map(({ p }) => p);
    for (const p of posts) ctx.solid.pole(p, ctx.groundAt(...p) - M(0.1), ctx.groundAt(...p) + M(h - 0.1), 0.09, 0.09, colour, { sides: 4 });
    for (let i = 0; i + 1 < posts.length; i += 1) {
      const [a, b] = [posts[i], posts[i + 1]];
      ctx.solid.beam([a[0], ctx.groundAt(...a) + M(h - 0.1), a[1]], [b[0], ctx.groundAt(...b) + M(h - 0.1), b[1]], 0.12, 0.2, colour, { ends: false });
    }
  }
  if (solidRoof) {
    const roof = bufferLine(axis, M(widthM / 2 + 0.2));
    ctx.solid.prism(roof, (x, z) => ctx.groundAt(x, z) + M(h), (x, z) => ctx.groundAt(x, z) + M(h + 0.14), { side: roofColour, top: roofColour });
    ctx.solid.flat(roof, [], (x, z) => ctx.groundAt(x, z) + M(h), roofColour, { down: true });
    return;
  }
  for (const { p, u } of along(axis, M(0.55))) {
    const n = [-u[1], u[0]];
    const y = ctx.groundAt(...p) + M(h + 0.04);
    const a = [p[0] + n[0] * M(widthM / 2 + 0.15), y, p[1] + n[1] * M(widthM / 2 + 0.15)];
    const b = [p[0] - n[0] * M(widthM / 2 + 0.15), y, p[1] - n[1] * M(widthM / 2 + 0.15)];
    ctx.solid.beam(a, b, 0.07, 0.12, roofColour);
  }
}

B.pergola = (ctx, o) => {
  const note = `${o.p.note ?? ""} ${o.p.style?.colour ?? ""}`.toLowerCase();
  const colour = /timber|orange|beige/.test(note) ? C.timber : /red/.test(note) ? C.roofRed : /blue/.test(note) ? C.white : C.white;
  const roofColour = /red/.test(note) ? C.roofRed : /blue/.test(note) ? C.roofBlue : colour;
  const solidRoof = /roof|canopy/.test(note) && !/slatted/.test(note);
  if (o.axis) {
    pergolaAlong(ctx, o, o.axis, o.p.width_m ?? 2, { solidRoof, colour, roofColour });
    return;
  }
  const r = orientedRect(o.footprint);
  if (!solidRoof) {
    const axis = [localPlan(frame([r.centre[0], 0, r.centre[1]], r.u), -r.halfLength, 0), localPlan(frame([r.centre[0], 0, r.centre[1]], r.u), r.halfLength, 0)];
    pergolaAlong(ctx, o, axis, 2 * r.halfWidth, { solidRoof: false, colour: C.metal, roofColour: C.offWhite });
    return;
  }
  const h = o.heightM;
  const inner = offsetLine([...o.footprint, o.footprint[0]], insideSign(o.footprint) * M(0.35)).slice(0, -1);
  for (const { p } of along([...inner, inner[0]], M(3))) ctx.solid.pole(p, ctx.groundAt(...p) - M(0.1), ctx.groundAt(...p) + M(h), 0.09, 0.09, C.timber, { sides: 4 });
  ctx.solid.prism(o.footprint, (x, z) => ctx.groundAt(x, z) + M(h), (x, z) => ctx.groundAt(x, z) + M(h + 0.15), { side: roofColour, top: roofColour });
  ctx.solid.flat(o.footprint, [], (x, z) => ctx.groundAt(x, z) + M(h), roofColour, { down: true });
};

// Gate plaza arc (OB0010, retyped): a two-tier curved step over the surveyed 2 m band (0.2 m, then 0.45 m on the band
// inset 0.5 m from both edges).
B.stepped_arc = (ctx, o) => {
  const ring = o.ring;
  const base = ctx.minGround(ring) - M(0.1);
  ctx.solid.prism(ring, base, (x, z) => ctx.groundAt(x, z) + M(0.2), C.concrete);
  const inner = offsetLine([...ring, ring[0]], insideSign(ring) * M(0.5)).slice(0, -1);
  if (Math.abs(ringArea(inner)) > M(1) * M(1)) ctx.solid.prism(inner, base, (x, z) => ctx.groundAt(x, z) + M(0.45), { side: C.concrete, top: C.offWhite });
};

B.gazebo = (ctx, o) => {
  const ring = o.footprint;
  const round = ring.length >= 12;
  const g = ctx.medianGround(ring);
  const h = o.heightM;
  const eave = h * 0.7;
  const c = ringCentroid(ring);
  const roofColour = styleColour(o, C.roofBrown);
  const inset = offsetLine([...ring, ring[0]], insideSign(ring) * M(0.45)).slice(0, -1);
  ctx.solid.prism(inset, g - M(0.1), g + M(0.3), { side: C.stone, top: C.wood });
  const posts = round ? disc(c, Math.sqrt(Math.abs(ringArea(ring)) / Math.PI) - M(0.55), 6) : inset;
  for (const p of posts) ctx.solid.pole(p, g + M(0.3), g + M(eave), 0.1, 0.1, C.wood, { sides: 4 });
  const base = ring.map(([x, z]) => [x, g + M(eave), z]);
  ctx.solid.cone([c[0], g + M(h), c[1]], base, roofColour, { basePaint: C.wood });
};

// Square hip-roof 정자 (VR scene_d4 l: brown roof under the pines beside the D4 path; scene_a5 d: silver-grey metal
// panels with blue fascia and hip caps): a stone plinth with a timber deck floorHeightM high and a front step, four
// square timber columns with knee braces, an eave beam ring, railings on `railingSides` sides (back, left, right,
// front), and a hip roof over plan + 2 x roofOverhangM from the eaves (soffit and fascia) to ridgeHeightM. Colours:
// roofColour (panels), trimColour (fascia, hip caps), postColour. A survey outline is the roof seen on the photo, so
// without planWidthM/planDepthM the plan is that outline less the overhang, kept inside the catalogue range.
B.pavilion_hip = (ctx, o) => {
  const d = dimsOf(o);
  const at = restPlacement(ctx, o);
  const planOf = (roofM, name) => (o.p.dims?.[name] === undefined && roofM ? clampTo(roofM - 2 * d.roofOverhangM, REST_TYPES.pavilion_hip.dims[name].range) : d[name]);
  const hs = planOf(at.lengthM, "planWidthM") / 2;
  const ht = planOf(at.widthM, "planDepthM") / 2;
  const f = frame([at.centre[0], at.ground, at.centre[1]], at.u);
  const S = ctx.solid;
  const roof = paintOf(o.p.roofColour, styleColour(o, C.roofBrown), o.id);
  const trim = paintOf(o.p.trimColour, roof, o.id);
  const posts = paintOf(o.p.postColour, C.wood, o.id);
  const { floorHeightM: F, eaveHeightM: E, ridgeHeightM: R, columnSizeM: cs, roofOverhangM: ov, railingHeightM: rh } = d;
  if (F > 0) {
    S.box(f, [-hs, hs], [-ht, ht], [-0.1 - at.dropM, F - 0.06], C.stone);
    S.box(f, [-hs + 0.02, hs - 0.02], [-ht + 0.02, ht - 0.02], [F - 0.06, F], { top: C.timber, side: C.wood });
    if (F > 0.25) S.box(f, [-0.7, 0.7], [-ht - Math.min(0.4, ov), -ht], [-0.1 - at.dropM, F / 2], C.stone);
  }
  const cx = hs - cs / 2;
  const cz = ht - cs / 2;
  for (const s of [-cx, cx]) {
    for (const t of [-cz, cz]) {
      S.box(f, [s - cs / 2, s + cs / 2], [t - cs / 2, t + cs / 2], [F, E], posts);
      S.beam(local(f, s, t, E - 0.85), local(f, s - Math.sign(s) * 0.6, t, E - 0.3), 0.08, 0.08, posts);
      S.beam(local(f, s, t, E - 0.85), local(f, s, t - Math.sign(t) * 0.6, E - 0.3), 0.08, 0.08, posts);
    }
  }
  for (const t of [-cz, cz]) S.box(f, [-hs, hs], [t - 0.09, t + 0.09], [E - 0.3, E], posts);
  for (const s of [-cx, cx]) S.box(f, [s - 0.09, s + 0.09], [-ht, ht], [E - 0.3, E], posts);
  // railings: back (+t), left (-s), right (+s), front (-t); top rail, bottom rail and balusters every 0.3 m
  const sides = [["t", cz], ["s", -cx], ["s", cx], ["t", -cz]].slice(0, d.railingSides);
  for (const [axis, at0] of sides) {
    const span = axis === "t" ? cx : cz;
    const rail = (h0, h1, a0, a1, w) => (axis === "t" ? S.box(f, [a0, a1], [at0 - w, at0 + w], [h0, h1], C.timber) : S.box(f, [at0 - w, at0 + w], [a0, a1], [h0, h1], C.timber));
    rail(F + rh - 0.06, F + rh, -span, span, 0.05);
    rail(F + 0.06, F + 0.12, -span, span, 0.04);
    for (let a = -span + 0.3; a < span - 0.15; a += 0.3) rail(F + 0.12, F + rh - 0.06, a - 0.02, a + 0.02, 0.02);
  }
  // roof: soffit and fascia, then the hip planes and the caps along the hips (and the ridge), set just below the planes
  const fascia = 0.16;
  const [rs, rt] = [hs + ov, ht + ov];
  S.box(f, [-rs, rs], [-rt, rt], [E, E + fascia], { top: roof, side: trim, bottom: C.timber }, { bottom: true, top: false });
  const { corners, ridgeEnd } = hipRoof(ctx, f, rs, rt, E + fascia, R, roof, trim === roof ? null : { paint: trim, widthM: 0.3 });
  for (const corner of corners) {
    const [s1, t1] = ridgeEnd(corner);
    const run = Math.hypot(s1 - corner[0], t1 - corner[1]);
    const k = Math.min(0.5, 0.2 / run);
    const start = [corner[0] + (s1 - corner[0]) * k, corner[1] + (t1 - corner[1]) * k, E + fascia + (R - E - fascia) * k];
    S.beam(local(f, start[0], start[1], start[2] - 0.05), local(f, s1, t1, R - 0.05), 0.14, 0.1, trim);
  }
  const ridgeA = ridgeEnd([-1, -1]);
  const ridgeB = ridgeEnd([1, 1]);
  if (ridgeA[0] !== ridgeB[0] || ridgeA[1] !== ridgeB[1]) S.beam(local(f, ...ridgeA, R - 0.05), local(f, ...ridgeB, R - 0.05), 0.14, 0.1, trim);
};

// Octagonal gazebo (catalogue vendor envelope HD-S101 7.0 x 7.0 x H5.3 m; VR scene_a5 r shows the garden one as a teal
// octagonal canopy in three stepped tiers held by one offset mast): with support "posts" (default) eight columns on
// an optional raised octagonal deck and an eave ring, roof from the fascia at eaveHeightM to apexHeightM; with support
// "cantilever" a mast outside the canopy on a white pad that bends over the top into a hook ending on the canopy hub,
// the bend's crest at apexHeightM and the canopy apex CANTILEVER_HOOK_M below it. Roof: octagon of circumscribed
// diameter circumscribedM, one plane per side and tier; with tiers 2 or 3 every tier above the skirt starts
// OCTAGON_TIER_LIFT_M above the one below and overhangs its vent (dark riser), so the steps read from any side; ribs and
// tier fascias in trimColour. Optional deck { lengthM, widthM, offsetM: [s, t], benchLengthM } (VR scene_a5: a timber
// deck beside the mast with a timber bench under the canopy edge; estimated sizes) is drawn on the ground in the
// instance frame. A survey outline gives the diameter when circumscribedM is not set.
const OCTAGON_TIER_LIFT_M = 0.15;
const CANTILEVER_HOOK_M = 0.45;
const OCTAGON_TIER_RADII = { 1: [1], 2: [1, 0.5], 3: [1, 0.62, 0.32] };
B.pavilion_octagon = (ctx, o) => {
  const d = dimsOf(o);
  const at = restPlacement(ctx, o);
  const diameter = o.p.dims?.circumscribedM === undefined && at.lengthM ? clampTo(at.lengthM, REST_TYPES.pavilion_octagon.dims.circumscribedM.range) : d.circumscribedM;
  const R = diameter / 2;
  const f = frame([at.centre[0], at.ground, at.centre[1]], at.u);
  const S = ctx.solid;
  const roof = paintOf(o.p.roofColour, styleColour(o, C.roofGreen), o.id);
  const trim = paintOf(o.p.trimColour, roof, o.id);
  const posts = paintOf(o.p.postColour, C.wood, o.id);
  const { floorHeightM: F, eaveHeightM: E, apexHeightM: A, columnCount: n } = d;
  const angle = (i) => ((i + 0.5) / n) * Math.PI * 2;
  const planRing = (radius) => Array.from({ length: n }, (_, i) => localPlan(f, Math.cos(angle(i)) * radius, Math.sin(angle(i)) * radius));
  const ring = (radius, h) => Array.from({ length: n }, (_, i) => local(f, Math.cos(angle(i)) * radius, Math.sin(angle(i)) * radius, h));
  if (F > 0) {
    S.prism(planRing(R - 0.35), at.ground - M(0.1 + at.dropM), at.ground + M(F - 0.06), C.stone);
    S.prism(planRing(R - 0.37), at.ground + M(F - 0.06), at.ground + M(F), { side: C.wood, top: C.timber });
  }
  const cantilever = (o.p.support ?? "posts") === "cantilever";
  const top = cantilever ? A - CANTILEVER_HOOK_M : A;
  if (cantilever) {
    // mast on its pad, a quarter bend into the level crest (beam top at A), then the hook down onto the hub
    const mast = R + 0.35;
    const crest = A - 0.05;
    const bend = 0.6;
    const hook = 0.35;
    S.box(f, [mast - 0.8, mast + 0.8], [-0.8, 0.8], [-0.05, 0.12], C.offWhite);
    S.box(f, [mast - 0.22, mast + 0.22], [-0.22, 0.22], [0.12, 0.3], posts);
    S.pole(localPlan(f, mast, 0), ctx.groundAt(...localPlan(f, mast, 0)) - M(0.1), at.ground + M(crest - bend), 0.07, 0.065, posts, { cap: false });
    const arc = (cs, ch, r, a0, a1) => Array.from({ length: 7 }, (_, k) => {
      const t = a0 + ((a1 - a0) * k) / 6;
      return [cs + r * Math.cos(t), ch + r * Math.sin(t)];
    });
    const path = [...arc(mast - bend, crest - bend, bend, 0, Math.PI / 2), ...arc(hook, crest - hook, hook, Math.PI / 2, Math.PI), [0, top + 0.06]];
    for (let k = 0; k + 1 < path.length; k += 1) S.beam(local(f, path[k][0], 0, path[k][1]), local(f, path[k + 1][0], 0, path[k + 1][1]), 0.1, 0.1, posts, { ends: k === path.length - 2 });
    S.pole(localPlan(f, 0, 0), at.ground + M(top - 0.25), at.ground + M(top + 0.06), 0.12, 0.08, trim);
  } else {
    const columns = planRing(R - 0.55);
    for (const p of columns) S.pole(p, F > 0 ? at.ground + M(F) : ctx.groundAt(...p) - M(0.1), at.ground + M(E), d.columnSizeM / 2, d.columnSizeM / 2, posts, { sides: 4 });
    const tops = ring(R - 0.55, E - 0.12);
    for (let i = 0; i < n; i += 1) S.beam(tops[i], tops[(i + 1) % n], 0.14, 0.24, posts, { ends: false });
  }
  const fascia = 0.12;
  const band = (radius, h0, h1, paint) => {
    const lower = ring(radius, h0);
    const upper = ring(radius, h1);
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      const out = sub(local(f, Math.cos((angle(i) + angle(j)) / 2), Math.sin((angle(i) + angle(j)) / 2), h0), local(f, 0, 0, h0));
      S.face([lower[i], lower[j], upper[j], upper[i]], out, paint);
    }
  };
  band(R, E, E + fascia, trim);
  // tiers: outer radius Ro of each tier, inner ring 0.72 x the next tier's Ro (the last one closes at the apex); one pitch
  // for all tiers so the canopy rises from E + fascia to its top through every lift
  const radii = (OCTAGON_TIER_RADII[o.p.tiers ?? 1] ?? OCTAGON_TIER_RADII[1]).map((k) => k * R);
  const inner = radii.map((_, i) => (i + 1 < radii.length ? 0.72 * radii[i + 1] : 0));
  const lift = OCTAGON_TIER_LIFT_M;
  const run = radii.reduce((sum, r, i) => sum + r - inner[i], 0);
  const pitch = (top - E - fascia - lift * (radii.length - 1)) / run;
  if (pitch <= 0) throw new Error(`furniture: ${o.id} pavilion_octagon apex ${top} m leaves no pitch over the eave ${E} m`);
  const rib = (p, q) => S.beam([p[0], p[1] - M(0.04), p[2]], [q[0], q[1] - M(0.04), q[2]], 0.08, 0.07, trim, { ends: false });
  let h0 = E + fascia;
  radii.forEach((Ro, i) => {
    if (i > 0) band(Ro, h0 - 0.08, h0, trim);
    const h1 = h0 + (Ro - inner[i]) * pitch;
    const lower = ring(Ro, h0);
    if (inner[i] === 0) {
      const apex = local(f, 0, 0, h1);
      S.cone(apex, lower, roof, { basePaint: roof });
      for (const p of lower) rib(p, apex);
      return;
    }
    const upper = ring(inner[i], h1);
    for (let k = 0; k < n; k += 1) {
      const j = (k + 1) % n;
      const quad = [lower[k], lower[j], upper[j], upper[k]];
      const out = sub(local(f, Math.cos((angle(k) + angle(j)) / 2) * Ro, Math.sin((angle(k) + angle(j)) / 2) * Ro, h1 + Ro), local(f, 0, 0, h0));
      S.face(quad, out, roof);
      S.face(quad, [-out[0], -out[1], -out[2]], roof);
      rib(lower[k], upper[k]);
    }
    band(inner[i], h1, h1 + lift, C.metal);
    h0 = h1 + lift;
  });
  const deck = o.p.deck;
  if (deck) {
    const [ds, dt] = deck.offsetM ?? [0, 0];
    const df = frame(local(f, ds, dt, 0), f.u);
    const hl = deck.lengthM / 2;
    const hw = deck.widthM / 2;
    S.box(df, [-hl, hl], [-hw, hw], [-0.05, 0.12], { top: paintOf(deck.colour, C.wood, o.id), side: C.brown });
    for (let s = -hl + 0.15; s < hl; s += 0.15) S.box(df, [s - 0.004, s + 0.004], [-hw, hw], [0.12, 0.122], C.brown, { sides: [false, false, false, false] });
    if (deck.benchLengthM) benchAt(ctx, frame(local(df, 0, 0, 0.12), df.u), deck.benchLengthM, { back: false, seat: C.timber, legs: C.galvanised, depthM: 0.45 });
  }
};

// Traffic islands (main gate, data/photo/gate-structures.geojson): a raised kerb ring kerb_height_m high round the island
// outline (axis line buffered by width_m / 2, rounded ends), yellow paint on the kerb and a 0.18 m rim, a grey concrete top.
export function capsule(line, halfM, segments = 6) {
  const [a, b] = [line[0], line.at(-1)];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n = [-u[1], u[0]];
  const r = M(halfM);
  const ring = [];
  for (let k = 0; k <= segments; k += 1) {
    const t = -Math.PI / 2 + (k / segments) * Math.PI; // around the b end, from -n to +n
    ring.push([b[0] + (u[0] * Math.cos(t) - n[0] * Math.sin(t)) * r, b[1] + (u[1] * Math.cos(t) - n[1] * Math.sin(t)) * r]);
  }
  for (let k = 0; k <= segments; k += 1) {
    const t = Math.PI / 2 + (k / segments) * Math.PI; // around the a end
    ring.push([a[0] + (u[0] * Math.cos(t) - n[0] * Math.sin(t)) * r, a[1] + (u[1] * Math.cos(t) - n[1] * Math.sin(t)) * r]);
  }
  return ring;
}
B.traffic_island = (ctx, o) => {
  const ring = capsule(o.line, (o.p.width_m ?? 1.5) / 2);
  const g = ctx.minGround(ring);
  const kerbM = o.p.kerb_height_m ?? 0.15;
  const inner = offsetLine([...ring, ring[0]], insideSign(ring) * M(0.18)).slice(0, -1);
  ctx.solid.prism(ring, g - M(0.05), g + M(kerbM), paintOf(o.p.colour, C.roofYellow, o.id));
  // the concrete top inside the 0.18 m painted rim, a hair above the rim so the two never share a plane
  ctx.solid.prism(inner, g, g + M(kerbM + 0.01), paintOf(o.p.fill, C.concreteDark, o.id), { walls: false });
};

// Gate canopy (main gate): a flat panelled roof over the lanes on four posts, roof outline = the photo outline moved back by
// the relief lean (footprint), height from its shadow (estimated); colour the roof, postColour the posts and edge band.
B.gate_canopy = (ctx, o) => {
  const r = orientedRect(o.footprint);
  const f = frame([r.centre[0], ctx.minGround(o.footprint), r.centre[1]], r.u);
  const h = o.heightM;
  const roof = paintOf(o.p.colour, C.roofBlue, o.id);
  const post = paintOf(o.p.postColour, C.offWhite, o.id);
  const [hl, hw] = [r.halfLength, r.halfWidth];
  for (const s of [-hl + 0.3, hl - 0.3]) for (const t of [-hw + 0.3, hw - 0.3]) ctx.solid.box(f, [s - 0.15, s + 0.15], [t - 0.15, t + 0.15], [-0.1, h - 0.35], post);
  // edge band and roof slab are closed underneath: a driver looks up at the blue panels
  ctx.solid.box(f, [-hl, hl], [-hw, hw], [h - 0.35, h - 0.2], { top: post, side: post, bottom: roof }, { bottom: true });
  ctx.solid.box(f, [-hl, hl], [-hw, hw], [h - 0.2, h], { top: roof, side: post, bottom: roof }, { bottom: true });
};

B.bike_rack = (ctx, o) => {
  const r = orientedRect(o.footprint);
  const g = ctx.medianGround(o.footprint);
  const f = frame([r.centre[0], g, r.centre[1]], r.u);
  const hl = r.halfLength;
  const hw = r.halfWidth;
  const h = o.heightM;
  const translucent = /translucent/.test(o.p.note ?? "");
  const n = Math.max(1, Math.round((2 * hl - 0.4) / 3));
  for (let k = 0; k <= n; k += 1) {
    const s = -hl + 0.2 + ((2 * hl - 0.4) * k) / n;
    ctx.solid.box(f, [s - 0.05, s + 0.05], [-hw + 0.15, -hw + 0.25], [-0.1, h], C.metal);
    ctx.solid.box(f, [s - 0.05, s + 0.05], [hw - 0.25, hw - 0.15], [-0.1, h - 0.4], C.metal);
  }
  const roof = [local(f, -hl, -hw, h + 0.05), local(f, hl, -hw, h + 0.05), local(f, hl, hw, h - 0.35), local(f, -hl, hw, h - 0.35)];
  if (translucent) ctx.glass.face(roof, [0, 1, 0], GLASS.canopy);
  else {
    const under = roof.map((p) => [p[0], p[1] - M(0.08), p[2]]);
    ctx.solid.hexa([...under, ...roof], styleColour(o, C.roofBlue), { bottom: true });
  }
  for (let s = -hl + 0.6; s <= hl - 0.6; s += 0.9) {
    const a = local(f, s, -0.35, 0);
    const b = local(f, s, 0.35, 0);
    const a1 = local(f, s, -0.35, 0.8);
    const b1 = local(f, s, 0.35, 0.8);
    ctx.solid.beam(a, a1, 0.05, 0.05, C.galvanised);
    ctx.solid.beam(b, b1, 0.05, 0.05, C.galvanised);
    ctx.solid.beam(a1, b1, 0.05, 0.05, C.galvanised);
  }
};

B.trash_station = (ctx, o) => {
  const r = orientedRect(o.ring);
  const g = ctx.medianGround(o.ring);
  const f = frame([r.centre[0], g, r.centre[1]], r.u);
  const count = Math.max(1, Math.floor((2 * r.halfLength) / 1.35));
  const depth = Math.min(1.0, 2 * r.halfWidth);
  for (let k = 0; k < count; k += 1) {
    const s = -r.halfLength + 0.1 + k * 1.35;
    ctx.solid.box(f, [s, s + 1.2], [-depth / 2, depth / 2], [-0.05, o.heightM - 0.08], C.binBlue);
    ctx.solid.box(f, [s - 0.03, s + 1.23], [-depth / 2 - 0.03, depth / 2 + 0.03], [o.heightM - 0.08, o.heightM], C.signBlue);
  }
};

// 구령대 (VR scene_a15): white single-storey base with doors and windows toward the track, a turf terrace in four
// tiers rising to the back, a flat canopy (green roof in the photo, white fascia and soffit) on seven square columns,
// teal railings and two side stairs rising outward along the front.
B.reviewing_stand = (ctx, o) => {
  const ring = o.footprint;
  const r = orientedRect(ring);
  const g = ctx.medianGround(ring);
  const away = ctx.fieldCentre ? [2 * r.centre[0] - ctx.fieldCentre[0], 2 * r.centre[1] - ctx.fieldCentre[1]] : localPlan(frame([r.centre[0], 0, r.centre[1]], r.u), 0, 1);
  const f = facingFrame(ctx, r.centre, r.u, away);
  f.o[1] = g;
  const hl = r.halfLength;
  const hw = r.halfWidth;
  const W = 2 * hw;
  const S = ctx.solid;
  S.box(f, [-hl, hl], [-hw, hw], [-0.15, 3.0], C.white);
  for (const s of [-3.2, 0, 3.2]) S.box(f, [s - 0.8, s + 0.8], [-hw - 0.04, -hw], [0, 2.3], C.doorTeal);
  for (const s of [-hl + 2.2, -hl + 4.6, hl - 4.6, hl - 2.2]) S.box(f, [s - 0.9, s + 0.9], [-hw - 0.04, -hw], [1.2, 2.3], C.window);
  const tiers = [[0, 0.3, 3.06], [0.3, 0.45, 3.4], [0.45, 0.6, 3.74], [0.6, 1, 4.08]];
  for (const [a, b, top] of tiers) S.box(f, [-hl, hl], [-hw + a * W, -hw + b * W], [3.0, top], { top: C.turf, side: C.turf });
  const columns = 7;
  for (let k = 0; k < columns; k += 1) {
    const s = -hl + 0.7 + ((2 * hl - 1.4) * k) / (columns - 1);
    S.box(f, [s - 0.3, s + 0.3], [hw - 0.9, hw - 0.3], [4.08, 6.4], C.white);
  }
  S.box(f, [-hl - 0.25, hl + 0.25], [-hw + 0.3 * W, hw + 0.3], [6.4, 6.95], { top: C.canopyGreen, side: C.white, bottom: C.white }, { bottom: true });
  const terraceRail = (s0, t0, s1, t1, base) => railing(ctx, [localPlan(f, s0, t0), localPlan(f, s1, t1)], 1.0, C.railTeal, { baseY: g + M(base), stepM: 1.5, rails: [1, 0.5] });
  terraceRail(-hl + 0.1, -hw + 0.1, hl - 0.1, -hw + 0.1, 3.06);
  for (const s of [-hl + 0.1, hl - 0.1]) terraceRail(s, -hw + 0.1, s, -hw + 0.6 * W, 3.06);
  for (const side of [-1, 1]) {
    const steps = 16;
    const rise = 3.06 / steps;
    const outer = side * (hl - 0.3);
    for (let i = 0; i < steps; i += 1) {
      const s0 = outer - side * (1.3 + (steps - i) * 0.27);
      const s1 = s0 + side * 0.27;
      S.box(f, [Math.min(s0, s1), Math.max(s0, s1)], [-hw - 1.4, -hw - 0.05], [-0.1, (i + 1) * rise], C.offWhite);
    }
    S.box(f, [Math.min(outer, outer - side * 1.3), Math.max(outer, outer - side * 1.3)], [-hw - 1.4, -hw - 0.05], [-0.1, 3.06], C.offWhite);
    const foot = local(f, outer - side * (1.3 + steps * 0.27), -hw - 1.4, 0.95);
    const head = local(f, outer - side * 1.3, -hw - 1.4, 3.06 + 0.95);
    S.beam(foot, head, 0.06, 0.06, C.railTeal);
  }
};

// Seat lettering of the stands (VR scene_a15: blue seats spell "@SCNU" on orange across the south stand, h330, and
// "SCNU" across the north stand, h10), as 5 x 7 glyphs over seat rows 1-10, read from the field.
const SEAT_TEXT = { OB0028: "@SCNU", OB0026: "SCNU" };
const GLYPHS = {
  "@": [".###.", "#...#", "#.###", "#.#.#", "#.###", "#....", ".####"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  N: ["#...#", "##..#", "#.#.#", "#.#.#", "#..##", "#...#", "#...#"],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
};
const SEAT_M = 0.5;

// Stadium seating (VR scene_a15): front wall, terraced concrete rows rising away from the field, seats in blue and
// orange-yellow (lettered where SEAT_TEXT says so) between stair aisles, back wall and blue top railing.
B.stadium_seating = (ctx, o) => {
  const ring = o.footprint;
  const r = orientedRect(ring);
  const g = ctx.minGround(ring);
  const away = ctx.fieldCentre ? [2 * r.centre[0] - ctx.fieldCentre[0], 2 * r.centre[1] - ctx.fieldCentre[1]] : localPlan(frame([r.centre[0], 0, r.centre[1]], r.u), 0, 1);
  const f = facingFrame(ctx, r.centre, r.u, away);
  f.o[1] = g;
  const localRing = ring.map((p) => toLocal(f, p));
  const tMin = Math.min(...localRing.map(([, t]) => t));
  const tMax = Math.max(...localRing.map(([, t]) => t));
  const rows = o.p.seat_rows ?? 12;
  const wallTop = 1.0;
  const walk = 0.7;
  const rise = (o.heightM - wallTop) / rows;
  const depth = (tMax - tMin - walk - 0.3) / rows;
  const S = ctx.solid;
  // The text runs over the whole seat span, read left to right from the field: the viewer faces +t, so left is +s.
  const text = SEAT_TEXT[o.id] ?? "";
  const spans = localRing.map(([s]) => s);
  const [textS0, textS1] = [Math.min(...spans) + 1.1, Math.max(...spans) - 1.1];
  const seatBlue = (row, s) => {
    if (!text || row < 1 || row > 10) return false;
    const along = (textS1 - s) / (textS1 - textS0);
    if (along < 0 || along >= 1) return false;
    const cell = along * text.length;
    const glyph = GLYPHS[text[Math.floor(cell)]];
    const gx = Math.floor((((cell % 1) - 0.12) / 0.76) * 5);
    const gy = Math.floor(((10 - row) / 10) * 7);
    return gx >= 0 && gx < 5 && glyph[gy][gx] === "#";
  };
  const front = sRange(localRing, tMin + 0.15) ?? sRange(localRing, tMin + walk);
  if (front) {
    S.box(f, [front[0], front[1]], [tMin, tMin + 0.25], [-0.15, wallTop], C.white);
    S.box(f, [front[0], front[1]], [tMin + 0.25, tMin + walk], [-0.15, wallTop - 0.25], C.concrete);
  }
  let last = null;
  for (let i = 0; i < rows; i += 1) {
    const t0 = tMin + walk + i * depth;
    const t1 = t0 + depth;
    const span = sRange(localRing, (t0 + t1) / 2);
    if (!span) continue;
    const [s0, s1] = span;
    last = { s0, s1, top: wallTop + (i + 1) * rise };
    const tread = wallTop + i * rise;
    S.box(f, [s0, s1], [t0, t1], [-0.15, tread], { top: C.concrete, side: C.offWhite });
    // stair aisles: both ends and every ~22 m
    const blocks = Math.max(1, Math.round((s1 - s0) / 22));
    const aisles = [[s0, s0 + 1.1], [s1 - 1.1, s1], ...Array.from({ length: blocks - 1 }, (_, k) => {
      const c = s0 + ((s1 - s0) * (k + 1)) / blocks;
      return [c - 0.6, c + 0.6];
    })].sort((a, b) => a[0] - b[0]);
    for (let k = 0; k + 1 < aisles.length; k += 1) {
      const start = aisles[k][1];
      const count = Math.floor((aisles[k + 1][0] - start) / SEAT_M);
      // consecutive seats of one colour are drawn as one run
      for (let a = 0; a < count;) {
        const blue = seatBlue(i, start + (a + 0.5) * SEAT_M);
        let b = a + 1;
        while (b < count && seatBlue(i, start + (b + 0.5) * SEAT_M) === blue) b += 1;
        const [s, e] = [start + a * SEAT_M, start + b * SEAT_M];
        const colour = blue ? C.seatBlue : C.seatOrange;
        S.box(f, [s + 0.03, e - 0.03], [t0 + 0.12, t0 + 0.5], [tread, tread + 0.42], colour);
        S.box(f, [s + 0.03, e - 0.03], [t0 + 0.46, t0 + 0.56], [tread + 0.42, tread + 0.78], colour);
        a = b;
      }
    }
  }
  if (last) {
    const back = tMin + walk + rows * depth;
    S.box(f, [last.s0, last.s1], [back, back + 0.3], [-0.15, last.top], C.offWhite);
    railing(ctx, [localPlan(f, last.s0, back + 0.15), localPlan(f, last.s1, back + 0.15)], 1.1, C.railBlue, { baseY: g + M(last.top), stepM: 2, rails: [1, 0.5] });
  }
};

// Signal poles (VR scene_a19). Where the photo shows the mast arm (data/photo/signal-arms.json) it sets the arm; otherwise
// each pole controls the approach whose centreline is nearest (data/network/roads.json
// edges, plus the OSM arterial and connector lines outside the campus road zones), within SIGNAL_REACH_M: the mast arm
// reaches from the pole square across that carriageway's near lanes to the centreline (clamped to 3.5-9 m), and the
// heads face the traffic in those lanes. With right-hand traffic the near lanes run with the kerb on their right, so the
// heads look back along them, toward the vehicles coming at the pole (signalApproach).
const SIGNAL_REACH_M = 25;
const NETWORK = path.join(HERE, "..", "data", "network", "roads.json");
let networkLines = null;
function approachLines(ctx) {
  networkLines ??= JSON.parse(readFileSync(NETWORK, "utf8")).edges.map((e) => ({
    id: e.properties.id,
    road: e.properties.road_id ?? null,
    line: e.geometry.coordinates.map(([x, y]) => tmToScene(...simulationToTm({ x, z: y }))),
  }));
  return [
    ...networkLines,
    ...ctx.roads.arterials.map((line, i) => ({ id: `OSM_ARTERIAL_${i}`, road: null, line })),
    ...ctx.roads.connectors.map((line, i) => ({ id: `OSM_CONNECTOR_${i}`, road: null, line })),
  ];
}

// The approach a signal at `at` controls: nearest centreline within reachM. Returns { id, road, armDir (unit, toward the
// centreline), armM, travelDir (unit, the near lanes' traffic), headsFace (unit, = -travelDir) } or null.
export function signalApproach(at, lines, reachM = SIGNAL_REACH_M) {
  let best = null;
  for (const { id, road, line } of lines) {
    for (let i = 0; i + 1 < line.length; i += 1) {
      const [a, b] = [line[i], line[i + 1]];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((at[0] - a[0]) * dx + (at[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      const q = [a[0] + t * dx, a[1] + t * dz];
      const d = Math.hypot(q[0] - at[0], q[1] - at[1]);
      if (!best || d < best.d) best = { id, road, q, d };
    }
  }
  if (!best || best.d > M(reachM) || best.d < 1e-6) return null;
  const armDir = [(best.q[0] - at[0]) / best.d, (best.q[1] - at[1]) / best.d];
  // scene plan: x east, z south. n = centreline -> pole; right-hand traffic keeps the kerb (n) on its right, which in
  // this frame is travel = (n.z, -n.x).
  const n = [-armDir[0], -armDir[1]];
  const travelDir = [n[1], -n[0]];
  return { id: best.id, road: best.road, armDir, armM: best.d / M(1), travelDir, headsFace: [-travelDir[0], -travelDir[1]] };
}

// Arms the photo shows (data/photo/signal-arms.json) win over the rule: bearing and length read on the photo chip.
const SIGNAL_ARMS = path.join(HERE, "..", "data", "photo", "signal-arms.json");
let photoArms = null;
// Approach derived from an arm direction (scene plan unit vector) and length: heads face the near-lane traffic as above.
export function approachFromArm(armDir, armM, id = "photo") {
  const n = [-armDir[0], -armDir[1]];
  const travelDir = [n[1], -n[0]];
  return { id, road: null, armDir, armM, travelDir, headsFace: [-travelDir[0], -travelDir[1]] };
}
// A pedestrian signal post (signal-arms.json `posts`, read on the VR): no mast arm, one two-aspect head on the post
// facing `faceDeg` (bearing from north) across the crossing it serves.
let signalPosts = null;
function pedestrianPost(ctx, o, at, g, post) {
  const faceDir = [Math.sin((post.faceDeg * Math.PI) / 180), -Math.cos((post.faceDeg * Math.PI) / 180)];
  const f = frame([at[0], g, at[1]], faceDir);
  (ctx.signals ??= []).push([o.id, "pedestrian-post", null, post.faceDeg, 0]);
  ctx.solid.box(f, [-0.2, 0.2], [-0.2, 0.2], [-0.1, 0.2], C.concrete);
  ctx.solid.pole(at, g - M(0.1), g + M(3.6), 0.07, 0.06, C.signalPole);
  ctx.solid.box(f, [0.08, 0.36], [-0.17, 0.17], [2.3, 3.05], C.black);
  const lit = ctx.signalIndex++ % 2 === 0 ? GLOW_UV.red : GLOW_UV.green;
  // red man above, green man below, on the face side
  [[2.7, GLOW_UV.red], [2.36, GLOW_UV.green]].forEach(([h, uv]) => {
    ctx.glow.face([local(f, 0.361, -0.12, h), local(f, 0.361, 0.12, h), local(f, 0.361, 0.12, h + 0.28), local(f, 0.361, -0.12, h + 0.28)], [f.u[0], 0, f.u[1]], uv === lit ? lit : GLOW_UV.dark);
  });
}
B.traffic_signal_pole = (ctx, o) => {
  const at = o.point;
  const g = ctx.groundAt(...at);
  signalPosts ??= existsSync(SIGNAL_ARMS) ? JSON.parse(readFileSync(SIGNAL_ARMS, "utf8")).posts ?? {} : {};
  if (signalPosts[o.id]) return pedestrianPost(ctx, o, at, g, signalPosts[o.id]);
  photoArms ??= existsSync(SIGNAL_ARMS) ? JSON.parse(readFileSync(SIGNAL_ARMS, "utf8")).arms : {};
  const photo = photoArms[o.id];
  const approach = photo
    ? approachFromArm([Math.sin((photo.bearingDeg * Math.PI) / 180), -Math.cos((photo.bearingDeg * Math.PI) / 180)], photo.lengthM, "photo-arm")
    : signalApproach(at, approachLines(ctx));
  const dir = approach?.armDir ?? towardRoad(at, ctx.roads) ?? [1, 0];
  const f = frame([at[0], g, at[1]], dir);
  const arm = Math.max(3.5, Math.min(9, approach?.armM ?? 3.5));
  // which side of the arm frame (t sign) the heads' lenses face
  const face = approach ? Math.sign(f.v[0] * approach.headsFace[0] + f.v[1] * approach.headsFace[1]) || -1 : -1;
  (ctx.signals ??= []).push([o.id, approach?.id ?? null, approach?.road ?? null, approach ? Number(((((Math.atan2(approach.headsFace[0], -approach.headsFace[1]) * 180) / Math.PI) + 360) % 360).toFixed(1)) : null, Number(arm.toFixed(2))]);
  ctx.solid.box(f, [-0.3, 0.3], [-0.3, 0.3], [-0.1, 0.25], C.concrete);
  ctx.solid.pole(at, g - M(0.1), g + M(6.6), 0.15, 0.11, C.signalPole);
  ctx.solid.beam(local(f, 0, 0, 6.15), local(f, arm, 0, 6.15), 0.13, 0.13, C.signalPole);
  ctx.solid.beam(local(f, 0, 0, 5.3), local(f, Math.min(2.2, arm * 0.4), 0, 6.1), 0.06, 0.06, C.signalPole);
  const lit = ctx.signalIndex++ % 2 === 0 ? GLOW_UV.red : GLOW_UV.green;
  for (const s of [arm - 0.8, arm * 0.55]) {
    ctx.solid.box(f, [s - 0.66, s + 0.66], [-0.17, 0.17], [5.62, 6.0], C.black);
    // lenses on the side facing the approach (red top, amber, green bottom read along the head); the back stays dark
    [-0.45, -0.15, 0.15, 0.45].forEach((ds, k) => {
      const t = face * 0.176;
      const uv = (k === 0 && lit === GLOW_UV.red) || (k === 3 && lit === GLOW_UV.green) ? lit : GLOW_UV.dark;
      ctx.glow.face([local(f, s + ds - 0.1, t, 5.71), local(f, s + ds + 0.1, t, 5.71), local(f, s + ds + 0.1, t, 5.91), local(f, s + ds - 0.1, t, 5.91)], [f.v[0] * face, 0, f.v[1] * face], uv);
    });
  }
};

B.sign_pole = (ctx, o) => {
  if (o.line) {
    // billboard (VR scene_a19 h0: large university board on the slope)
    const [a, b] = [o.line[0], o.line.at(-1)];
    const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const width = Math.hypot(b[0] - a[0], b[1] - a[1]) / M(1);
    const toRoad = towardRoad(c, ctx.roads) ?? [0, 1];
    const f = facingFrame(ctx, c, [b[0] - a[0], b[1] - a[1]], [c[0] + toRoad[0] * M(5), c[1] + toRoad[1] * M(5)]);
    for (const s of [-width / 2 + 0.6, width / 2 - 0.6]) ctx.solid.box(f, [s - 0.14, s + 0.14], [-0.4, -0.12], [-0.1, o.heightM - 0.2], C.metal);
    ctx.solid.box(f, [-width / 2, width / 2], [-0.12, 0.12], [o.heightM - 3.6, o.heightM], { top: C.white, side: C.board });
    return;
  }
  const at = o.point;
  const g = ctx.groundAt(...at);
  const toRoad = towardRoad(at, ctx.roads) ?? [1, 0];
  const f = frame([at[0], g, at[1]], [-toRoad[1], toRoad[0]]);
  ctx.solid.pole(at, g - M(0.1), g + M(o.heightM), 0.04, 0.035, C.galvanised, { sides: 6 });
  ctx.solid.box(f, [-0.3, 0.3], [0.05, 0.09], [o.heightM - 0.75, o.heightM - 0.15], { top: C.white, side: C.signBlue });
};

// A19 gate sign (VR scene_a19 l face, scene_001): free-standing letter slab on a planted stone bed, the line being the
// sign's axis; the lettering is a plain band (no text texture). length_m / depth_m: letter slab, height_m: top of the
// upper name band above the ground, plinth_m: stone bed, colour / bandColour: slab and band. All estimated.
B.gate_sign = (ctx, o) => {
  const p = o.p;
  const [a, b] = [o.line[0], o.line.at(-1)];
  const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const length = p.length_m ?? Math.hypot(b[0] - a[0], b[1] - a[1]) / M(1);
  const depth = p.depth_m ?? 0.45;
  const plinth = p.plinth_m ?? 0.6;
  const letters = (o.heightM - plinth) * 0.75;
  const toRoad = towardRoad(c, ctx.roads) ?? [0, 1];
  const f = facingFrame(ctx, c, [b[0] - a[0], b[1] - a[1]], [c[0] + toRoad[0] * M(5), c[1] + toRoad[1] * M(5)]);
  const slab = rgb(p.colour ?? "#f4f3ee");
  ctx.solid.box(f, [-length / 2 - 1, length / 2 + 1], [-depth / 2 - 1.6, depth / 2 + 0.4], [-0.1, plinth], { top: C.shrub, side: C.stone });
  ctx.solid.box(f, [-length / 2, length / 2], [-depth / 2, depth / 2], [plinth, plinth + letters], { top: slab, side: slab });
  const band = rgb(p.bandColour ?? p.colour ?? "#f4f3ee");
  ctx.solid.box(f, [-length * 0.42, length * 0.42], [-depth * 0.3, depth * 0.3], [plinth + letters + 0.1, o.heightM], { top: band, side: band });
};

// Garden walls (VR scene_a5 r: a white-coped wall round the walled garden carrying a brown timber lattice screen):
// along a LineString, catalogue thicknessM and heightM in `colour`, a 0.06 m coping in copingColour, piers every
// pier_spacing_m when set, and a lattice screen lattice_m high on top when set.
B.garden_wall = (ctx, o) => {
  if (!o.line) throw new Error(`furniture: garden_wall ${o.id} needs a LineString`);
  const d = dimsOf(o);
  const body = paintOf(o.p.colour, C.brick, o.id);
  wall(ctx, ctx.solid, o.line, d.thicknessM, d.heightM - 0.06, body);
  wall(ctx, ctx.solid, o.line, d.thicknessM + 0.06, 0.06, paintOf(o.p.copingColour, C.offWhite, o.id), { baseM: d.heightM - 0.06 });
  if (o.p.pier_spacing_m) {
    for (const { p, u } of along(o.line, M(o.p.pier_spacing_m))) {
      ctx.solid.box(frame([p[0], ctx.groundAt(...p), p[1]], u), [-0.2, 0.2], [-(d.thicknessM / 2 + 0.05), d.thicknessM / 2 + 0.05], [-0.08, d.heightM + 0.04], body);
    }
  }
  if (o.p.lattice_m) {
    const lattice = paintOf(o.p.latticeColour, C.wood, o.id);
    railing(ctx, o.line, o.p.lattice_m, lattice, { baseM: d.heightM, stepM: 1.8, rails: [1, 0.03], postM: 0.08, panel: [...lattice.slice(0, 3), 170] });
  }
};

// Free-standing boards (VR scene_a10 r: white notice panels in blue frames on two blue posts under a sloping rain hood;
// scene_a4 r: the dark terminal board): a panel width_m wide and panel_m tall on two legs, its bottom clearance_m
// above the ground, facing bearing_deg (a Point) or the left of a LineString; colour is the face, frameColour the
// legs, the edges and the hood (hood true). Missing sizes take SIGNBOARD; every size is an estimate.
const SIGNBOARD = { widthM: 1.8, panelM: 1.2, clearanceM: 0.6 };
B.signboard = (ctx, o) => {
  let centre;
  let u;
  if (o.line) {
    const [a, b] = [o.line[0], o.line.at(-1)];
    centre = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    u = [b[0] - a[0], b[1] - a[1]];
  } else if (o.point) {
    const bearing = ((o.p.bearing_deg ?? 0) * Math.PI) / 180;
    centre = o.point;
    u = [-Math.cos(bearing), -Math.sin(bearing)];
  } else throw new Error(`furniture: signboard ${o.id} needs a Point or a LineString`);
  const w = o.p.width_m ?? SIGNBOARD.widthM;
  const ph = o.p.panel_m ?? SIGNBOARD.panelM;
  const c = o.p.clearance_m ?? SIGNBOARD.clearanceM;
  const face = paintOf(o.p.colour, C.white, o.id);
  const edge = paintOf(o.p.frameColour, C.signBlue, o.id);
  const f = frame([centre[0], ctx.groundAt(...centre), centre[1]], u);
  const S = ctx.solid;
  for (const s of [-w / 2 + 0.06, w / 2 - 0.06]) S.box(f, [s - 0.05, s + 0.05], [-0.09, 0.01], [-0.1, c + ph + 0.05], edge);
  S.box(f, [-w / 2, w / 2], [-0.03, 0.03], [c, c + ph], { side: face, top: edge });
  S.box(f, [-w / 2 - 0.04, w / 2 + 0.04], [-0.05, 0.05], [c - 0.05, c], edge);
  S.box(f, [-w / 2 - 0.04, w / 2 + 0.04], [-0.05, 0.05], [c + ph, c + ph + 0.05], edge);
  if (o.p.hood) {
    const [h0, h1] = [c + ph + 0.05, c + ph + 0.2];
    const at = (s, t, h) => local(f, s, t, h);
    S.hexa([at(-w / 2 - 0.1, -0.25, h1 - 0.04), at(w / 2 + 0.1, -0.25, h1 - 0.04), at(w / 2 + 0.1, 0.4, h0), at(-w / 2 - 0.1, 0.4, h0),
      at(-w / 2 - 0.1, -0.25, h1), at(w / 2 + 0.1, -0.25, h1), at(w / 2 + 0.1, 0.4, h0 + 0.06), at(-w / 2 - 0.1, 0.4, h0 + 0.06)], edge, { bottom: true });
  }
};

// ---------------------------------------------------------------- VR site detail (data/photo/site-detail.geojson)
// Standard dimensions, every one an estimate (추정): clipped hedge 0.8 m wide, 1.0 m tall; stall 2.5 x 5.0 m with
// 0.1 m white dividers (주차장법 시행규칙 제3조: 일반형 2.5 x 5.0 m); wheel stop 1.6 x 0.15 x 0.12 m, 0.9 m in from the
// stall's back. Paint lies 0.045 m over the ground, just above the markings stage's 0.04 m.
const SITE = { hedgeWidthM: 0.8, hedgeHeightM: 1.0, stallWidthM: 2.5, stallDepthM: 5.0, paintM: 0.1, paintLiftM: 0.045 };
const shrubPaint = (o) => {
  const k = 0.9 + mulberry32([...o.id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7))() * 0.2;
  const base = paintOf(o.p.colour, C.shrub, o.id);
  return base.map((v, i) => (i < 3 ? Math.min(255, Math.round(v * k)) : v));
};
// Clipped hedge along a line (width_m, height_m), or a clipped shrub mass: a Polygon, or a Point with radius_m (a
// round topiary), drawn as a body and a slightly inset crown.
B.hedge = (ctx, o) => {
  const h = o.p.height_m ?? SITE.hedgeHeightM;
  const paint = shrubPaint(o);
  if (o.line) {
    wall(ctx, ctx.solid, o.line, o.p.width_m ?? SITE.hedgeWidthM, h, paint);
    return;
  }
  const ring = o.ring ?? disc(o.point, M(o.p.radius_m ?? 0.6), 10);
  const crown = offsetLine([...ring, ring[0]], insideSign(ring) * M(Math.min(0.15, h * 0.15))).slice(0, -1);
  const top = (x, z) => ctx.groundAt(x, z) + M(h * 0.82);
  ctx.solid.prism(ring, ctx.minGround(ring) - M(0.1), top, paint);
  ctx.solid.prism(crown, top, (x, z) => ctx.groundAt(x, z) + M(h), paint);
};
// Car-park stall row: the LineString runs along the stalls' open (aisle) end from the first divider to the last; the
// stalls lie on `side` (left or right walking along it), depth_m deep, `stalls` of them (default length / 2.5 m). Skewed
// rows (dividers not square to the row, as the photo shows them) give divider_bearing_deg, the compass bearing of a
// divider from the aisle into the stall; depth_m is then measured along the divider. Draws the dividers (unless
// dividers is false), the back line when back_line, the
// aisle-end line when front_line (boxed bays), plus wheel_stops.
export function stallRow(line, { stalls, side = "left", depthM = SITE.stallDepthM, bearingDeg } = {}) {
  const [a, b] = [line[0], line.at(-1)];
  const lengthM = Math.hypot(b[0] - a[0], b[1] - a[1]) / M(1);
  const n = stalls ?? Math.max(1, Math.round(lengthM / SITE.stallWidthM));
  const u = [(b[0] - a[0]) / M(lengthM), (b[1] - a[1]) / M(lengthM)];
  const v = bearingDeg !== undefined ? [Math.sin((bearingDeg * Math.PI) / 180), -Math.cos((bearingDeg * Math.PI) / 180)] : side === "left" ? [u[1], -u[0]] : [-u[1], u[0]];
  const at = (sM, tM) => [a[0] + u[0] * M(sM) + v[0] * M(tM), a[1] + u[1] * M(sM) + v[1] * M(tM)];
  const dividers = Array.from({ length: n + 1 }, (_, k) => [at((lengthM * k) / n, 0), at((lengthM * k) / n, depthM)]);
  const stops = Array.from({ length: n }, (_, k) => ({ centre: at((lengthM * (k + 0.5)) / n, depthM - 0.9), u }));
  return { n, lengthM, u, v, dividers, stops, back: [at(0, depthM), at(lengthM, depthM)] };
}
function paintStrip(ctx, p, q, widthM, paint) {
  const pts = densify([p, q], 1);
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const n = [-(q[1] - p[1]) / len * M(widthM / 2), (q[0] - p[0]) / len * M(widthM / 2)];
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const [c, d] = [pts[i], pts[i + 1]];
    ctx.solid.flat([[c[0] - n[0], c[1] - n[1]], [d[0] - n[0], d[1] - n[1]], [d[0] + n[0], d[1] + n[1]], [c[0] + n[0], c[1] + n[1]]], [], (x, z) => ctx.groundAt(x, z) + M(SITE.paintLiftM), paint);
  }
}
B.stall_row = (ctx, o) => {
  const row = stallRow(o.line, { stalls: o.p.stalls, side: o.p.side, depthM: o.p.depth_m ?? SITE.stallDepthM, bearingDeg: o.p.divider_bearing_deg });
  const paint = paintOf(o.p.colour, C.white, o.id);
  // dividers: false where the markings data already paints the row (only the wheel stops are added)
  if (o.p.dividers !== false) for (const [p, q] of row.dividers) paintStrip(ctx, p, q, SITE.paintM, paint);
  if (o.p.back_line) paintStrip(ctx, ...row.back, SITE.paintM, paint);
  if (o.p.front_line) paintStrip(ctx, row.dividers[0][0], row.dividers.at(-1)[0], SITE.paintM, paint);
  if (!o.p.wheel_stops) return;
  const stop = paintOf(o.p.stopColour, C.concreteDark, o.id);
  for (const s of row.stops) ctx.solid.box(frame([s.centre[0], ctx.groundAt(...s.centre), s.centre[1]], s.u), [-0.8, 0.8], [-0.075, 0.075], [-0.03, 0.12], stop);
};

// Street furniture of the VR site-detail sweep (standard dimensions, every one an estimate, \uCD94\uC815): bollard 0.9 m tall,
// 0.18 m across (\uBCF4\uB3C4\uC6A9 \uBCFC\uB77C\uB4DC 0.8-1.0 m, 0.1-0.2 m); bike or PM stand an inverted U 0.75 m tall and 0.7 m wide every
// spacing_m (0.9 m); litter bin 0.55 x 0.45 x 0.95 m; handrail 0.9 m (KDS \uACC4\uB2E8 \uB09C\uAC04 0.85-0.9 m) on posts every 1.5 m.
const STREET = { bollardM: 0.9, standM: 0.75, standSpacingM: 0.9, railM: 0.9 };
// Points along a LineString every spacing_m (both ends included), or the Point itself.
const rowPoints = (o, spacingM) => (o.point ? [o.point] : along(o.line, M(o.p.spacing_m ?? spacingM)).map(({ p }) => p));
B.bollard = (ctx, o) => {
  const h = o.p.height_m ?? STREET.bollardM;
  const paint = paintOf(o.p.colour, C.concreteDark, o.id);
  for (const p of rowPoints(o, 1.5)) {
    const g = ctx.groundAt(...p);
    ctx.solid.pole(p, g - M(0.05), g + M(h), 0.09, 0.09, paint, { sides: 8 });
    if (o.p.band) ctx.solid.pole(p, g + M(h - 0.2), g + M(h - 0.1), 0.095, 0.095, paintOf(o.p.band, C.white, o.id), { sides: 8, cap: false });
  }
};
// Open bike or PM stands (no roof): an inverted U across the line every spacing_m.
B.bike_stands = (ctx, o) => {
  const [a, b] = [o.line[0], o.line.at(-1)];
  const paint = paintOf(o.p.colour, C.galvanised, o.id);
  const h = o.p.height_m ?? STREET.standM;
  const f = frame([a[0], 0, a[1]], [b[0] - a[0], b[1] - a[1]]);
  for (const p of rowPoints(o, STREET.standSpacingM)) {
    const g = ctx.groundAt(...p);
    const [s] = toLocal(f, p);
    const lift = (t, hh) => { const q = local(f, s, t, 0); return [q[0], g + M(hh), q[2]]; };
    ctx.solid.beam(lift(-0.35, -0.05), lift(-0.35, h), 0.05, 0.05, paint);
    ctx.solid.beam(lift(0.35, -0.05), lift(0.35, h), 0.05, 0.05, paint);
    ctx.solid.beam(lift(-0.35, h), lift(0.35, h), 0.05, 0.05, paint);
  }
};
B.bin = (ctx, o) => {
  const bearing = ((o.p.bearing_deg ?? 0) * Math.PI) / 180;
  const f = frame([o.point[0], ctx.groundAt(...o.point), o.point[1]], [Math.sin(bearing), -Math.cos(bearing)]);
  const n = o.p.count ?? 1;
  const paint = paintOf(o.p.colour, C.binBlue, o.id);
  for (let k = 0; k < n; k += 1) {
    const s = (k - (n - 1) / 2) * 0.65;
    ctx.solid.box(f, [s - 0.275, s + 0.275], [-0.225, 0.225], [-0.05, 0.88], paint);
    ctx.solid.box(f, [s - 0.29, s + 0.29], [-0.24, 0.24], [0.88, 0.95], paintOf(o.p.lidColour, C.metal, o.id));
  }
};
// Paved or stepping-stone path (VR scene_a5 r: the grey stones across the A1 roof garden lawn): a LineString width_m
// wide (1 m), each leg a convex slab height_m (0.15 m) above the ground running half a width past its ends so the
// joints close; colour the stone.
B.paving_path = (ctx, o) => {
  if (!o.line) throw new Error(`furniture: paving_path ${o.id} needs a LineString`);
  const w = (o.p.width_m ?? 1) / 2;
  const paint = paintOf(o.p.colour, C.stone, o.id);
  const top = (x, z) => ctx.groundAt(x, z) + M(o.p.height_m ?? 0.15);
  for (let i = 0; i + 1 < o.line.length; i += 1) {
    const [a, b] = [o.line[i], o.line[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u = [((b[0] - a[0]) / len) * M(w), ((b[1] - a[1]) / len) * M(w)];
    const slab = [[a[0] - u[0] - u[1], a[1] - u[1] + u[0]], [b[0] + u[0] - u[1], b[1] + u[1] + u[0]], [b[0] + u[0] + u[1], b[1] + u[1] - u[0]], [a[0] - u[0] + u[1], a[1] - u[1] - u[0]]];
    ctx.solid.prism(slab, ctx.minGround(slab) - M(0.05), top, paint);
  }
};
// A tree placed from the VR (site-detail site_tree; on a roof with roof_m, on a mound or in a box with box_m): drawn
// by the trees stage (stages/trees.mjs) with the campus tree species.
B.site_tree = () => false;
B.handrail = (ctx, o) => railing(ctx, o.line, o.p.height_m ?? STREET.railM, paintOf(o.p.colour, C.galvanised, o.id), { stepM: 1.5, rails: [1, 0.5], postM: 0.05, railM: 0.05 });
// Entrance canopy: a flat slab (0.25 m) at height_m over the Polygon, on round columns at the ring corners named in
// posts (vertex indices; none: cantilevered from the building).
B.entrance_canopy = (ctx, o) => {
  const g = ctx.medianGround(o.ring);
  const h = M(o.heightM);
  const paint = paintOf(o.p.colour, C.white, o.id);
  ctx.solid.prism(o.ring, g + h - M(0.25), g + h, paint);
  for (const i of o.p.posts ?? []) ctx.solid.pole(o.ring[i], ctx.groundAt(...o.ring[i]) - M(0.05), g + h - M(0.25), 0.15, 0.15, paintOf(o.p.postColour, C.white, o.id));
};
// Clipped-hedge lettering (VR scene_a16: \uC9C4\uB9AC \uC815\uC758 \uCC3D\uC870 on the slope): the road-marking Hangul strokes
// (lib/markingGlyphs.mjs) as hedges stroke_m wide and height_m tall. The LineString is the baseline of the text from its
// first character to its last; the tops of the letters lie to its left. char_height_m tall, char_width_m wide, gap_m
// between characters, a space 0.6 of a character.
export function hedgeTextStrokes(line, text, { heightM, widthM = heightM, gapM = 0.3 }) {
  const [a, b] = [line[0], line.at(-1)];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const up = [u[1], -u[0]];
  const strokes = [];
  let s = 0;
  for (const ch of text) {
    if (ch === " ") { s += widthM * 0.6 + gapM; continue; }
    const at = ([x, y]) => [a[0] + u[0] * M(s + x * widthM) + up[0] * M((1 - y) * heightM), a[1] + u[1] * M(s + x * widthM) + up[1] * M((1 - y) * heightM)];
    for (const e of glyphElements(ch) ?? []) {
      if (e.ellipse) {
        const [cx, cy, rx, ry] = e.ellipse;
        strokes.push({ closed: true, points: Array.from({ length: 16 }, (_, i) => at([cx + rx * Math.cos((i / 16) * 2 * Math.PI), cy + ry * Math.sin((i / 16) * 2 * Math.PI)])) });
      } else strokes.push({ closed: false, points: e.map(at) });
    }
    s += widthM + gapM;
  }
  return strokes;
}
B.hedge_text = (ctx, o) => {
  const paint = shrubPaint(o);
  for (const st of hedgeTextStrokes(o.line, o.p.text, { heightM: o.p.char_height_m, widthM: o.p.char_width_m, gapM: o.p.gap_m })) {
    wall(ctx, ctx.solid, st.points, o.p.stroke_m ?? 0.5, o.heightM, paint, { closed: st.closed });
  }
};
// LED screen on a facade: a panel standoff_m in front of the wall line (LineString, left to right as seen from the
// front), from bottom_m to top_m above the ground, in vertical colour fields (fields: sRGB hex, left to right; no image).
// Drawn into Furniture_Screen, whose colour-field texture is also its emissive map (lit at night like the windows).
B.led_screen = (ctx, o) => {
  const [a, b] = [o.line[0], o.line.at(-1)];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const out = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  const off = M(o.p.standoff_m ?? 0.15);
  const g = Math.min(ctx.groundAt(...a), ctx.groundAt(...b));
  const [y0, y1] = [g + M(o.p.bottom_m), g + M(o.p.top_m)];
  const p = (q, y) => [q[0] + out[0] * off, y, q[1] + out[1] * off];
  ctx.screens.push({ id: o.id, corners: [p(a, y0), p(b, y0), p(b, y1), p(a, y1)], normal: [out[0], 0, out[1]], fields: o.p.fields });
  // dark frame and back box
  const ring = [a, b, [b[0] + out[0] * off, b[1] + out[1] * off], [a[0] + out[0] * off, a[1] + out[1] * off]];
  ctx.solid.prism(ring, y0 - M(0.1), y1 + M(0.1), paintOf(o.p.frameColour, C.black, o.id));
};

B.floodlight_pole = (ctx, o) => {
  const at = o.point;
  const g = ctx.groundAt(...at);
  const poles = ctx.objects.filter((q) => q.kind === "floodlight_pole");
  const aim = poles.reduce((acc, q) => [acc[0] + q.point[0] / poles.length, acc[1] + q.point[1] / poles.length], [0, 0]);
  const f = frame([at[0], g, at[1]], [aim[0] - at[0], aim[1] - at[1]]);
  const h = o.heightM;
  ctx.solid.box(f, [-0.3, 0.3], [-0.3, 0.3], [-0.1, 0.3], C.concrete);
  ctx.solid.pole(at, g - M(0.1), g + M(h), 0.13, 0.08, C.galvanised);
  ctx.solid.box(f, [0.05, 0.15], [-0.7, 0.7], [h - 0.15, h - 0.05], C.galvanised);
  for (const t of [-0.45, 0.45]) {
    const a = local(f, 0.2, t, h - 0.1);
    const b = local(f, 0.55, t, h - 0.35);
    ctx.solid.beam(a, b, 0.45, 0.32, C.metal);
  }
};

B.sports_goal = (ctx, o) => {
  const r = orientedRect(o.ring);
  const partner = ctx.objects.filter((q) => q.kind === "sports_goal" && q !== o)
    .map((q) => ({ q, d: Math.hypot(ringCentroid(q.ring)[0] - r.centre[0], ringCentroid(q.ring)[1] - r.centre[1]), size: Math.abs(ringArea(q.ring)) }))
    .filter(({ size }) => (size > M(1) * M(1) * 12) === (Math.abs(ringArea(o.ring)) > M(1) * M(1) * 12))
    .sort((a, b) => a.d - b.d)[0];
  const toward = partner ? ringCentroid(partner.q.ring) : ctx.fieldCentre;
  const football = 2 * r.halfLength > 5;
  const width = football ? 7.32 : 3;
  const h = football ? 2.44 : 2;
  const depth = Math.max(1, Math.min(2.5, 2 * r.halfWidth));
  const f = facingFrame(ctx, r.centre, r.u, toward);
  const mouth = depth / 2;
  const back = -depth / 2;
  const w = width / 2;
  const G = C.goalWhite;
  for (const s of [-w, w]) ctx.solid.box(f, [s - 0.06, s + 0.06], [mouth - 0.12, mouth], [-0.05, h], G);
  ctx.solid.box(f, [-w - 0.06, w + 0.06], [mouth - 0.12, mouth], [h - 0.12, h], G);
  for (const s of [-w, w]) {
    ctx.solid.beam(local(f, s, mouth - 0.06, h - 0.06), local(f, s, back, 0.9), 0.05, 0.05, G);
    ctx.solid.beam(local(f, s, mouth - 0.06, 0.03), local(f, s, back, 0.03), 0.05, 0.05, G);
  }
  ctx.solid.beam(local(f, -w, back, 0.03), local(f, w, back, 0.03), 0.05, 0.05, G);
  const net = (pts) => ctx.glass.face(pts.map(([s, t, hh]) => local(f, s, t, hh)), [0, 1, 0], GLASS.goalNet);
  net([[-w, back, 0.03], [w, back, 0.03], [w, back, 0.9], [-w, back, 0.9]]);
  net([[-w, back, 0.9], [w, back, 0.9], [w, mouth - 0.06, h - 0.06], [-w, mouth - 0.06, h - 0.06]]);
  for (const s of [-w, w]) net([[s, mouth - 0.06, 0.03], [s, back, 0.03], [s, back, 0.9], [s, mouth - 0.06, h - 0.06]]);
};

B.sports_hoop = (ctx, o) => {
  const at = o.point;
  const other = ctx.objects.find((q) => q.kind === "sports_hoop" && q !== o);
  const f = frame([at[0], ctx.groundAt(...at), at[1]], other ? [other.point[0] - at[0], other.point[1] - at[1]] : [1, 0]);
  ctx.solid.box(f, [-0.5, 0.5], [-0.6, 0.6], [-0.05, 0.25], C.concrete);
  ctx.solid.box(f, [-0.09, 0.09], [-0.09, 0.09], [0.25, 3.3], C.signBlue);
  ctx.solid.beam(local(f, 0, 0, 3.2), local(f, 1.1, 0, 3.35), 0.1, 0.1, C.signBlue);
  ctx.solid.box(f, [1.1, 1.16], [-0.9, 0.9], [2.9, 3.95], C.white);
  const rim = disc([0, 0], 0.23, 8).map(([s, t]) => local(f, 1.16 + 0.23 + s, t, 3.05));
  for (let i = 0; i < rim.length; i += 1) ctx.solid.beam(rim[i], rim[(i + 1) % rim.length], 0.03, 0.03, C.hoopOrange, { ends: false });
};

B.footbridge = (ctx, o) => {
  const [a, b] = [o.line[0], o.line.at(-1)];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) / M(1);
  const f = frame([a[0], 0, a[1]], [b[0] - a[0], b[1] - a[1]]);
  const half = (o.p.width_m ?? 2.5) / 2;
  const endA = ctx.groundAt(...a);
  const endB = ctx.groundAt(...b);
  const pieces = Math.max(2, Math.ceil(length / 2));
  const deckAt = (s) => {
    const p = localPlan(f, s, 0);
    return Math.max(endA + ((endB - endA) * s) / length, ctx.groundAt(...p)) + M(0.15);
  };
  for (let k = 0; k < pieces; k += 1) {
    const s0 = (length * k) / pieces;
    const s1 = (length * (k + 1)) / pieces;
    const y0 = deckAt(s0);
    const y1 = deckAt(s1);
    const at = (s, t, y) => { const p = localPlan(f, s, t); return [p[0], y, p[1]]; };
    ctx.solid.hexa([at(s0, -half, y0 - M(0.35)), at(s1, -half, y1 - M(0.35)), at(s1, half, y1 - M(0.35)), at(s0, half, y0 - M(0.35)), at(s0, -half, y0), at(s1, -half, y1), at(s1, half, y1), at(s0, half, y0)], { top: C.concrete, side: C.concreteDark, bottom: C.concreteDark }, { bottom: true });
  }
  for (const t of [-half + 0.08, half - 0.08]) {
    const posts = Array.from({ length: Math.ceil(length / 1.8) + 1 }, (_, k) => Math.min(length, k * 1.8));
    for (let k = 0; k < posts.length; k += 1) {
      const p = localPlan(f, posts[k], t);
      ctx.solid.pole(p, deckAt(posts[k]) - M(0.02), deckAt(posts[k]) + M(1.1), 0.035, 0.035, C.white, { sides: 4 });
      if (k + 1 < posts.length) {
        const q = localPlan(f, posts[k + 1], t);
        ctx.solid.beam([p[0], deckAt(posts[k]) + M(1.1), p[1]], [q[0], deckAt(posts[k + 1]) + M(1.1), q[1]], 0.06, 0.06, C.white, { ends: false });
        ctx.solid.beam([p[0], deckAt(posts[k]) + M(0.55), p[1]], [q[0], deckAt(posts[k + 1]) + M(0.55), q[1]], 0.05, 0.05, C.white, { ends: false });
      }
    }
  }
};

// plaza_structure, by subtype
const P = {};
P.planter = (ctx, o) => {
  const base = ctx.minGround(o.ring) - M(0.1);
  ctx.solid.prism(o.ring, base, (x, z) => ctx.groundAt(x, z) + M(o.heightM), { side: C.stone, top: C.lawn });
};
P.fountain = (ctx, o) => {
  const sign = insideSign(o.ring);
  wall(ctx, ctx.solid, o.ring, 0.35, 0.5, C.stone, { closed: true, offsetM: sign * 0.175 });
  const water = offsetLine([...o.ring, o.ring[0]], sign * M(0.34)).slice(0, -1);
  ctx.solid.flat(water, [], (x, z) => ctx.groundAt(x, z) + M(0.32), C.water);
  const c = ringCentroid(o.ring);
  const g = ctx.groundAt(...c);
  ctx.solid.pole(c, g, g + M(0.75), 0.45, 0.35, C.stone);
  ctx.solid.prism(disc(c, M(1.1)), g + M(0.75), g + M(0.87), C.stone);
  ctx.solid.pole(c, g + M(0.87), g + M(1.3), 0.12, 0.08, C.stone, { sides: 6 });
};
// Central plaza pond (VR scene_c1 b): a long pool with semicircular ends (outline = the outer edge of the coping, traced
// on the NGII 2025 sheet), a light granite coping, green water (Furniture_Water: glossy and slightly transparent, so the
// sky reflects in it; the dashboard adds a fresnel alpha), a planted island of rounded clipped shrubs at the west end
// round a stone plinth and the bronze sculpture, and four ring fountains (a pipe ring of upright nozzles) in the open
// water. The painted ground water (osm-ground.json supplement, same outline) is the pool floor. Every dimension is an
// estimate (추정): rings at s (m east of the centre) x t from the VR and a faint ring on the sheet at s 10, t -3.
const POND = {
  copingM: 0.6, copingHeightM: 0.35, waterM: 0.22, copingColour: "#cfccc4", waterColour: "#8aa27a",
  island: { s: -6.6, halfS: 3.7, halfT: 4.2 },
  rings: [[2.5, -3.3], [2.5, 3.3], [10, -3.3], [10, 3.3]], ringRadiusM: 1.4, nozzles: 16, ringColour: "#4c5068",
};
P.pond = (ctx, o) => {
  const sign = insideSign(o.ring);
  wall(ctx, ctx.solid, o.ring, POND.copingM, POND.copingHeightM, rgb(POND.copingColour), { closed: true, offsetM: (sign * POND.copingM) / 2 });
  const water = offsetLine([...o.ring, o.ring[0]], sign * M(POND.copingM)).slice(0, -1);
  const waterY = (x, z) => ctx.groundAt(x, z) + M(POND.waterM);
  ctx.water.flat(water, [], waterY, rgb(POND.waterColour));
  const r = orientedRect(o.ring);
  const east = r.u[0] > 0 ? 1 : -1;
  const f = frame([r.centre[0], 0, r.centre[1]], r.u);
  const at = (sM, tM) => localPlan(f, east * sM, tM);
  // planted island: a stone-edged bed of rounded clipped shrubs round the plinth
  const { s: is, halfS, halfT } = POND.island;
  const centre = at(is, 0);
  const g = ctx.groundAt(...centre);
  const island = Array.from({ length: 20 }, (_, i) => {
    const a = (i / 20) * Math.PI * 2;
    return at(is + Math.cos(a) * halfS, Math.sin(a) * halfT);
  });
  ctx.solid.prism(island, g - M(0.1), (x, z) => ctx.groundAt(x, z) + M(0.3), { side: rgb(POND.copingColour), top: C.soil });
  const rng = mulberry32(81);
  for (let k = 0; k < 14; k += 1) {
    const a = (k / 14) * Math.PI * 2 + rng() * 0.3;
    const radius = 0.45 + rng() * 0.45;
    const p = [is + Math.cos(a) * radius * (halfS - 1.1), Math.sin(a) * radius * (halfT - 1.1)];
    if (Math.hypot(p[0] - is, p[1]) < 1.5) continue;
    const size = 0.75 + rng() * 0.55;
    const blob = Array.from({ length: 12 }, (_, i) => {
      const b = (i / 12) * Math.PI * 2;
      return at(p[0] + Math.cos(b) * size, p[1] + Math.sin(b) * size * (0.8 + rng() * 0.2));
    });
    const y0 = ctx.groundAt(...at(...p)) + M(0.3);
    ctx.solid.rounded(blob, y0 - M(0.05), y0 + M(size * 1.15), size * 0.8, k % 3 ? C.shrub : C.roofGreen);
  }
  const plinth = frame([centre[0], g, centre[1]], r.u);
  ctx.solid.box(plinth, [-0.8, 0.8], [-0.8, 0.8], [0.2, 1.6], C.offWhite);
  // bronze sculpture: a curved form about 2.6 m tall on the plinth
  const form = [[0.1, 0, 1.6], [0.45, 0.1, 2.4], [0.3, 0.15, 3.3], [-0.25, 0.12, 3.95], [-0.8, 0.05, 4.0], [-1.0, 0, 3.6]];
  for (let k = 0; k + 1 < form.length; k += 1) ctx.solid.beam(local(plinth, ...form[k]), local(plinth, ...form[k + 1]), 0.75 - k * 0.1, 0.55 - k * 0.07, C.bronze);
  // ring fountains: a pipe ring just under the water and upright nozzles standing out of it
  const ringPaint = rgb(POND.ringColour);
  for (const [rs, rt] of POND.rings) {
    const c = at(rs, rt);
    const y = waterY(...c);
    const pts = Array.from({ length: POND.nozzles }, (_, i) => {
      const a = (i / POND.nozzles) * Math.PI * 2;
      const q = at(rs + Math.cos(a) * POND.ringRadiusM, rt + Math.sin(a) * POND.ringRadiusM);
      return [q[0], y + M(0.02), q[1]];
    });
    for (let i = 0; i < pts.length; i += 1) {
      ctx.solid.beam(pts[i], pts[(i + 1) % pts.length], 0.07, 0.07, ringPaint);
      ctx.solid.pole([pts[i][0], pts[i][2]], y - M(0.02), y + M(0.12), 0.04, 0.03, ringPaint, { sides: 5 });
    }
  }
};
const PARASOL_WORDS = { blue: "#3063a7", red: "#c0392b", green: "#3f7b4f", yellow: "#e3b53a", orange: "#e07b2c", beige: "#d8c3a0", brown: "#8f6a4c", grey: "#8c9298", gray: "#8c9298", black: "#2a2d30", white: "#efefeb" };
export function parasolColour(note = "") {
  const hex = /#[0-9a-f]{6}\b/i.exec(note);
  if (hex) return rgb(hex[0]);
  const word = Object.keys(PARASOL_WORDS).find((w) => new RegExp(`\\b${w}\\b`, "i").test(note));
  return rgb(word ? PARASOL_WORDS[word] : PARASOL_WORDS.white);
}
P.parasol = (ctx, o) => {
  const c = ringCentroid(o.footprint);
  const g = ctx.groundAt(...c);
  const radius = Math.sqrt(Math.abs(ringArea(o.footprint)) / Math.PI);
  // canopy colour: the instance's `colour` (#rrggbb or a palette name), else a colour word in the note (blue, red,
  // green, yellow, white, beige, ...), else white
  const colour = o.p.colour !== undefined ? paintOf(o.p.colour, C.white, o.id) : parasolColour(o.p.note);
  ctx.solid.pole(c, g - M(0.05), g + M(o.heightM), 0.03, 0.03, C.metal, { sides: 6 });
  ctx.solid.cone([c[0], g + M(o.heightM + 0.2), c[1]], disc(c, radius, 8).map(([x, z]) => [x, g + M(o.heightM - 0.25), z]), colour, { basePaint: colour });
};
P.kiosk = (ctx, o) => {
  const g = ctx.minGround(o.footprint) - M(0.1);
  ctx.solid.prism(o.footprint, g, g + M(o.heightM), { side: C.white, top: C.offWhite });
  const r = orientedRect(o.footprint);
  const f = frame([r.centre[0], g, r.centre[1]], r.u);
  ctx.solid.box(f, [-r.halfLength - 0.2, r.halfLength + 0.2], [-r.halfWidth - 0.2, r.halfWidth + 0.2], [o.heightM, o.heightM + 0.15], C.roofGrey, { bottom: true });
};
P.sculpture = (ctx, o) => {
  const g = ctx.minGround(o.ring) - M(0.05);
  const r = orientedRect(o.ring);
  const f = frame([r.centre[0], g, r.centre[1]], r.u);
  if (o.heightM >= 1) {
    ctx.solid.prism(o.ring, g, g + M(0.25), C.stone);
    ctx.solid.box(f, [-0.55, 0.55], [-0.22, 0.22], [0.25, o.heightM], C.offWhite);
  } else ctx.solid.pole(r.centre, g, g + M(o.heightM), 0.55, 0.5, C.offWhite);
};
P.outdoor_steps = (ctx, o) => stepsOnTerrain(ctx, o);
P.stepped_terrace = (ctx, o) => stepsOnTerrain(ctx, o);
B.plaza_structure = (ctx, o) => {
  const builder = P[o.subtype];
  if (!builder) throw new Error(`furniture: no plaza_structure builder for ${o.subtype} (${o.id})`);
  return builder(ctx, o);
};

// ---------------------------------------------------------------- VR landscape (rest-spaces.geojson RS-LS-*)
// Stepped approaches and outdoor stairs read from the VR (risers counted, rise and tread estimated) on a bottom edge
// traced on the NGII 2025 sheet (LineString, either order), climbing toward up_bearing_deg. Unlike stepsOnTerrain the
// flights rise by their own risers from the lowest ground on the bottom edge: the terrain is smoothed under most
// approaches (C1 rises 1 m where the VR counts 19 risers, D4 is flat). Every step and landing is a solid down to the
// ground under it, so a raised landing shows its cheeks; a landing with landing_to_ground slopes back to the ground at its
// far edge (the D4 forecourt down to the drive). flights: [{ steps, rise_m, tread_m, width_m?, landing_m?,
// landing_width_m?, landingColour?, landing_to_ground? }]; planters: hedge beds on a kerb whose top runs from top_m[0] to
// top_m[1] (metres above the bottom edge) over s; rails: handrails 0.9 m above the treads at t. s along the climb from
// the bottom edge, t across it (metres). Every dimension is an estimate (추정).
const bearingDir = (deg) => [Math.sin((deg * Math.PI) / 180), -Math.cos((deg * Math.PI) / 180)];
B.terraced_steps = (ctx, o) => {
  const [a, b] = [o.line[0], o.line.at(-1)];
  const edgeM = Math.hypot(b[0] - a[0], b[1] - a[1]) / M(1);
  const across = [(b[0] - a[0]) / M(edgeM), (b[1] - a[1]) / M(edgeM)];
  const want = bearingDir(o.p.up_bearing_deg);
  const up = -across[1] * want[0] + across[0] * want[1] >= 0 ? [-across[1], across[0]] : [across[1], -across[0]];
  const centre = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const base = Math.min(...[a, centre, b].map((p) => ctx.groundAt(...p)));
  const f = frame([centre[0], base, centre[1]], up);
  const stepPaint = { top: rgb(o.p.colour), side: rgb(o.p.riserColour ?? o.p.colour) };
  const sOf = (x, z) => toLocal(f, [x, z])[0];
  const slab = (s0, s1, t0, t1, top, paint) => {
    const ring = [localPlan(f, s0, t0), localPlan(f, s1, t0), localPlan(f, s1, t1), localPlan(f, s0, t1)];
    ctx.solid.prism(ring, (x, z) => ctx.groundAt(x, z) - M(0.1), top, paint);
  };
  // tread levels (metres above base) by s, for the rails
  const treads = [];
  let s = 0;
  let level = 0;
  for (const flight of o.p.flights) {
    const width = flight.width_m ?? edgeM;
    for (let i = 0; i < flight.steps; i += 1) {
      level += flight.rise_m;
      slab(s, s + flight.tread_m, -width / 2, width / 2, base + M(level), stepPaint);
      treads.push([s, s + flight.tread_m, level]);
      s += flight.tread_m;
    }
    if (!flight.landing_m) continue;
    const [s0, s1, top0] = [s, s + flight.landing_m, base + M(level)];
    const landingWidth = flight.landing_width_m ?? width;
    const top = flight.landing_to_ground
      ? (x, z) => top0 + (ctx.groundAt(x, z) + M(0.02) - top0) * Math.min(1, Math.max(0, (sOf(x, z) - s0) / (s1 - s0)))
      : top0;
    slab(s0, s1, -landingWidth / 2, landingWidth / 2, top, { top: rgb(flight.landingColour ?? o.p.landingColour ?? o.p.colour), side: stepPaint.side });
    treads.push([s0, s1, level]);
    s = s1;
  }
  for (const planter of o.p.planters ?? []) {
    const [s0, s1] = planter.s;
    const [t0, t1] = planter.t;
    const kerbTop = (x, z) => base + M(planter.top_m[0] + ((planter.top_m[1] - planter.top_m[0]) * Math.min(1, Math.max(0, (sOf(x, z) - s0) / (s1 - s0)))));
    const ring = [localPlan(f, s0, t0), localPlan(f, s1, t0), localPlan(f, s1, t1), localPlan(f, s0, t1)];
    ctx.solid.prism(ring, (x, z) => ctx.groundAt(x, z) - M(0.1), kerbTop, { top: C.soil, side: rgb(planter.kerbColour) });
    const inset = [localPlan(f, s0 + 0.1, t0 + 0.1), localPlan(f, s1 - 0.1, t0 + 0.1), localPlan(f, s1 - 0.1, t1 - 0.1), localPlan(f, s0 + 0.1, t1 - 0.1)];
    // a clipped hedge with a rounded top (VR scene_c1 f)
    const half = Math.min(s1 - s0, t1 - t0) / 2 - 0.1;
    ctx.solid.rounded(inset, (x, z) => kerbTop(x, z) - M(0.05), (x, z) => kerbTop(x, z) + M(planter.hedge_m), Math.min(planter.hedge_m * 0.7, half * 0.85), planter.hedgeColour ? rgb(planter.hedgeColour) : C.shrub);
  }
  // rounded clipped shrub masses beside the flights: a rounded-rectangle plan inside s x t, standing on the bank whose
  // level runs from rise_m[0] to rise_m[1] (metres above the bottom edge) over s, height_m over it
  for (const mass of o.p.masses ?? []) {
    const [s0, s1] = mass.s;
    const [t0, t1] = mass.t;
    const [cs, ct, hs, ht] = [(s0 + s1) / 2, (t0 + t1) / 2, (s1 - s0) / 2, (t1 - t0) / 2];
    const plan = Array.from({ length: 20 }, (_, i) => {
      const a = (i / 20) * Math.PI * 2;
      const [c, sn] = [Math.cos(a), Math.sin(a)];
      // superellipse (exponent 3): a clipped, squarish-round outline
      return localPlan(f, cs + hs * Math.sign(c) * Math.abs(c) ** (2 / 3), ct + ht * Math.sign(sn) * Math.abs(sn) ** (2 / 3));
    });
    const bank = (x, z) => base + M(mass.rise_m[0] + ((mass.rise_m[1] - mass.rise_m[0]) * Math.min(1, Math.max(0, (sOf(x, z) - s0) / (s1 - s0)))));
    const foot = (x, z) => Math.min(bank(x, z), ctx.groundAt(x, z)) - M(0.1);
    ctx.solid.rounded(plan, foot, (x, z) => bank(x, z) + M(mass.height_m), Math.min(mass.height_m * 0.85, Math.min(hs, ht) * 0.85), mass.colour ? rgb(mass.colour) : C.shrub);
  }
  const levelAt = (sm) => (treads.find(([s0, s1]) => sm >= s0 - 1e-6 && sm <= s1 + 1e-6) ?? treads.at(-1))[2];
  for (const rail of o.p.rails ?? []) {
    const [s0, s1] = rail.s;
    const n = Math.max(1, Math.ceil((s1 - s0) / 2));
    const posts = Array.from({ length: n + 1 }, (_, k) => {
      const sm = s0 + ((s1 - s0) * k) / n;
      const [x, z] = localPlan(f, sm, rail.t);
      return [x, base + M(levelAt(sm)), z];
    });
    for (const [x, y, z] of posts) ctx.solid.pole([x, z], y - M(0.05), y + M(0.9), 0.025, 0.025, C.galvanised, { sides: 6 });
    for (let k = 0; k + 1 < posts.length; k += 1) {
      const [p, q] = [posts[k], posts[k + 1]];
      ctx.solid.beam([p[0], p[1] + M(0.9), p[2]], [q[0], q[1] + M(0.9), q[2]], 0.05, 0.05, C.galvanised);
    }
  }
};

// Fountain pond (VR scene_a1): stone coping inside the outline, spray jets (translucent cones) and rocks in the water.
// The water surface is the ground stage's (OSM water painted on Ground_Sports). jets: [lon, lat, height m]; rocks:
// [lon, lat, size m]. Every dimension is an estimate (추정).
B.pond_basin = (ctx, o) => {
  const sign = insideSign(o.ring);
  const { thicknessM, heightM } = o.p.coping;
  wall(ctx, ctx.solid, o.ring, thicknessM, heightM, rgb(o.p.copingColour), { closed: true, offsetM: (sign * thicknessM) / 2 });
  for (const [lon, lat, h] of o.p.jets ?? []) {
    const p = geoToModel(lon, lat);
    const g = ctx.groundAt(...p);
    ctx.glass.cone([p[0], g + M(h), p[1]], disc(p, M(0.3), 8).map(([x, z]) => [x, g + M(0.03), z]), rgb("#eef3f5", 170), { base: false });
  }
  for (const [lon, lat, size] of o.p.rocks ?? []) {
    const p = geoToModel(lon, lat);
    const g = ctx.groundAt(...p);
    ctx.solid.cone([p[0], g + M(size * 0.6), p[1]], disc(p, M(size / 2), 7).map(([x, z]) => [x, g - M(0.05), z]), C.metal, { base: false });
  }
};

// Steps fitted to the terrain: treads perpendicular to the fitted slope, each band's tread at its highest ground,
// risers down to the next. Flat ground (relief under STEPS_MIN_RELIEF_M) leaves the steps unmodelled.
function stepsOnTerrain(ctx, o) {
  const ring = o.ring;
  const xs = ring.map(([x]) => x);
  const zs = ring.map(([, z]) => z);
  const points = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += M(1)) {
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += M(1)) if (pointInRing([x, z], ring)) points.push([x, z, ctx.groundAt(x, z)]);
  }
  const heights = points.map(([, , y]) => y);
  const relief = (Math.max(...heights) - Math.min(...heights)) / M(1);
  if (points.length < 6 || relief < STEPS_MIN_RELIEF_M) {
    ctx.skipped.push(`${o.id} (${o.subtype}, terrain relief ${relief.toFixed(2)} m: steps not modelled)`);
    return false;
  }
  // least-squares plane y = a x + b z + c
  const n = points.length;
  const mean = points.reduce((acc, p) => [acc[0] + p[0] / n, acc[1] + p[1] / n, acc[2] + p[2] / n], [0, 0, 0]);
  let sxx = 0, sxz = 0, szz = 0, sxy = 0, szy = 0;
  for (const [x, z, y] of points) {
    const dx = x - mean[0];
    const dz = z - mean[1];
    const dy = y - mean[2];
    sxx += dx * dx; sxz += dx * dz; szz += dz * dz; sxy += dx * dy; szy += dz * dy;
  }
  const det = sxx * szz - sxz * sxz || 1;
  const a = (sxy * szz - szy * sxz) / det;
  const b = (szy * sxx - sxy * sxz) / det;
  const length = Math.hypot(a, b) || 1;
  const up = [a / length, b / length];
  const along = ring.map(([x, z]) => x * up[0] + z * up[1]);
  const s0 = Math.min(...along);
  const s1 = Math.max(...along);
  const count = Math.max(2, Math.min(40, Math.round(relief / STEP_RISE_M)));
  const striped = /striped/.test(o.p.note ?? "");
  const [even, odd] = /red/.test(o.p.note ?? "") ? [C.red, C.white] : /tan|brown/.test(o.p.note ?? "") ? [C.tan, C.brown] : [C.concrete, C.offWhite];
  for (let k = 0; k < count; k += 1) {
    const lo = s0 + ((s1 - s0) * k) / count;
    const hi = s0 + ((s1 - s0) * (k + 1)) / count;
    const band = clipHalf(clipHalf(ring, up, lo), [-up[0], -up[1]], -hi);
    if (band.length < 3 || Math.abs(ringArea(band)) < M(0.2) * M(0.2)) continue;
    const top = ctx.maxGround(band) + M(0.03);
    ctx.solid.prism(band, ctx.minGround(band) - M(0.1), top, { side: C.offWhite, top: striped && k % 2 ? odd : even });
  }
  return true;
}

// ---------------------------------------------------------------- plaza benches (VR)
// VR scene_c1 shows long dark-blue box benches beside the square tree pits on both long sides of the central pond;
// the photo cannot resolve them (tree crowns), so they are placed from VR: PLAZA_BENCHES per side, PLAZA_BENCH_SPACING_M
// apart, PLAZA_BENCH_OFFSET_M outside the pond's long sides (ESTIMATED positions). The benches the old walkway rule put
// every 54 m along the A003 outlines are gone: neither the photo nor the VR shows a bench at those spots.
const PLAZA_BENCHES = 4;
const PLAZA_BENCH_SPACING_M = 7;
const PLAZA_BENCH_OFFSET_M = 4.5;

function estimateBenches(ctx) {
  const benches = [];
  const pond = ctx.objects.find((o) => o.subtype === "pond");
  if (pond) {
    const r = orientedRect(pond.ring);
    const f = frame([r.centre[0], 0, r.centre[1]], r.u);
    for (const side of [-1, 1]) {
      for (let k = 0; k < PLAZA_BENCHES; k += 1) {
        const s = (k - (PLAZA_BENCHES - 1) / 2) * PLAZA_BENCH_SPACING_M;
        const at = localPlan(f, s, side * (r.halfWidth + PLAZA_BENCH_OFFSET_M));
        benches.push({ at, u: r.u, faces: localPlan(f, s, 0), lengthM: 4, plaza: true });
      }
    }
  }
  return benches;
}

// ---------------------------------------------------------------- build (after the ground)
// An object on a roof (site-detail `roof_m`, e.g. the A1 roof garden of VR scene_a5): built as on the terrain raised by
// roof_m metres, into the same kits.
export function onRoof(ctx, roofM) {
  const lifted = makeContext({ groundAt: (x, z) => ctx.groundAt(x, z) + M(roofM), objects: ctx.objects, roads: ctx.roads, sites: ctx.sites, fieldCentre: ctx.fieldCentre });
  return Object.assign(lifted, { solid: ctx.solid, glass: ctx.glass, glow: ctx.glow, screen: ctx.screen, screens: ctx.screens, skipped: ctx.skipped, signals: ctx.signals });
}

export function buildFurniture({ glb, furniture, lamps, lampStats, sites, inputs, groundAt }) {
  const roads = roadNetwork(inputs);
  const ctx = makeContext({ groundAt, objects: furniture.objects, roads, sites, fieldCentre: furniture.fieldCentre });
  ctx.signalIndex = 0;
  ctx.signals = [];
  const counts = {};
  const tally = (kind, estimated) => {
    counts[kind] ??= { surveyed: 0, estimated: 0 };
    counts[kind][estimated ? "estimated" : "surveyed"] += 1;
  };
  const built = [];
  const restSpaces = [];
  for (const o of furniture.objects) {
    if (o.kind === "street_lamp") continue;
    const builder = B[o.kind];
    if (!builder) throw new Error(`furniture: no builder for ${o.kind} (${o.id})`);
    const before = ctx.solid.triangleCount + ctx.glass.triangleCount;
    if (builder(o.p.roof_m ? onRoof(ctx, o.p.roof_m) : ctx, o) === false) continue;
    const kind = o.kind === "plaza_structure" ? `plaza_structure/${o.subtype}` : o.kind;
    // Objects of rest-spaces.geojson and site-detail.geojson are placed from the VR, not surveyed on the photo: counted as estimated.
    tally(kind, o.source === "rest-spaces" || o.source === "site-detail");
    built.push([o.id, kind, Number(o.heightM.toFixed(2)), o.heightSource, 1, ctx.solid.triangleCount + ctx.glass.triangleCount - before]);
    // rest-space instances: catalogue kinds given dims, or survey objects retyped to a catalogue kind
    if (REST_TYPES[o.kind] && (o.source === "rest-spaces" || o.p.dims !== undefined || o.surveyKind !== o.kind)) restSpaces.push([o.id, o.kind, REST_TYPES[o.kind].dimsSource, o.p.vr_scene ?? null, o.p.photo_support ?? null, true]);
  }
  appendLampSolids(ctx.solid, lamps, groundAt);
  for (const lamp of lamps) tally(`street_lamp/${lamp.type}`, false);
  const benches = estimateBenches(ctx);
  for (const bench of benches) {
    const f = facingFrame(ctx, bench.at, bench.u, bench.faces);
    if (bench.plaza) benchAt(ctx, f, bench.lengthM, { back: false, seat: C.plazaBench, legs: C.plazaBench, depthM: 0.5 });
    else benchAt(ctx, f, bench.lengthM);
    tally(bench.plaza ? "bench/plaza (VR)" : "bench", true);
  }

  // per-kind provenance of the rest spaces (VR-located features and survey objects retyped to a catalogue kind)
  const restSpaceKinds = {};
  for (const [id, kind, dimsSource, scene, support] of restSpaces) {
    const entry = (restSpaceKinds[kind] ??= { label: `${REST_TYPES[kind].label} (추정)`, count: 0, estimated: true, dimsSource, ids: [], vrScenes: [], photoSupport: {} });
    entry.count += 1;
    entry.ids.push(id);
    const o = furniture.objects.find((q) => q.id === id);
    const vrScene = scene ?? /scene_[a-z0-9]+/.exec(furniture.retyped[id]?.reason ?? "")?.[0] ?? null;
    if (vrScene && !entry.vrScenes.includes(vrScene)) entry.vrScenes.push(vrScene);
    const key = support ?? (o.source === "survey" ? "survey outline" : "none");
    entry.photoSupport[key] = (entry.photoSupport[key] ?? 0) + 1;
  }
  const duplicates = auditDuplicates(furniture.objects, lamps, benches);
  const furnitureMaterial = glb.addMaterial({ name: "Furniture", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.82 } });
  const glassMaterial = glb.addMaterial({ name: "Furniture_Glass", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.35 }, alphaMode: "BLEND", doubleSided: true });
  const extras = {
    source: "data/photo/objects-campus.geojson (NGII 2025 orthophoto survey, 175 objects; positions from the photo) and data/photo/rest-spaces.geojson (VR-located rest spaces, the A19 gate sign and the RS-LS VR landscape items: steps, the A1 pond, a sign stone, a PM rack; positions estimated) and data/photo/site-detail.geojson (VR station site detail within about 40 m: clipped hedges and shrub masses, lawn islands, tree pits, car-park stall rows and wheel stops, an entrance stair; positions on the photo or registered VR nadir faces, standard dimensions estimated); shapes, colours and heights estimated from the SCNU 360 VR tour (visual reference only)",
    heightsNote: "every height is an estimate, not a measurement; objects lists [id, kind, height m, height source, estimated]",
    counts,
    excluded: furniture.excluded,
    retyped: Object.fromEntries(Object.entries(furniture.retyped).map(([id, r]) => [id, `${r.kind}: ${r.reason}`])),
    photoOnly: ctx.skipped,
    estimatedBenchesNote: `estimated positions: ${benches.length} plaza benches from VR scene_c1 (no rule-placed benches)`,
    // standing poles: [id, kind, pole verdict, shift from the survey m, residual m, x, z (scene units)]
    // signals: [id, approach centreline id or "photo-arm", RD_ id, heads facing bearing deg, arm m]
    signals: ctx.signals,
    poles: furniture.objects.filter((o) => POLE_KINDS.has(o.kind) && o.point).map((o) => [o.id, o.kind, o.pole?.verdict ?? "unreviewed", o.pole?.shiftM ?? 0, o.pole?.residualM ?? null, Number(o.point[0].toFixed(2)), Number(o.point[1].toFixed(2))]),
    objects: built.map(([id, kind, h, source, estimated]) => [id, kind, h, source, estimated]),
    // [x, z (scene units), length m, 1 = plaza bench from VR]
    estimatedBenches: benches.map((b) => [Number(b.at[0].toFixed(2)), Number(b.at[1].toFixed(2)), b.lengthM, b.plaza ? 1 : 0]),
    ...(restSpaces.length ? {
      restSpacesNote: "parametric rest spaces from data/rest-space-catalogue.json: [id, kind, dimsSource, VR scene, photo support, estimated]; every dimension is an estimate (추정)",
      restSpaces,
      restSpaceKinds,
    } : {}),
    duplicateAudit: { radiusM: 3, rule: "same class (roofed kinds one class, plaza structures by subtype, the rest by kind) over survey, rest spaces, lamps and estimated benches", pairs: duplicates, compounds: AUDIT_COMPOUNDS },
  };
  glb.addNode({ name: "Furniture", mesh: glb.addMesh("Furniture", [ctx.solid.toPrimitive(furnitureMaterial)]), extras }, { root: true });
  glb.addNode({ name: "Furniture_Glass", mesh: glb.addMesh("Furniture_Glass", [ctx.glass.toPrimitive(glassMaterial)]) }, { root: true });
  // pool water (P.pond): glossy, slightly transparent, so the sky environment reflects in it; vertex colour = water tint
  if (ctx.water.vertexCount) {
    const waterMaterial = glb.addMaterial({
      name: "Furniture_Water",
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.82], metallicFactor: 0, roughnessFactor: 0.06 },
      alphaMode: "BLEND",
      extras: { note: "pool water: the dashboard raises its opacity toward grazing views (fresnel, src/lighting/water.mjs)" },
    });
    glb.addNode({ name: "Furniture_Water", mesh: glb.addMesh("Furniture_Water", [ctx.water.toPrimitive(waterMaterial)]) }, { root: true });
  }
  // LED screens (B.led_screen): one colour-field texture, 8 px per field, base colour by day and emissive map at night.
  if (ctx.screens.length) {
    const fields = ctx.screens.flatMap((s) => s.fields);
    const w = fields.length * 8;
    const pixels = new Uint8Array(w * 8 * 3);
    fields.forEach((hex, i) => {
      const n = Number.parseInt(hex.slice(1), 16);
      for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) pixels.set([n >> 16, (n >> 8) & 255, n & 255], (y * w + i * 8 + x) * 3);
    });
    const texture = glb.addTexture(encodePng(w, 8, 3, pixels), "image/png", { repeat: false });
    glb.extensionsUsed.add("KHR_materials_emissive_strength");
    const screenMaterial = glb.addMaterial({
      name: "Furniture_Screen",
      pbrMetallicRoughness: { baseColorTexture: { index: texture }, metallicFactor: 0, roughnessFactor: 0.4 },
      emissiveFactor: [1, 1, 1],
      emissiveTexture: { index: texture },
      extensions: { KHR_materials_emissive_strength: { emissiveStrength: 1.5 } },
    });
    let start = 0;
    for (const s of ctx.screens) {
      // u over this screen's fields (texel centres at the ends), v 0 at the top
      const [u0, u1] = [(start * 8 + 0.5) / w, ((start + s.fields.length) * 8 - 0.5) / w];
      start += s.fields.length;
      const base = ctx.screen.mesh.vertexCount;
      [[u0, 1], [u1, 1], [u1, 0], [u0, 0]].forEach((uv, i) => ctx.screen.mesh.vertex(s.corners[i], s.normal, uv));
      ctx.screen.mesh.triangle(base, base + 1, base + 2);
      ctx.screen.mesh.triangle(base, base + 2, base + 3);
    }
    glb.addNode({ name: "Furniture_Screen", mesh: glb.addMesh("Furniture_Screen", [ctx.screen.toPrimitive(screenMaterial)]), extras: { screens: ctx.screens.map((s) => [s.id, s.fields]), note: "LED screens as plain colour fields, no image (estimated)" } }, { root: true });
  }

  const summary = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([kind, c]) => `${kind} ${c.surveyed}${c.estimated ? `+${c.estimated}e` : ""}`).join(", ");
  console.log(
    `furniture: ${built.filter(([id]) => !id.startsWith("RS") && !id.startsWith("SD")).length} surveyed objects + ${built.filter(([id]) => id.startsWith("RS")).length} VR-placed (rest-spaces.geojson) + ${built.filter(([id]) => id.startsWith("SD")).length} VR site detail (site-detail.geojson) + ${lamps.length} lamps at photo pole bases + ${benches.length} VR plaza benches (추정); ` +
    `Furniture ${ctx.solid.triangleCount} triangles / ${ctx.solid.vertexCount} vertices, Furniture_Glass ${ctx.glass.triangleCount} triangles; ${summary}`,
  );
  for (const { id, reason } of furniture.excluded) console.log(`furniture: left out ${id}: ${reason}`);
  for (const [id, r] of Object.entries(furniture.retyped)) console.log(`furniture: ${id} built as ${r.kind}: ${r.reason}`);
  for (const line of ctx.skipped) console.log(`furniture: photo only ${line}`);
  for (const [kind, entry] of Object.entries(restSpaceKinds)) console.log(`furniture: rest space ${kind} ${entry.count} (${entry.label}; ${entry.vrScenes.join(", ")}; ${Object.entries(entry.photoSupport).map(([k, v]) => `${k} ${v}`).join(", ")})`);
  console.log(`furniture: duplicate audit (3 m, same class): ${duplicates.length} pairs${duplicates.length ? ` ${JSON.stringify(duplicates)}` : ""}`);
  return { glow: ctx.glow, counts, benches: benches.length };
}

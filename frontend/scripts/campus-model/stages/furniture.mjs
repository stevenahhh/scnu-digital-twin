// Furniture stage: every outdoor object of data/photo/objects-campus.geojson (the campus-wide NGII 2025 orthophoto
// survey, data/photo/README.md) at its surveyed position, with shapes, colours and heights estimated from the SCNU
// 360 VR tour (visual reference only), plus rule-based estimated benches. Two merged primitives:
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
import { METRES_PER_DEGREE_LAT, METRES_PER_DEGREE_LON, geoToModel, metres, modelToGeo } from "../lib/frame.mjs";
import { pointInRing, ringArea, ringCentroid } from "../lib/geometry.mjs";
import { mulberry32 } from "../lib/raster.mjs";
import { Kit, along, bufferLine, frame, lineLength, local, localPlan, offsetLine, orientedRect, rgb, sub, toLocal } from "../lib/solids.mjs";
import { GLOW_UV, LAMP_SPACING_M, appendLampSolids, distanceToLines, objectDistance, roadNetwork, towardRoad } from "./lights.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OBJECTS = path.join(HERE, "..", "data", "photo", "objects-campus.geojson");
// VR-located rest spaces and the A19 gate sign (estimated; README "Street furniture"), read after the survey.
const REST_SPACES = path.join(HERE, "..", "data", "photo", "rest-spaces.geojson");
const GROUND_FEATURES = path.join(HERE, "..", "data", "osm-ground.json");
const M = metres;

// ---------------------------------------------------------------- decisions taken against the survey
// Each is documented in README "Street furniture"; the build log repeats them.
const EXCLUDED = {
  OC0111: "SCNU letter monument: superseded by RS-GATE-A19 (data/photo/rest-spaces.geojson, gate_sign), placed from VR scene_a19 (and scene_001) about 13 m further south at the plaza's road edge; the 2025 photo shows that corner of the gate plaza under construction, so this survey position (VR only, confidence 0.2) is left out",
};
const RETYPED = {
  OB0010: {
    kind: "stepped_arc",
    reason: "surveyed as a white roofed pergola, but VR scene_a19 shows no roof there, only the stepped arc of the finished gate plaza, and the photo shows a curved edge with a thin shadow; built as a two-tier curved step (0.45 m)",
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

const ROOFED = new Set(["bus_stop_shelter", "pergola", "gazebo", "bike_rack", "reviewing_stand", "stadium_seating", "trash_station", "pavilion_hip", "pavilion_octagon", "canopy_shelter_row", "terminal_shelter", "awning", "hut"]);
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
  const features = [
    ...data.features.map((f) => ({ ...f, source: "objects-campus.geojson" })),
    ...rest.features.map((f) => ({ ...f, source: "rest-spaces.geojson" })),
  ];
  for (const { properties: p, geometry: g, source } of features) {
    if (EXCLUDED[p.id]) {
      excluded.push({ id: p.id, kind: p.kind, reason: EXCLUDED[p.id] });
      continue;
    }
    const toModel = ([lon, lat]) => geoToModel(lon, lat);
    const object = { id: p.id, kind: RETYPED[p.id]?.kind ?? p.kind, surveyKind: p.kind, subtype: p.subtype ?? null, p, source, ...heightOf(p) };
    if (g.type === "Point") object.point = toModel(g.coordinates);
    else if (g.type === "LineString") object.line = g.coordinates.map(toModel);
    else object.ring = openRing(g.coordinates[0].map(toModel));
    // Roofs were outlined on the photo, so they include the relief lean; the footprint is the outline moved back.
    if ((ROOFED.has(object.kind) || ROOFED_SUBTYPES.has(object.subtype)) && (object.ring || object.line)) {
      object.photoRing = object.ring ?? bufferLine(object.line, M((p.width_m ?? 2) / 2));
      const [dx, dz] = leanOffset(ringCentroid(object.photoRing), object.heightM);
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
  const glass = new Kit();
  const glow = new Kit({ uvs: true });
  const samples = (ring) => [...ring, ringCentroid(ring), ...ring.map((p, i) => [(p[0] + ring[(i + 1) % ring.length][0]) / 2, (p[1] + ring[(i + 1) % ring.length][1]) / 2])];
  const heights = (ring) => samples(ring).map(([x, z]) => groundAt(x, z)).sort((a, b) => a - b);
  return {
    solid, glass, glow, groundAt, objects, roads, sites, fieldCentre, colours: C,
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
// bearing_deg (clockwise from north, default 0). lengthM/widthM are the outline's sizes (null for a point).
function restPlacement(ctx, o) {
  const ring = o.footprint ?? o.ring;
  if (ring) {
    const r = orientedRect(ring);
    return { centre: r.centre, u: r.u, lengthM: 2 * r.halfLength, widthM: 2 * r.halfWidth, ground: ctx.medianGround(ring) };
  }
  if (!o.point) throw new Error(`furniture: ${o.kind} ${o.id} needs a Point or a Polygon`);
  const bearing = ((o.p.bearing_deg ?? 0) * Math.PI) / 180;
  return { centre: o.point, u: [Math.sin(bearing), -Math.cos(bearing)], lengthM: null, widthM: null, ground: ctx.groundAt(...o.point) };
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
function axisOf(o) {
  const line = o.axis ?? o.line;
  if (!line) throw new Error(`furniture: ${o.kind} ${o.id} needs a LineString axis, not a ${o.point ? "Point" : "Polygon"}`);
  return line;
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

B.planter = (ctx, o) => {
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
  const count = long ? 1 : Math.max(1, Math.round(length / 2.4));
  const each = long ? length : Math.min(1.8, length / count - 0.3);
  for (let k = 0; k < count; k += 1) {
    const c = [a[0] + (b[0] - a[0]) * ((k + 0.5) / count), a[1] + (b[1] - a[1]) * ((k + 0.5) / count)];
    const side = [c[0] - u[1] * M(1), c[1] + u[0] * M(1)];
    const paved = ctx.sites.inArea(side) || [ctx.sites.classes.PAVING, ctx.sites.classes.ASPHALT].includes(ctx.sites.labelAt(side));
    const f = facingFrame(ctx, c, u, paved ? side : [c[0] + u[1] * M(1), c[1] - u[0] * M(1)]);
    benchAt(ctx, f, each, { back: !long, seat: long ? C.white : C.wood });
  }
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
  S.box(f, [-hs, hs], [-ht, ht], [-0.1, wallTop], { top: wall, side: wall });
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
    S.box(f, [-hs, hs], [-ht, ht], [-0.1, F - 0.06], C.stone);
    S.box(f, [-hs + 0.02, hs - 0.02], [-ht + 0.02, ht - 0.02], [F - 0.06, F], { top: C.timber, side: C.wood });
    if (F > 0.25) S.box(f, [-0.7, 0.7], [-ht - Math.min(0.4, ov), -ht], [-0.1, F / 2], C.stone);
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
// octagonal canopy with a vented two-tier crown held by one offset mast): with support "posts" (default) eight columns
// on an optional raised octagonal deck and an eave ring; with support "cantilever" a mast outside the canopy on a
// white pad, an arm to the crown and a hub. Roof: octagon of circumscribed diameter circumscribedM from the fascia at
// eaveHeightM to apexHeightM, one plane per side (tiers 2: a skirt, a vent gap and a raised crown), ribs in trimColour.
// A survey outline gives the diameter when circumscribedM is not set.
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
    S.prism(planRing(R - 0.35), at.ground - M(0.1), at.ground + M(F - 0.06), C.stone);
    S.prism(planRing(R - 0.37), at.ground + M(F - 0.06), at.ground + M(F), { side: C.wood, top: C.timber });
  }
  if ((o.p.support ?? "posts") === "cantilever") {
    const mast = R + 0.35;
    S.box(f, [mast - 0.6, mast + 0.6], [-0.6, 0.6], [-0.05, 0.12], C.offWhite);
    S.pole(localPlan(f, mast, 0), at.ground - M(0.1), at.ground + M(A - 0.15), 0.08, 0.07, posts);
    S.beam(local(f, mast, 0, A - 0.25), local(f, 0, 0, A - 0.25), 0.1, 0.1, posts);
    S.beam(local(f, mast, 0, A - 1.1), local(f, mast * 0.45, 0, A - 0.3), 0.07, 0.07, posts);
    S.pole(localPlan(f, 0, 0), at.ground + M(E - 0.2), at.ground + M(A - 0.2), 0.05, 0.05, posts);
  } else {
    const columns = planRing(R - 0.55);
    for (const p of columns) S.pole(p, at.ground + M(F > 0 ? F : -0.1), at.ground + M(E), d.columnSizeM / 2, d.columnSizeM / 2, posts, { sides: 4 });
    const tops = ring(R - 0.55, E - 0.12);
    for (let i = 0; i < n; i += 1) S.beam(tops[i], tops[(i + 1) % n], 0.14, 0.24, posts, { ends: false });
  }
  const fascia = 0.12;
  const eave = ring(R, E);
  const edge = ring(R, E + fascia);
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const mid = local(f, Math.cos((angle(i) + angle(j)) / 2) * R, Math.sin((angle(i) + angle(j)) / 2) * R, E);
    S.face([eave[i], eave[j], edge[j], edge[i]], sub(mid, local(f, 0, 0, E)), trim);
  }
  const apex = local(f, 0, 0, A);
  const rib = (a, b) => S.beam([a[0], a[1] - M(0.04), a[2]], [b[0], b[1] - M(0.04), b[2]], 0.08, 0.07, trim, { ends: false });
  if ((o.p.tiers ?? 1) === 2) {
    // skirt up to the vent, then the crown (both sides of the skirt drawn: it is seen from below through the vent)
    const crownR = 0.32 * R;
    const ventH = E + fascia + (A - E - fascia) * 0.68;
    const vent = ring(crownR, ventH);
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      const quad = [edge[i], edge[j], vent[j], vent[i]];
      const out = sub(local(f, Math.cos((angle(i) + angle(j)) / 2) * R, Math.sin((angle(i) + angle(j)) / 2) * R, A), local(f, 0, 0, E));
      S.face(quad, out, roof);
      S.face(quad, [-out[0], -out[1], -out[2]], C.offWhite);
      rib(edge[i], vent[i]);
    }
    const crown = ring(crownR * 1.4, ventH - 0.14);
    S.cone(apex, crown, roof, { basePaint: C.offWhite });
    for (const p of crown) rib(p, apex);
  } else {
    S.cone(apex, edge, roof, { basePaint: C.offWhite });
    for (const p of edge) rib(p, apex);
  }
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

// Signal poles (VR scene_a19): the mast arm reaches over the arterial the signal controls, past its OSM centreline by
// SIGNAL_ARM_PAST_M (clamped to 3.5-9 m); away from the arterial it reaches toward the nearest carriageway.
const SIGNAL_ARM_PAST_M = 1.5;
B.traffic_signal_pole = (ctx, o) => {
  const at = o.point;
  const g = ctx.groundAt(...at);
  const arterial = towardRoad(at, { arterials: ctx.roads.arterials, connectors: [], zoneRings: [] }, 30);
  const dir = arterial ?? towardRoad(at, ctx.roads) ?? [1, 0];
  const f = frame([at[0], g, at[1]], dir);
  const lines = arterial ? ctx.roads.arterials : [...ctx.roads.arterials, ...ctx.roads.connectors];
  const reach = distanceToLines(at, lines) / M(1);
  const arm = Math.max(3.5, Math.min(9, reach + SIGNAL_ARM_PAST_M));
  ctx.solid.box(f, [-0.3, 0.3], [-0.3, 0.3], [-0.1, 0.25], C.concrete);
  ctx.solid.pole(at, g - M(0.1), g + M(6.6), 0.15, 0.11, C.signalPole);
  ctx.solid.beam(local(f, 0, 0, 6.15), local(f, arm, 0, 6.15), 0.13, 0.13, C.signalPole);
  ctx.solid.beam(local(f, 0, 0, 5.3), local(f, Math.min(2.2, arm * 0.4), 0, 6.1), 0.06, 0.06, C.signalPole);
  const lit = ctx.signalIndex++ % 2 === 0 ? GLOW_UV.red : GLOW_UV.green;
  for (const s of [arm - 0.8, arm * 0.55]) {
    ctx.solid.box(f, [s - 0.66, s + 0.66], [-0.17, 0.17], [5.62, 6.0], C.black);
    for (const side of [-1, 1]) {
      [-0.45, -0.15, 0.15, 0.45].forEach((ds, k) => {
        const t = side * 0.176;
        const uv = side < 0 ? (k === 0 ? lit : GLOW_UV.dark) : (k === 3 ? (lit === GLOW_UV.red ? GLOW_UV.green : GLOW_UV.red) : GLOW_UV.dark);
        ctx.glow.face([local(f, s + ds - 0.1, t, 5.71), local(f, s + ds + 0.1, t, 5.71), local(f, s + ds + 0.1, t, 5.91), local(f, s + ds - 0.1, t, 5.91)], [f.v[0] * side, 0, f.v[1] * side], uv);
      });
    }
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
// Central plaza pond (VR scene_c1): coping wall, a planted island at the west end with a stone plinth and a bronze
// sculpture. The water surface is left to the ground stage (OSM water as a painted Ground_Sports surface).
P.pond = (ctx, o) => {
  const sign = insideSign(o.ring);
  wall(ctx, ctx.solid, o.ring, 0.5, 0.45, C.stone, { closed: true, offsetM: sign * 0.25 });
  const r = orientedRect(o.ring);
  const west = r.u[0] > 0 ? -1 : 1;
  const f = frame([r.centre[0], 0, r.centre[1]], r.u);
  const centre = localPlan(f, west * 0.52 * r.halfLength, 0);
  const g = ctx.groundAt(...centre);
  const island = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    return localPlan(f, west * 0.52 * r.halfLength + Math.cos(a) * 0.3 * r.halfLength, Math.sin(a) * 0.5 * r.halfWidth);
  });
  ctx.solid.prism(island, g - M(0.1), (x, z) => ctx.groundAt(x, z) + M(0.28), { side: C.stone, top: C.soil });
  // dense shrubs over the island (VR scene_c1)
  const rng = mulberry32(81);
  for (let k = 0; k < 22; k += 1) {
    const a = rng() * Math.PI * 2;
    const radius = Math.sqrt(rng());
    const p = localPlan(f, west * 0.52 * r.halfLength + Math.cos(a) * radius * 0.24 * r.halfLength, Math.sin(a) * radius * 0.4 * r.halfWidth);
    const size = 0.55 + rng() * 0.6;
    const y = ctx.groundAt(...p) + M(0.2);
    ctx.solid.cone([p[0], y + M(size * 1.25), p[1]], disc(p, M(size), 6).map(([x, z]) => [x, y, z]), k % 3 ? C.shrub : C.roofGreen, { base: false });
  }
  const plinth = frame([centre[0], g, centre[1]], r.u);
  ctx.solid.box(plinth, [-0.8, 0.8], [-0.8, 0.8], [0.2, 1.6], C.offWhite);
  // bronze sculpture: a curved form about 2.6 m tall on the plinth
  const form = [[0.1, 0, 1.6], [0.45, 0.1, 2.4], [0.3, 0.15, 3.3], [-0.25, 0.12, 3.95], [-0.8, 0.05, 4.0], [-1.0, 0, 3.6]];
  for (let k = 0; k + 1 < form.length; k += 1) ctx.solid.beam(local(plinth, ...form[k]), local(plinth, ...form[k + 1]), 0.75 - k * 0.1, 0.55 - k * 0.07, C.bronze);
};
P.parasol = (ctx, o) => {
  const c = ringCentroid(o.footprint);
  const g = ctx.groundAt(...c);
  const radius = Math.sqrt(Math.abs(ringArea(o.footprint)) / Math.PI);
  const colour = /blue/.test(o.p.note ?? "") ? C.roofBlue : C.white;
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

// ---------------------------------------------------------------- estimated benches
// VR scene_c1 shows long dark-blue box benches beside the square tree pits on both long sides of the central pond;
// the photo cannot resolve them (tree crowns), so they are placed from VR: PLAZA_BENCHES per side, PLAZA_BENCH_SPACING_M
// apart, PLAZA_BENCH_OFFSET_M outside the pond's long sides. Elsewhere one bench every BENCH_SPACING_M along the A003
// walkway outlines, on the lawn just outside the paved edge and facing it. Both are ESTIMATED positions.
const PLAZA_BENCHES = 4;
const PLAZA_BENCH_SPACING_M = 7;
const PLAZA_BENCH_OFFSET_M = 4.5;
const BENCH_SPACING_M = 2 * LAMP_SPACING_M;
const BENCH_CLEARANCE_M = 30;
const BENCH_OUTSIDE_M = 0.9;

function estimateBenches(ctx, lamps) {
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
  const { walkways, inArea, isRoad, onCampus, labelAt, classes } = ctx.sites;
  const spacing = M(BENCH_SPACING_M);
  const clear = (p) =>
    !ctx.objects.some((o) => objectDistance(p, o) < M(1.5)) &&
    !lamps.some((lamp) => Math.hypot(lamp.at[0] - p[0], lamp.at[1] - p[1]) < M(1.5)) &&
    !benches.some((b) => Math.hypot(b.at[0] - p[0], b.at[1] - p[1]) < M(BENCH_CLEARANCE_M));
  for (const w of walkways) {
    for (const outline of w.lines) {
      for (const { p, u } of along(outline, spacing).slice(1, -1)) {
        const n = [-u[1], u[0]];
        for (const side of [1, -1]) {
          const out = [p[0] + n[0] * side * M(BENCH_OUTSIDE_M), p[1] + n[1] * side * M(BENCH_OUTSIDE_M)];
          const beyond = [p[0] + n[0] * side * M(BENCH_OUTSIDE_M + 1.2), p[1] + n[1] * side * M(BENCH_OUTSIDE_M + 1.2)];
          const inside = [p[0] - n[0] * side * M(0.6), p[1] - n[1] * side * M(0.6)];
          if (inArea(out) || !inArea(inside)) continue;
          if (labelAt(out) !== classes.NATURAL || labelAt(beyond) !== classes.NATURAL) continue;
          if (!onCampus(out) || isRoad(out) || isRoad(beyond) || !clear(out)) continue;
          benches.push({ at: out, u, faces: inside, lengthM: 1.8, plaza: false });
          break;
        }
      }
    }
  }
  return benches;
}

// ---------------------------------------------------------------- build (after the ground)
export function buildFurniture({ glb, furniture, lamps, lampStats, sites, inputs, groundAt }) {
  const roads = roadNetwork(inputs);
  const ctx = makeContext({ groundAt, objects: furniture.objects, roads, sites, fieldCentre: furniture.fieldCentre });
  ctx.signalIndex = 0;
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
    if (builder(ctx, o) === false) continue;
    const kind = o.kind === "plaza_structure" ? `plaza_structure/${o.subtype}` : o.kind;
    // Objects of rest-spaces.geojson are placed from the VR, not surveyed on the photo: counted as estimated.
    tally(kind, o.source === "rest-spaces.geojson");
    built.push([o.id, kind, Number(o.heightM.toFixed(2)), o.heightSource, 1, ctx.solid.triangleCount + ctx.glass.triangleCount - before]);
    // rest-space instances: catalogue kinds given dims, or survey objects retyped to a catalogue kind
    if (REST_TYPES[o.kind] && (o.p.dims !== undefined || o.surveyKind !== o.kind)) restSpaces.push([o.id, o.kind, REST_TYPES[o.kind].dimsSource, o.p.vr_scene ?? null, o.p.photo_support ?? null, true]);
  }
  appendLampSolids(ctx.solid, lamps, groundAt);
  for (const lamp of lamps) tally(`street_lamp/${lamp.type}`, lamp.estimated);
  const benches = estimateBenches(ctx, lamps);
  for (const bench of benches) {
    const f = facingFrame(ctx, bench.at, bench.u, bench.faces);
    if (bench.plaza) benchAt(ctx, f, bench.lengthM, { back: false, seat: C.plazaBench, legs: C.plazaBench, depthM: 0.5 });
    else benchAt(ctx, f, bench.lengthM);
    tally(bench.plaza ? "bench/plaza (VR)" : "bench", true);
  }

  const furnitureMaterial = glb.addMaterial({ name: "Furniture", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.82 } });
  const glassMaterial = glb.addMaterial({ name: "Furniture_Glass", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.35 }, alphaMode: "BLEND", doubleSided: true });
  const extras = {
    source: "data/photo/objects-campus.geojson (NGII 2025 orthophoto survey, 175 objects; positions from the photo) and data/photo/rest-spaces.geojson (VR-located rest spaces and the A19 gate sign; positions estimated); shapes, colours and heights estimated from the SCNU 360 VR tour (visual reference only)",
    heightsNote: "every height is an estimate, not a measurement; objects lists [id, kind, height m, height source, estimated]",
    counts,
    excluded: furniture.excluded,
    retyped: Object.fromEntries(Object.entries(furniture.retyped).map(([id, r]) => [id, `${r.kind}: ${r.reason}`])),
    photoOnly: ctx.skipped,
    estimatedBenchesNote: `estimated positions: ${benches.filter((b) => b.plaza).length} plaza benches from VR scene_c1 and one bench every ${BENCH_SPACING_M} m along the walkway outlines (not surveyed)`,
    objects: built.map(([id, kind, h, source, estimated]) => [id, kind, h, source, estimated]),
    // [x, z (scene units), length m, 1 = plaza bench from VR]
    estimatedBenches: benches.map((b) => [Number(b.at[0].toFixed(2)), Number(b.at[1].toFixed(2)), b.lengthM, b.plaza ? 1 : 0]),
    ...(restSpaces.length ? {
      restSpacesNote: "parametric rest spaces from data/rest-space-catalogue.json: [id, kind, dimsSource, VR scene, photo support, estimated]; every dimension is an estimate (추정)",
      restSpaces,
    } : {}),
  };
  glb.addNode({ name: "Furniture", mesh: glb.addMesh("Furniture", [ctx.solid.toPrimitive(furnitureMaterial)]), extras }, { root: true });
  glb.addNode({ name: "Furniture_Glass", mesh: glb.addMesh("Furniture_Glass", [ctx.glass.toPrimitive(glassMaterial)]) }, { root: true });

  const summary = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([kind, c]) => `${kind} ${c.surveyed}${c.estimated ? `+${c.estimated}e` : ""}`).join(", ");
  console.log(
    `furniture: ${built.length} surveyed objects + ${lamps.length} lamps (${lampStats.surveyed} surveyed) + ${benches.length} estimated benches; ` +
    `Furniture ${ctx.solid.triangleCount} triangles / ${ctx.solid.vertexCount} vertices, Furniture_Glass ${ctx.glass.triangleCount} triangles; ${summary}`,
  );
  for (const { id, reason } of furniture.excluded) console.log(`furniture: left out ${id}: ${reason}`);
  for (const [id, r] of Object.entries(furniture.retyped)) console.log(`furniture: ${id} built as ${r.kind}: ${r.reason}`);
  for (const line of ctx.skipped) console.log(`furniture: photo only ${line}`);
  return { glow: ctx.glow, counts, benches: benches.length };
}

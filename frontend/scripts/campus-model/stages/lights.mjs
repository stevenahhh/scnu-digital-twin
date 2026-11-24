// Lights stage: street lamps, with no real-time lights.
//   Lamp_Head    every luminaire (cobra heads, path lanterns) plus the traffic-signal lenses of stages/furniture.mjs,
//                one Lamp_Head primitive on each lamp's or signal's own node. An emissive mask texture picks the parts
//                that glow (lamp lenses warm white, the lit signal aspect red or green); CityModel drives the glow with
//                the night weight. The mesh-less Lamps_heads node keeps the lamp extras.
//   Lamps_pools  a ground-aligned disc under each lit head (Lamp_Pool, unlit, vertex-colour falloff) that CityModel
//                draws additively at night and hides by day.
// Poles, arms and footings are solid furniture: appendLampSolids() draws them into the lamp node's Furniture primitive.
// Positions: every street_lamp of data/photo/objects-campus.geojson (the by-eye photo survey and the data.go.kr
// 순천시_가로등 points it kept), moved to its pole base on the NGII 2025 photo (data/photo/pole-roots.json, written by
// fetch/poleRoots.mjs from the by-eye review and the shadow detector). Lamps the review rejects are left out, and so are
// the lamps the old walkway rule placed every 27 m: no photo shows a pole there. Unresolved lamps (no base visible) stay
// at their survey position (metre-level). checkPoles() keeps every standing pole off carriageways and out of buildings.
// Lamp heights, arm reach, head size and pool radii are ESTIMATED from the SCNU 360 VR tour (scene_a19: grey pole,
// single curved arm, LED cobra head on the arterial; slim dark post-top lanterns on campus paths).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENT, geoToModel, metres } from "../lib/frame.mjs";
import { pointInRing } from "../lib/geometry.mjs";
import { MeshData } from "../lib/meshData.mjs";
import { encodePng } from "../lib/png.mjs";
import { Raster } from "../lib/raster.mjs";
import { frame, local, rgb } from "../lib/solids.mjs";
import { readA003 } from "../lib/a003.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GROUND_FEATURES = path.join(HERE, "..", "data", "osm-ground.json");
const BICYCLE_LANE = "A0033327"; // as ground.mjs
export const POLE_KINDS = new Set(["street_lamp", "traffic_signal_pole", "sign_pole", "floodlight_pole"]);

const POOL_LIFT_M = 0.12;

// ESTIMATED luminaire types (VR scene_a19 and the campus panoramas). reach: arm reach of the head centre from the pole.
export const LAMP_TYPES = Object.freeze({
  arterial: { heightM: 8, reachM: 2.1, poolRadiusM: 7.5, label: "arterial cobra-head lamp, single curved arm" },
  campusRoad: { heightM: 6, reachM: 1.5, poolRadiusM: 5.5, label: "campus road lamp, single curved arm" },
  path: { heightM: 4, reachM: 0, poolRadiusM: 4.5, label: "campus path post-top lantern" },
});

// Emissive mask (32 x 32, see buildLights): UV centres of its bands. dark never glows.
export const GLOW_UV = Object.freeze({ dark: [0.125, 0.25], warm: [0.375, 0.25], red: [0.625, 0.25], green: [0.875, 0.25], amber: [0.375, 0.75] });

const GALVANISED = rgb("#9ea4a8");
const PATH_POLE = rgb("#3c4a48");
const FOOTING = rgb("#b5b2aa");

function nearestOnPolyline(p, line, closed = false) {
  let best = { distance: Infinity, point: null };
  const n = closed ? line.length : line.length - 1;
  for (let i = 0; i < n; i += 1) {
    const a = line[i];
    const b = line[(i + 1) % line.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    const q = [a[0] + t * dx, a[1] + t * dz];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < best.distance) best = { distance: d, point: q };
  }
  return best;
}

export function roadNetwork(inputs) {
  const osm = JSON.parse(readFileSync(GROUND_FEATURES, "utf8")).osm.lines ?? [];
  const toModel = (line) => line.map(([lon, lat]) => geoToModel(lon, lat));
  return {
    arterials: osm.filter((l) => l.kind === "arterial").map((l) => toModel(l.line)),
    connectors: osm.filter((l) => l.kind === "connector").map((l) => toModel(l.line)),
    zoneRings: inputs.roadZones.map((polygon) => polygon[0]),
  };
}

// Unit plan direction from p toward the nearest carriageway (OSM centrelines or road-zone edges), or null.
export function towardRoad(p, roads, maxM = 20) {
  let best = { distance: Infinity, point: null };
  for (const line of [...roads.arterials, ...roads.connectors]) {
    const hit = nearestOnPolyline(p, line);
    if (hit.distance < best.distance) best = hit;
  }
  for (const ring of roads.zoneRings) {
    const hit = nearestOnPolyline(p, ring, true);
    if (hit.distance < best.distance) best = hit;
  }
  if (!best.point || best.distance > metres(maxM) || best.distance < 1e-6) return null;
  return [(best.point[0] - p[0]) / best.distance, (best.point[1] - p[1]) / best.distance];
}

export const distanceToLines = (p, lines) => Math.min(Infinity, ...lines.map((line) => nearestOnPolyline(p, line).distance));

// Distance (scene units) from p to a surveyed object's geometry (0 inside a polygon).
export function objectDistance(p, object) {
  if (object.point) return Math.hypot(object.point[0] - p[0], object.point[1] - p[1]);
  if (object.ring) return pointInRing(p, object.ring) ? 0 : nearestOnPolyline(p, object.ring, true).distance;
  return nearestOnPolyline(p, object.line).distance;
}

// Nearest point within maxM of p that passes ok(), searched on rings every 0.25 m in 32 directions, then moved insetM
// further the same way; null when none.
export function nearestSite(p, ok, maxM = 4, insetM = 0.3) {
  for (let r = 0.25; r <= maxM; r += 0.25) {
    let best = null;
    for (let k = 0; k < 32; k += 1) {
      const a = (k / 32) * Math.PI * 2;
      const u = [Math.cos(a), Math.sin(a)];
      const q = [p[0] + u[0] * metres(r), p[1] + u[1] * metres(r)];
      const inset = [q[0] + u[0] * metres(insetM), q[1] + u[1] * metres(insetM)];
      if (ok(q) && ok(inset)) {
        best = inset;
        break;
      }
    }
    if (best) return best;
  }
  return null;
}

// Placement contract of every standing pole (lamps, signal, sign and floodlight poles):
//   - a pole whose base the photo or the VR shows (verdict shadow-root, by-eye-root, head-lean, vr-root, or epoch-root: read on other-year
//     aerials registered to the sheet) or whose seed the photo shows on
//     a median or island (site "median") stays off buildings only: the carriageway raster paints medians, islands and
//     narrow footways as asphalt, and the photo outranks it;
//   - any other pole (base not resolvable, metre-level seed) stays off carriageways (asphalt outside the A003 paved area)
//     and buildings, moved up to UNRESOLVED_MOVE_M (the seeds' own uncertainty);
//   - a pole that must move goes to the nearest allowed point (kerb or footprint edge plus 0.3 m) and is listed;
//   - one that cannot move, or two poles closer than POLE_MIN_SPACING_M, is an offender (the build fails).
export const POLE_MIN_SPACING_M = 1;
const EVIDENCE_MOVE_M = 4;
const UNRESOLVED_MOVE_M = 8;
export const PHOTO_BASE_VERDICTS = new Set(["shadow-root", "by-eye-root", "head-lean", "epoch-root", "vr-root"]);
export function checkPoles(poles, { onCarriageway, inBuilding }) {
  const moved = [];
  const offenders = [];
  for (const pole of poles) {
    const photoSite = PHOTO_BASE_VERDICTS.has(pole.pole?.verdict) || Boolean(pole.pole?.site);
    const allowed = photoSite ? (q) => !inBuilding(q) : (q) => !onCarriageway(q) && !inBuilding(q);
    if (allowed(pole.point)) continue;
    const why = inBuilding(pole.point) ? "building" : "carriageway";
    const to = nearestSite(pole.point, allowed, photoSite ? EVIDENCE_MOVE_M : UNRESOLVED_MOVE_M);
    if (!to) {
      offenders.push(`${pole.id} on a ${why}`);
      continue;
    }
    moved.push({ id: pole.id, kind: pole.kind, from: why, m: Number((Math.hypot(to[0] - pole.point[0], to[1] - pole.point[1]) / metres(1)).toFixed(2)) });
    pole.point = to;
  }
  for (let i = 0; i < poles.length; i += 1) {
    for (let j = i + 1; j < poles.length; j += 1) {
      const d = Math.hypot(poles[i].point[0] - poles[j].point[0], poles[i].point[1] - poles[j].point[1]) / metres(1);
      if (d < POLE_MIN_SPACING_M) offenders.push(`${poles[i].id} and ${poles[j].id} ${d.toFixed(2)} m apart`);
    }
  }
  return { moved, offenders };
}

// Lamp type: the surveyed type, else by where the lamp stands. The city lamp list (method data.go.kr) is not a type:
// it also holds lamps on campus roads and paths, which were all drawn as 8 m arterial cobra heads (41 of 50) while it
// decided the type. Heights and forms stay estimates.
export function lampTypeFor({ declared, styleForm, nearArterial, nearRoad }) {
  if (LAMP_TYPES[declared]) return declared;
  if (/arterial/.test(styleForm ?? "") || nearArterial) return "arterial";
  return nearRoad ? "campusRoad" : "path";
}

// Lamp list: the survey's street lamps at their photo pole roots (stages/furniture.mjs applies data/photo/pole-roots.json).
// groundInfo: the ground stage's surface-class raster. Also returns the site tests the furniture stage uses.
export function placeLamps({ inputs, furniture, selectableBuildings, campusBuildings, offCampusLots, groundInfo }) {
  const roads = roadNetwork(inputs);
  const buildingRings = [...selectableBuildings, ...campusBuildings].flatMap((b) => b.parts.map((part) => part.outer));
  const { width, height, px, labels, classes } = groundInfo;
  const toPixel = ([x, z]) => [(x - EXTENT.minX) * px, (z - EXTENT.minZ) * px];
  const indexOf = ([x, z]) => {
    const ix = Math.floor((x - EXTENT.minX) * px);
    const iy = Math.floor((z - EXTENT.minZ) * px);
    return ix < 0 || iy < 0 || ix >= width || iy >= height ? -1 : iy * width + ix;
  };
  const walkways = readA003().features
    .filter(({ properties }) => properties.scls !== BICYCLE_LANE)
    .map(({ geometry }) => {
      const lines = (geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates).map((line) => line.map(([lon, lat]) => geoToModel(lon, lat)));
      const rings = lines.filter((line) => line.length >= 4 && line[0][0] === line.at(-1)[0] && line[0][1] === line.at(-1)[1]);
      return { lines, rings };
    });
  // paved walkway area: closed rings filled even-odd per feature (a ring inside another is a hole)
  const area = new Raster(width, height);
  for (const w of walkways) if (w.rings.length) area.fillPolygon(w.rings.map((ring) => ring.map(toPixel)), () => [255, 0, 0]);
  const inArea = (p) => {
    const k = indexOf(p);
    return k >= 0 && area.data[k * 3] > 0;
  };
  const labelAt = (p) => {
    const k = indexOf(p);
    return k < 0 ? -1 : labels[k];
  };
  const onCarriageway = (p) => labelAt(p) === classes.ASPHALT && !inArea(p);
  const inBuilding = (p) => buildingRings.some((ring) => pointInRing(p, ring));

  const poles = furniture.objects.filter((o) => POLE_KINDS.has(o.kind) && o.point);
  const { moved, offenders } = checkPoles(poles, { onCarriageway, inBuilding });

  const lamps = [];
  for (const object of furniture.objects.filter((o) => o.kind === "street_lamp")) {
    const at = object.point;
    const p = object.p;
    const nearArterial = distanceToLines(at, roads.arterials) < metres(30);
    const nearRoad = towardRoad(at, roads, 6) !== null;
    const type = lampTypeFor({ declared: p.lamp_type, styleForm: p.style?.form, nearArterial, nearRoad });
    // the arm reaches over the nearest carriageway (OSM centreline or road-zone edge)
    const dir = towardRoad(at, roads) ?? [1, 0];
    lamps.push({ id: object.id, type, at, dir, heightM: LAMP_TYPES[type].heightM, source: p.method, pole: object.pole ?? { verdict: "unreviewed" } });
  }
  const verdicts = {};
  for (const lamp of lamps) verdicts[lamp.pole.verdict] = (verdicts[lamp.pole.verdict] ?? 0) + 1;
  const stats = {
    lamps: lamps.length,
    byType: Object.fromEntries(Object.keys(LAMP_TYPES).map((type) => [type, lamps.filter((l) => l.type === type).length])),
    verdicts,
    rejected: furniture.excluded.filter((e) => e.kind === "street_lamp").map((e) => e.id),
    movedOffSites: moved,
    offenders,
  };
  return { lamps, stats, sites: { walkways, inArea, onCarriageway, labelAt, classes } };
}

// The head centre of a lamp (scene units) and the frame its arm and head are built in.
function lampFrame(lamp, groundAt) {
  const [x, z] = lamp.at;
  return frame([x, groundAt(x, z), z], lamp.dir);
}

// Poles, arms and footings (solid furniture). Arterial and campus-road lamps share one shape scaled to their height.
export function appendLampSolids(kit, lamps, groundAt) {
  for (const lamp of lamps) {
    const f = lampFrame(lamp, groundAt);
    const k = lamp.heightM / LAMP_TYPES.arterial.heightM;
    const base = f.o[1] - metres(0.1);
    if (lamp.type === "path") {
      kit.box(f, [-0.16, 0.16], [-0.16, 0.16], [-0.1, 0.25], FOOTING);
      kit.pole(lamp.at, base, f.o[1] + metres(3.62), 0.065, 0.055, PATH_POLE, { sides: 6 });
      continue;
    }
    kit.box(f, [-0.25, 0.25], [-0.25, 0.25], [-0.1, 0.3], FOOTING);
    const top = 7.55 * k;
    kit.pole(lamp.at, base, f.o[1] + metres(top), 0.12 * k + 0.02, 0.07, GALVANISED);
    // single curved arm: rises from the pole top and levels out toward the head (VR scene_a19)
    const reach = LAMP_TYPES[lamp.type].reachM;
    const arm = [[0, top - 0.1], [0.3 * reach, top + 0.3 * k], [0.62 * reach, top + 0.48 * k], [reach - 0.3, top + 0.52 * k]];
    for (let i = 0; i + 1 < arm.length; i += 1) {
      kit.beam(local(f, arm[i][0], 0, arm[i][1]), local(f, arm[i + 1][0], 0, arm[i + 1][1]), 0.08, 0.08, GALVANISED);
    }
  }
}

// Luminaires into the glow kit (UV-painted): cobra housings with a warm lens underneath, path lanterns with warm sides.
function appendLampHeads(glow, lamps, groundAt) {
  for (const lamp of lamps) {
    const f = lampFrame(lamp, groundAt);
    const k = lamp.heightM / LAMP_TYPES.arterial.heightM;
    if (lamp.type === "path") {
      const h0 = 3.6;
      glow.box(f, [-0.17, 0.17], [-0.17, 0.17], [h0, h0 + 0.42], { top: GLOW_UV.dark, side: GLOW_UV.warm }, { bottom: true });
      const apex = local(f, 0, 0, h0 + 0.62);
      glow.cone(apex, [[-0.24, -0.24], [0.24, -0.24], [0.24, 0.24], [-0.24, 0.24]].map(([s, t]) => local(f, s, t, h0 + 0.42)), GLOW_UV.dark);
      continue;
    }
    const reach = LAMP_TYPES[lamp.type].reachM;
    const top = 7.55 * k + 0.52 * k;
    // housing 0.8 x 0.34 x 0.14 m, its lens a little below the housing so the two never share a plane
    glow.box(f, [reach - 0.45, reach + 0.38], [-0.17, 0.17], [top - 0.1, top + 0.06], GLOW_UV.dark);
    glow.face([local(f, reach - 0.36, -0.13, top - 0.115), local(f, reach + 0.3, -0.13, top - 0.115), local(f, reach + 0.3, 0.13, top - 0.115), local(f, reach - 0.36, 0.13, top - 0.115)], [0, -1, 0], GLOW_UV.warm);
  }
}

// Unit disc facing up: warm centre fading to black at the rim (additive, so black adds nothing).
function poolArchetype(segments = 24) {
  const mesh = new MeshData({ uvs: false, colors: true });
  const up = [0, 1, 0];
  const rings = [[0, 255], [0.25, 225], [0.5, 145], [0.7, 66], [0.85, 20], [1, 0]];
  const centre = mesh.vertex([0, 0, 0], up, undefined, [255, 255, 255, 255]);
  const ringStart = rings.slice(1).map(([radius, level]) => {
    const start = mesh.vertexCount;
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      mesh.vertex([Math.cos(a) * radius, 0, Math.sin(a) * radius], up, undefined, [level, level, level, 255]);
    }
    return start;
  });
  // The angle runs +x -> +z, so (centre, next, current) gives a +y face normal.
  for (let i = 0; i < segments; i += 1) {
    const j = (i + 1) % segments;
    mesh.triangle(centre, ringStart[0] + j, ringStart[0] + i);
    for (let r = 1; r < ringStart.length; r += 1) {
      const inner = ringStart[r - 1];
      const outer = ringStart[r];
      mesh.triangle(inner + i, inner + j, outer + j);
      mesh.triangle(inner + i, outer + j, outer + i);
    }
  }
  return mesh;
}

// Adds every luminaire to the glow kit of stages/furniture.mjs, owned by its lamp's object node (`objects`, emitted by
// lib/objectNodes.mjs with the Lamp_Head material), and emits the mesh-less Lamps_heads node (lamp extras) and
// Lamps_pools (extras.lampIds: the lamp id of each instance, in instance order).
export function buildLights({ glb, lamps, stats, groundAt, glow, objects }) {
  for (const lamp of lamps) {
    appendLampHeads(glow, [lamp], groundAt);
    objects.tag(lamp.id);
  }

  const n = lamps.length;
  const pools = { translations: new Float32Array(n * 3), rotations: new Float32Array(n * 4), scales: new Float32Array(n * 3) };
  lamps.forEach((lamp, i) => {
    const f = lampFrame(lamp, groundAt);
    const reach = metres(LAMP_TYPES[lamp.type].reachM);
    const px = f.o[0] + f.u[0] * reach;
    const pz = f.o[2] + f.u[1] * reach;
    const radius = metres(LAMP_TYPES[lamp.type].poolRadiusM);
    pools.translations.set([px, groundAt(px, pz) + metres(POOL_LIFT_M), pz], i * 3);
    pools.rotations.set([0, 0, 0, 1], i * 4);
    pools.scales.set([radius, 1, radius], i * 3);
  });

  // 32 x 32 emissive mask, bands 8 px wide: top half dark | warm | red | green, bottom half dark | amber | dark | dark.
  const mask = new Uint8Array(32 * 32 * 3);
  const bands = [[[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0]], [[0, 0, 0], [255, 170, 0], [0, 0, 0], [0, 0, 0]]];
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) mask.set(bands[y >> 4][x >> 3], (y * 32 + x) * 3);
  const maskTexture = glb.addTexture(encodePng(32, 32, 3, mask), "image/png", { repeat: false });
  glb.extensionsUsed.add("KHR_materials_emissive_strength");
  glb.extensionsUsed.add("KHR_materials_unlit");
  const headMaterial = glb.addMaterial({
    name: "Lamp_Head",
    pbrMetallicRoughness: { baseColorFactor: [0.3, 0.31, 0.33, 1], metallicFactor: 0.5, roughnessFactor: 0.55 },
    emissiveFactor: [1, 0.74, 0.45],
    emissiveTexture: { index: maskTexture },
    // CityModel multiplies its night weight (0..1) by this strength.
    extensions: { KHR_materials_emissive_strength: { emissiveStrength: 4 } },
  });
  objects.setMaterial("glow", headMaterial);
  const poolMaterial = glb.addMaterial({
    name: "Lamp_Pool",
    pbrMetallicRoughness: { baseColorFactor: [1, 0.6, 0.28, 1], metallicFactor: 0, roughnessFactor: 1 },
    alphaMode: "BLEND",
    extensions: { KHR_materials_unlit: {} },
  });

  const extras = {
    lampsSurveyed: stats.lamps,
    lampsEstimated: 0,
    lampTypes: Object.fromEntries(Object.entries(LAMP_TYPES).map(([type, t]) => [type, { ...t, count: stats.byType[type] }])),
    surveyedSource: "data/photo/objects-campus.geojson street_lamp (NGII 2025 photo survey and the data.go.kr 순천시_가로등 points it kept), each at its pole base in data/photo/pole-roots.json",
    positionNote: "pole bases from the NGII 2025 photo (shadow root or by-eye base, residual per pole in pole-roots.json); unresolved lamps stay at the survey position (metre-level); no rule-placed lamps",
    heightsNote: "lamp heights, arm reach and head sizes are estimates (추정) from the SCNU 360 VR tour, not measurements",
    poleVerdicts: stats.verdicts,
    rejected: stats.rejected,
    movedOffSites: stats.movedOffSites,
    // [id, type, height m (estimated), pole verdict, x, z (scene units)]
    lamps: lamps.map((lamp) => [lamp.id, lamp.type, lamp.heightM, lamp.pole.verdict, Number(lamp.at[0].toFixed(2)), Number(lamp.at[1].toFixed(2))]),
  };
  const poolMesh = glb.addMesh("Lamps_pools", [poolArchetype().toPrimitive(poolMaterial)]);
  const poolNode = glb.addNode({ name: "Lamps_pools", mesh: poolMesh, extensions: glb.instancingExtension(pools), extras: { lamps: n, lampIds: lamps.map((lamp) => lamp.id) } });
  // Lamps_heads holds the lamp extras and Lamps_pools as its child (a mesh-less leaf would be pruned when packing).
  glb.addNode({ name: "Lamps_heads", children: [poolNode], extras: { ...extras, objectNodesNote: "each lamp's head and each traffic signal's lenses are drawn by that lamp's or signal's own node (Furniture/<kind>/<id>); this node holds no geometry" } }, { root: true });

  console.log(
    `lights: ${n} lamps at photo pole bases (${Object.entries(stats.byType).map(([type, c]) => `${type} ${c}`).join(", ")}; ` +
    `${Object.entries(stats.verdicts).map(([k, v]) => `${k} ${v}`).join(", ")}; rejected ${stats.rejected.length}); ` +
    `lamp heads and signal lenses ${glow.triangleCount} triangles on the lamp and signal nodes, 1 instanced pool node, 0 lights` +
    (stats.movedOffSites.length ? `; poles moved off a carriageway or building: ${stats.movedOffSites.map((m) => `${m.id} ${m.from} ${m.m} m`).join(", ")}` : ""),
  );
  if (stats.offenders.length) throw new Error(`lights: pole placement contract broken: ${stats.offenders.join(", ")}`);
}

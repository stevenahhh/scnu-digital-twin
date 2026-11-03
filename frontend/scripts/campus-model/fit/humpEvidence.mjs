// Speed humps as vector geometry (plan uhf-ground-roads-routing todo 14); the stalls moved to data/ground/parking.json
// and stages/parking.mjs (plan campus-ground-truth-redesign todo 12).
//
// Humps: every traced hump outline (`speed_bump` polygons of markings-extra.geojson without a `group`, at least
// HUMP_MIN_AREA_M2; and every `hump <id>` group of striped bands without its own outline) is a HUMP_LENGTH_M (3.6 m)
// long circular-arc hump, HUMP_HEIGHT_M (0.10 m) high, across the outline's width (the road width there): h(s) =
// 0.10 (1 - (2 s / 3.6)^2). Travel runs along the bands of a striped hump, else along the outline's short axis. A hump
// whose centre is off the road is skipped (`hump <id> skipped (off road)`). Every dimension is a statute default or an
// estimate (도로안전시설 설치 및 관리지침, 과속방지턱 원호형 3.6 m x 10 cm), not a measurement.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { geoToModel, SCENE_UNITS_PER_METRE } from "../lib/frame.mjs";
import { humpProfile } from "../stages/roadMarkings.mjs";
export { humpProfile } from "../stages/roadMarkings.mjs";

const UNIT = SCENE_UNITS_PER_METRE;
const PHOTO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "photo", "evidence");

// Every speed_bump feature of both marking files.
export async function loadSpeedBumps() {
  const files = ["markings.geojson", "markings-extra.geojson"];
  const all = await Promise.all(files.map(async (name) => JSON.parse(await Bun.file(path.join(PHOTO, name)).text()).features));
  return all.flat().filter((f) => f.properties.kind === "speed_bump");
}
export const HUMP_LENGTH_M = 3.6;
export const HUMP_HEIGHT_M = 0.1;
export const HUMP_MIN_AREA_M2 = 2;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

// Minimum-area oriented box of a ring (model units): centre, unit axes (long first), half sizes (model units).
export function orientedBox(ring) {
  let best = null;
  for (let a = 0; a < 180; a += 0.5) {
    const u = [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180)];
    const v = [-u[1], u[0]];
    const s = ring.map((p) => dot(p, u));
    const t = ring.map((p) => dot(p, v));
    const [s0, s1, t0, t1] = [Math.min(...s), Math.max(...s), Math.min(...t), Math.max(...t)];
    if (!best || (s1 - s0) * (t1 - t0) < best.area) best = { area: (s1 - s0) * (t1 - t0), u, v, s0, s1, t0, t1 };
  }
  const { u, v, s0, s1, t0, t1 } = best;
  const centre = [((s0 + s1) / 2) * u[0] + ((t0 + t1) / 2) * v[0], ((s0 + s1) / 2) * u[1] + ((t0 + t1) / 2) * v[1]];
  return s1 - s0 >= t1 - t0
    ? { centre, long: u, short: v, halfLong: (s1 - s0) / 2, halfShort: (t1 - t0) / 2 }
    : { centre, long: v, short: u, halfLong: (t1 - t0) / 2, halfShort: (s1 - s0) / 2 };
}

// ---------------------------------------------------------------- humps
// features: speed_bump features (GeoJSON, lon/lat); onRoad([x, z]) -> boolean. Returns humps with their frame
// (model units: centre, travel axis u, across axis v, halfWidth) and the height function above the road.
export function buildHumps({ features, onRoad, log = console.log }) {
  const toModel = (ring) => ring.map(([lon, lat]) => geoToModel(lon, lat));
  const outlines = features.filter((f) => f.properties.kind === "speed_bump" && !f.properties.group);
  const bands = new Map();
  for (const f of features.filter((x) => x.properties.kind === "speed_bump" && x.properties.group)) {
    if (!bands.has(f.properties.group)) bands.set(f.properties.group, []);
    bands.get(f.properties.group).push(f);
  }
  const candidates = [];
  for (const f of outlines) {
    if (f.properties.area_m2 < HUMP_MIN_AREA_M2) {
      log(`hump ${f.properties.id} skipped (${f.properties.area_m2} m2: a fragment, not a hump outline)`);
      continue;
    }
    candidates.push({ id: f.properties.id, ring: toModel(f.geometry.coordinates[0]), bands: bands.get(`hump ${f.properties.id}`) ?? [] });
  }
  for (const [group, members] of bands) {
    const id = group.replace(/^hump /, "");
    if (outlines.some((f) => f.properties.id === id)) continue;
    candidates.push({ id, ring: members.flatMap((m) => toModel(m.geometry.coordinates[0])), bands: members });
  }
  const humps = [];
  for (const c of candidates) {
    const box = orientedBox(c.ring);
    if (!onRoad(box.centre)) {
      log(`hump ${c.id} skipped (off road)`);
      continue;
    }
    let u = box.short;
    if (c.bands.length) {
      const bandAxis = orientedBox(toModel(c.bands[0].geometry.coordinates[0])).long;
      u = Math.abs(dot(bandAxis, box.long)) > Math.abs(dot(bandAxis, box.short)) ? box.long : box.short;
    }
    const v = [-u[1], u[0]];
    const halfWidth = Math.max(...c.ring.map((p) => Math.abs(dot(sub(p, box.centre), v))));
    humps.push({ id: c.id, centre: box.centre, u, v, halfWidth, widthM: (2 * halfWidth) / UNIT, bands: c.bands.length });
  }
  // Height (metres) of the hump surface above the road at a model point, 0 off every hump.
  const heightAt = (x, z) => {
    for (const h of humps) {
      const d = [x - h.centre[0], z - h.centre[1]];
      const t = dot(d, h.v);
      if (Math.abs(t) > h.halfWidth) continue;
      const s = dot(d, h.u) / UNIT;
      if (Math.abs(s) < HUMP_LENGTH_M / 2) return humpProfile(s);
    }
    return 0;
  };
  // Whether a plan box (model units) may touch a hump (its bounding circle).
  heightAt.near = (minX, minZ, maxX, maxZ) => humps.some((h) => {
    const r = Math.hypot((HUMP_LENGTH_M / 2) * UNIT, h.halfWidth);
    const dx = Math.max(minX - h.centre[0], 0, h.centre[0] - maxX);
    const dz = Math.max(minZ - h.centre[1], 0, h.centre[1] - maxZ);
    return Math.hypot(dx, dz) <= r;
  });
  return { humps, heightAt, candidates: candidates.length };
}

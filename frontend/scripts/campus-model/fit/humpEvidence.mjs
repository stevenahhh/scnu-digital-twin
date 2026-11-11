// Speed humps as vector geometry (plan uhf-ground-roads-routing todo 14); the stalls moved to data/ground/parking.json
// and stages/parking.mjs (plan campus-ground-truth-redesign todo 12).
//
// Humps: every traced hump outline (`speed_bump` polygons of markings-extra.geojson without a `group`, at least
// HUMP_MIN_AREA_M2; and every `hump <id>` group of striped bands without its own outline) is a HUMP_LENGTH_M (3.6 m)
// long circular-arc hump, HUMP_HEIGHT_M (0.10 m) high, across the outline's width (the road width there): h(s) =
// 0.10 (1 - (2 s / 3.6)^2). Travel runs along the bands of a striped hump, else along the outline's short axis. A hump
// whose centre is off the road is skipped (`hump <id> skipped (off road)`). Every dimension is a statute default or an
// estimate (도로안전시설 설치 및 관리지침, 과속방지턱 원호형 3.6 m x 10 cm), not a measurement.
//
// A hump with two or more traced bands takes its frame from the bands, which are the paint (an outline is a loose
// box): travel runs square to the line through the band centres, the hump is the bands' painted rectangle (its length
// along travel and width across, so `lengthM` replaces the statute 3.6 m), and the bands keep their pitch
// (`bandWidthM`), their lean to the left of travel (`stripe`, the median band axis: the photo's bands lean about 15
// degrees), and their phase (`bandOffsetM`, where band 0 starts from the right edge on the hump's centre line, with
// `bandStartColour`). All of these are read from traced imagery: estimates (추정).
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
const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// Frame of a striped hump from its band rings (model units; see the header). `hint` is the travel axis the outline
// gives, used only for the sign of the measured one.
function bandFrame(bands, hint) {
  const boxes = bands.map(({ ring }) => orientedBox(ring));
  // the stack line runs through the centres of the whole bands: a band cut at a corner of the hump sits off it
  const areas = bands.map(({ ring }) => Math.abs(ring.reduce((sum, p, i) => sum + p[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * p[1], 0)) / 2);
  const whole = boxes.filter((_, i) => areas[i] >= 0.75 * median(areas));
  const stack = whole.length >= 2 ? whole : boxes;
  const mean = stack.reduce((acc, b) => [acc[0] + b.centre[0] / stack.length, acc[1] + b.centre[1] / stack.length], [0, 0]);
  let sxx = 0, sxy = 0, syy = 0;
  for (const { centre } of stack) {
    const d = sub(centre, mean);
    sxx += d[0] * d[0]; sxy += d[0] * d[1]; syy += d[1] * d[1];
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  // the painted rectangle: the minimum-area box of every band point, whose front and back sides are the bands' ends;
  // travel is its axis further from the stack line
  const all = bands.flatMap(({ ring }) => ring);
  const area = (deg) => {
    const d = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)], e = [-d[1], d[0]];
    const s = all.map((p) => dot(p, d)), t = all.map((p) => dot(p, e));
    return (Math.max(...s) - Math.min(...s)) * (Math.max(...t) - Math.min(...t));
  };
  let best = 0;
  for (let deg = 0; deg < 180; deg += 0.5) if (area(deg) < area(best)) best = deg;
  for (let deg = best - 0.5; deg <= best + 0.5; deg += 0.005) if (area(deg) < area(best)) best = deg;
  const axes = [[Math.cos((best * Math.PI) / 180), Math.sin((best * Math.PI) / 180)], [-Math.sin((best * Math.PI) / 180), Math.cos((best * Math.PI) / 180)]];
  const stackLine = [Math.cos(angle), Math.sin(angle)];
  let u = Math.abs(dot(axes[0], stackLine)) < Math.abs(dot(axes[1], stackLine)) ? axes[0] : axes[1];
  if (dot(u, hint) < 0) u = [-u[0], -u[1]];
  const v = [-u[1], u[0]];
  // local metres: s along travel, t to the left of travel (the model's v points right)
  const local = (p) => [dot(sub(p, mean), u) / UNIT, -dot(sub(p, mean), v) / UNIT];
  const points = bands.flatMap(({ ring }) => ring.map(local));
  const [s0, s1] = [Math.min(...points.map((p) => p[0])), Math.max(...points.map((p) => p[0]))];
  const [t0, t1] = [Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[1]))];
  const centre = [mean[0] + (u[0] * (s0 + s1) / 2 - v[0] * (t0 + t1) / 2) * UNIT, mean[1] + (u[1] * (s0 + s1) / 2 - v[1] * (t0 + t1) / 2) * UNIT];
  const [sc, tc] = [(s0 + s1) / 2, (t0 + t1) / 2];
  const widthM = t1 - t0, lengthM = s1 - s0;
  // lean: the median band axis, measured to the left of travel
  const lean = median(boxes.map((b) => {
    const axis = dot(b.long, u) < 0 ? [-b.long[0], -b.long[1]] : b.long;
    return Math.atan2(-dot(axis, v), dot(axis, u));
  }));
  const stripe = [u[0] * Math.cos(lean) - v[0] * Math.sin(lean), u[1] * Math.cos(lean) - v[1] * Math.sin(lean)];
  // each band where it crosses the hump's centre line s = sc: [t from, t to] relative to the right edge
  const crossings = bands.map(({ ring, colour }) => {
    const pts = ring.map(local), ts = [];
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      if ((p[0] - sc) * (q[0] - sc) <= 0 && p[0] !== q[0]) ts.push(p[1] + ((sc - p[0]) / (q[0] - p[0])) * (q[1] - p[1]));
    });
    return ts.length >= 2 ? { from: Math.min(...ts) - (tc - widthM / 2), to: Math.max(...ts) - (tc - widthM / 2), colour } : null;
  }).filter(Boolean).sort((a, b) => a.from - b.from);
  const pitch = median(crossings.slice(1).map((c, i) => (c.from + c.to) / 2 - (crossings[i].from + crossings[i].to) / 2).filter((d) => d > 0.1));
  // phase: the circular mean of where the full bands start, modulo the pitch
  const full = crossings.filter((c) => c.to - c.from >= 0.8 * pitch);
  const phase = Math.atan2(...[Math.sin, Math.cos].map((f) => full.reduce((sum, c) => sum + f((2 * Math.PI * c.from) / pitch), 0)));
  const offset = ((phase / (2 * Math.PI)) * pitch + pitch) % pitch;
  const votes = crossings.map((c) => {
    const index = Math.floor(((c.from + c.to) / 2 - offset) / pitch);
    return Math.abs(index) % 2 ? (c.colour === "white" ? "yellow" : "white") : c.colour;
  });
  const bandStartColour = votes.filter((c) => c === "white").length > votes.length / 2 ? "white" : "yellow";
  return { centre, u, v, widthM, lengthM, stripe, bandWidthM: pitch, bandOffsetM: offset, bandStartColour };
}

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
    if (c.bands.length >= 2) {
      const rings = c.bands.map((f) => ({ ring: toModel(f.geometry.coordinates[0]).slice(0, -1), colour: f.properties.colour }));
      const hint = Math.abs(dot(orientedBox(rings[0].ring).long, box.long)) > Math.abs(dot(orientedBox(rings[0].ring).long, box.short)) ? box.long : box.short;
      const frame = bandFrame(rings, hint);
      if (!onRoad(frame.centre)) {
        log(`hump ${c.id} skipped (off road)`);
        continue;
      }
      humps.push({ id: c.id, ...frame, halfWidth: (frame.widthM * UNIT) / 2, bands: c.bands.length });
      continue;
    }
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
    const bandStartColour = c.bands.map(f => ({ colour:f.properties.colour,
      t:dot(sub(orientedBox(toModel(f.geometry.coordinates[0])).centre,box.centre),v) }))
      .sort((a,b)=>b.t-a.t)[0]?.colour ?? "yellow";
    humps.push({ id: c.id, centre: box.centre, u, v, halfWidth, widthM: (2 * halfWidth) / UNIT, bands: c.bands.length, bandStartColour });
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

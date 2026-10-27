// Standing-pole contract: the shadow-root detector on synthetic photo windows, the placement contract (checkPoles) and
// the shipped data/photo/pole-roots.json (residuals, rejected rule seeds, spacing).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { geoToModel, metres } from "../lib/frame.mjs";
import { bearingToPixel, detectPoleRoot, detectPoleRoots } from "../lib/poleShadow.mjs";
import { POLE_MIN_SPACING_M, checkPoles } from "./lights.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOTS = JSON.parse(readFileSync(path.join(HERE, "..", "data", "photo", "pole-roots.json"), "utf8"));
const W = 64;

// Grey window: flat pavement (120) with dark 1 px lines drawn by `paint`.
function windowWith(paint) {
  const grey = new Float32Array(W * W).fill(120);
  paint((x, y, v) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi >= 0 && yi >= 0 && xi < W && yi < W) grey[yi * W + xi] = v;
  });
  return grey;
}
const line = (set, x, y, ux, uy, from, to, v) => {
  for (let t = from; t <= to; t += 0.25) set(x + ux * t, y + uy * t, v);
};

test("a thin shadow running away from the sun: the root is its sun-side end, within 0.25 m", () => {
  const [ux, uy] = bearingToPixel(272.5);
  const grey = windowWith((set) => line(set, 40, 30, ux, uy, 0, 15, 40));
  const hit = detectPoleRoot(grey, W, W, { seedX: 37, seedY: 31, radiusPx: 8, heightM: 8 });
  assert.ok(hit, "a root is found");
  const errorM = Math.hypot(hit.x - 40, hit.y - 30) * 0.25;
  assert.ok(errorM <= 0.25, `root ${hit.x.toFixed(2)}, ${hit.y.toFixed(2)} is ${errorM.toFixed(2)} m from the pole base`);
  assert.ok(Math.abs(hit.azimuthDeg - 272.5) < 4, `shadow azimuth ${hit.azimuthDeg.toFixed(1)}`);
  assert.ok(hit.residualPx * 0.25 <= 0.25, "line-fit residual under 0.25 m");
});

test("a pole shadow outranks a kerb line that runs on and a dark gap between crossing bars", () => {
  const [ux, uy] = bearingToPixel(272.5);
  const grey = windowWith((set) => {
    line(set, 44, 20, ux, uy, 0, 15, 40); // pole shadow: ends at both sides
    line(set, 63, 44, ux, uy, 0, 63, 40); // kerb shadow: crosses the window
    for (let k = 0; k < 4; k += 1) line(set, 40, 52 + k * 3, ux, uy, -12, 0, 230); // bright crossing bars
    line(set, 40, 53.5, ux, uy, 0, 12, 60); // the dark gap between two bars
  });
  const [best] = detectPoleRoots(grey, W, W, { seedX: 40, seedY: 36, radiusPx: 22, heightM: 8 });
  assert.ok(Math.hypot(best.x - 44, best.y - 20) * 0.25 <= 0.25, `best root at ${best.x.toFixed(1)}, ${best.y.toFixed(1)}`);
});

test("checkPoles moves a pole off a carriageway and out of a building, and flags poles closer than 1 m", () => {
  // carriageway: z < 0; building: x in [10, 20], z in [5, 15] (scene units)
  const onCarriageway = ([, z]) => z < 0;
  const inBuilding = ([x, z]) => x > 10 && x < 20 && z > 5 && z < 15;
  const poles = [
    { id: "ROAD", kind: "street_lamp", point: [0, -metres(1)] },
    { id: "BLDG", kind: "sign_pole", point: [10 + metres(0.5), 10] },
    { id: "OK", kind: "traffic_signal_pole", point: [40, 40] },
  ];
  const { moved, offenders } = checkPoles(poles, { onCarriageway, inBuilding });
  assert.deepEqual(moved.map((m) => m.id), ["ROAD", "BLDG"]);
  for (const pole of poles) assert.ok(!onCarriageway(pole.point) && !inBuilding(pole.point), `${pole.id} ends on an allowed site`);
  assert.ok(moved.every((m) => m.m <= 2), "moves stay at the kerb line");
  assert.deepEqual(offenders, []);
  // a pole whose base the photo shows (or a median site) only keeps off buildings
  const median = [{ id: "MEDIAN", point: [0, -metres(3)], pole: { verdict: "unresolved", site: "median" } }, { id: "PHOTO", point: [5, -metres(3)], pole: { verdict: "by-eye-root" } }];
  assert.deepEqual(checkPoles(median, { onCarriageway, inBuilding }).moved, []);
  const close = [{ id: "A", point: [40, 40] }, { id: "B", point: [40 + metres(POLE_MIN_SPACING_M * 0.6), 40] }];
  assert.equal(checkPoles(close, { onCarriageway, inBuilding }).offenders.length, 1);
});

test("pole-roots.json: residuals within their thresholds, rule seeds only with photo evidence, no duplicates within 1 m", () => {
  const limits = { "shadow-root": 0.25, "by-eye-root": 0.25, "head-lean": 0.5, "epoch-root": 0.5, "vr-root": 0.5 };
  for (const pole of ROOTS.poles) {
    assert.ok(["shadow-root", "by-eye-root", "head-lean", "epoch-root", "vr-root", "unresolved", "rejected"].includes(pole.verdict), `${pole.id} verdict ${pole.verdict}`);
    if (pole.root) assert.ok(pole.residualM <= limits[pole.verdict], `${pole.id} residual ${pole.residualM} m over ${limits[pole.verdict]} m`);
    if (pole.source === "rule") assert.ok(pole.verdict === "rejected" || pole.root, `rule seed ${pole.id} is drawn without photo evidence`);
    if (pole.verdict === "rejected") assert.ok(pole.note, `${pole.id} rejected without a reason`);
  }
  const drawn = ROOTS.poles.filter((p) => p.verdict !== "rejected").map((p) => ({ id: p.id, at: geoToModel(...(p.root ?? p.seed)) }));
  for (let i = 0; i < drawn.length; i += 1) {
    for (let j = i + 1; j < drawn.length; j += 1) {
      const d = Math.hypot(drawn[i].at[0] - drawn[j].at[0], drawn[i].at[1] - drawn[j].at[1]) / metres(1);
      assert.ok(d >= POLE_MIN_SPACING_M, `${drawn[i].id} and ${drawn[j].id} are ${d.toFixed(2)} m apart`);
    }
  }
});

test("pole-roots.json rounds 2 and 3: placed poles within 0.5 m with a confidence; unresolved poles estimated at their seed with every source tried", () => {
  const methods = ["ngii-wide-search", "vworld-z19", "esri-z18", "vr-two-ray", "shadow-tip", "suncheon-airmap", "kakao-skyview-hd"];
  const placed = [];
  for (const pole of ROOTS.poles) {
    if (pole.root) {
      assert.ok(pole.residualM <= 0.5, `${pole.id} moved with residual ${pole.residualM} m`);
      assert.ok(pole.confidence > 0 && pole.confidence <= 1, `${pole.id} confidence ${pole.confidence}`);
      placed.push(pole.residualM);
    }
    if (pole.verdict !== "unresolved") continue;
    assert.equal(pole.root, undefined, `${pole.id} is unresolved but placed`);
    assert.equal(pole.estimated, true, `${pole.id} is not labelled estimated`);
    assert.ok(pole.seedUncertaintyM > 0.5 && pole.confidence > 0 && pole.confidence < 0.5, `${pole.id} seed uncertainty / confidence`);
    assert.deepEqual(pole.attempts.map((a) => a.method), methods, `${pole.id} sources tried`);
    for (const a of pole.attempts) {
      assert.ok(a.result && a.why, `${pole.id} ${a.method} without a result and reason`);
      assert.ok(!(a.residualM <= 0.5), `${pole.id} ${a.method} resolved to ${a.residualM} m but the pole did not move`);
    }
  }
  const stats = ROOTS.residualStats;
  assert.equal(stats.resolved, placed.length);
  assert.equal(stats.resolved + stats.unresolved, ROOTS.poles.filter((p) => p.verdict !== "rejected").length);
  assert.equal(stats.maxM, Math.max(...placed));
});

test("pole-roots.json round 3: an epoch-root pole sits at its seed plus the offset read on at least two independent epochs within 0.5 m", async () => {
  const { tmToWgs84, wgs84ToTm } = await import("../../../src/geo/epsg5186.mjs");
  const epochPoles = ROOTS.poles.filter((p) => p.verdict === "epoch-root");
  assert.deepEqual(epochPoles.map((p) => p.id).sort(), ["OC0054", "OC0130"]);
  for (const pole of epochPoles) {
    const q = pole.epochRoot;
    assert.equal(q.method, "epoch-root");
    assert.ok(q.independentEpochs.length >= 2 && q.independentEpochs.every((e) => /^20(1[3-9]|2[0-4])_1[02]cm$/.test(e)), `${pole.id} independent epochs ${q.independentEpochs}`);
    assert.ok(q.maxDevM <= 0.5 && pole.residualM <= 0.5, `${pole.id} picks within ${q.maxDevM} m of the base, residual ${pole.residualM} m`);
    const picks = q.independentEpochs.map((e) => q.picksTmM[e]);
    assert.ok(picks.some((a, i) => picks.slice(i + 1).some((b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.5)), `${pole.id}: two independent epochs agree within 0.5 m`);
    for (const e of q.independentEpochs) assert.ok(q.registration[e]?.windows >= 3 && q.registration[e].sigmaM <= 0.2, `${pole.id} ${e} registered`);
    // every independent pick lies within 0.5 m of the placed base
    for (const e of q.independentEpochs) assert.ok(Math.hypot(q.picksTmM[e][0] - q.offsetTmM[0], q.picksTmM[e][1] - q.offsetTmM[1]) <= 0.5, `${pole.id} ${e} pick`);
    const [E, N] = wgs84ToTm(...pole.seed);
    const expected = tmToWgs84(E + q.offsetTmM[0], N + q.offsetTmM[1]);
    const [rE, rN] = wgs84ToTm(...pole.root);
    assert.ok(Math.hypot(rE - E - q.offsetTmM[0], rN - N - q.offsetTmM[1]) < 0.01, `${pole.id} root ${pole.root} vs ${expected}`);
    assert.ok(pole.confidence > 0.5 && pole.confidence <= 1 && pole.estimated === undefined, `${pole.id} placed, not estimated`);
    assert.ok(pole.attempts.some((a) => a.method === "suncheon-airmap" && a.result === "resolved"), `${pole.id} attempts`);
  }
});

test("signal heads face the traffic in the near lanes of the nearest approach (right-hand traffic)", async () => {
  const { signalApproach } = await import("./furniture.mjs");
  // east-west centreline at z = 0 (scene +z is south). Driving east, the right-hand kerb is the south one, so a pole
  // 6 m south of the centreline stands beside eastbound lanes and its heads look west, at that traffic.
  const lines = [{ id: "E1", road: "RD_T", line: [[-50, 0], [50, 0]] }];
  const south = signalApproach([0, metres(6)], lines);
  assert.equal(south.id, "E1");
  assert.ok(Math.abs(south.armM - 6) < 1e-6, "arm reaches the centreline");
  assert.deepEqual(south.armDir.map((v) => Math.round(v) + 0), [0, -1], "arm points north, over the lanes");
  assert.deepEqual(south.travelDir.map((v) => Math.round(v) + 0), [1, 0], "south-side lanes run east");
  assert.deepEqual(south.headsFace.map((v) => Math.round(v) + 0), [-1, 0], "heads look west, at the eastbound traffic");
  const north = signalApproach([0, -metres(6)], lines);
  assert.deepEqual(north.headsFace.map((v) => Math.round(v) + 0), [1, 0], "north-side heads look east, at westbound traffic");
  assert.equal(signalApproach([0, metres(40)], lines), null, "no approach beyond the reach");
});

test("outline-review.json: every verdict is ok, shift (with a small offset) or reject (with a reason)", () => {
  const { reviews } = JSON.parse(readFileSync(path.join(HERE, "..", "data", "photo", "outline-review.json"), "utf8"));
  for (const [id, r] of Object.entries(reviews)) {
    assert.ok(["ok", "shift", "reject"].includes(r.verdict), `${id} verdict ${r.verdict}`);
    assert.ok(r.note, `${id} has no note`);
    if (r.verdict === "shift") assert.ok(Math.hypot(...r.offsetM) <= 5, `${id} shift ${r.offsetM} over 5 m`);
  }
});

test("signal-arms.json: photo arms within the drawn range; heads perpendicular to the arm", async () => {
  const { approachFromArm } = await import("./furniture.mjs");
  const { arms } = JSON.parse(readFileSync(path.join(HERE, "..", "data", "photo", "signal-arms.json"), "utf8"));
  for (const [id, a] of Object.entries(arms)) {
    assert.ok(a.bearingDeg >= 0 && a.bearingDeg < 360 && a.lengthM >= 3.5 && a.lengthM <= 9, `${id} arm ${a.bearingDeg} deg ${a.lengthM} m`);
    const r = approachFromArm([Math.sin((a.bearingDeg * Math.PI) / 180), -Math.cos((a.bearingDeg * Math.PI) / 180)], a.lengthM);
    assert.ok(Math.abs(r.armDir[0] * r.headsFace[0] + r.armDir[1] * r.headsFace[1]) < 1e-9, `${id} heads perpendicular to the arm`);
  }
});

test("signal-arms.json: a pedestrian post has no photo arm and a head bearing", () => {
  const { arms, posts = {} } = JSON.parse(readFileSync(path.join(HERE, "..", "data", "photo", "signal-arms.json"), "utf8"));
  for (const [id, p] of Object.entries(posts)) {
    assert.ok(!arms[id], `${id} is a post and an arm`);
    assert.ok(p.faceDeg >= 0 && p.faceDeg < 360 && p.note, `${id} post head bearing and source`);
  }
});

test("gate-structures.geojson: three islands (axis + width) and one canopy outline, all estimated and sourced", () => {
  const { features } = JSON.parse(readFileSync(path.join(HERE, "..", "data", "photo", "gate-structures.geojson"), "utf8"));
  const islands = features.filter((f) => f.properties.kind === "traffic_island");
  const canopies = features.filter((f) => f.properties.kind === "gate_canopy");
  assert.equal(islands.length, 3);
  assert.equal(canopies.length, 1);
  for (const f of features) {
    assert.equal(f.properties.estimated, true, `${f.properties.id} is estimated`);
    assert.ok(f.properties.source && f.properties.method, `${f.properties.id} has a source`);
  }
  for (const f of islands) assert.ok(f.geometry.type === "LineString" && f.properties.width_m > 0.5 && f.properties.width_m < 3, `${f.properties.id} island axis and width`);
});

test("vr-lamps.geojson: every VR-located lamp has a photo base within 0.25 m (by eye) and names its VR scene", () => {
  const { features } = JSON.parse(readFileSync(path.join(HERE, "..", "data", "photo", "vr-lamps.geojson"), "utf8"));
  for (const f of features) {
    const p = f.properties;
    assert.equal(p.kind, "street_lamp");
    assert.equal(f.geometry.type, "Point");
    assert.ok(p.residual_m <= 0.25, `${p.id} residual ${p.residual_m} m`);
    assert.match(p.source, /scene_[a-z0-9_]+/, `${p.id} names its VR scene`);
    assert.equal(p.estimated, true);
  }
});

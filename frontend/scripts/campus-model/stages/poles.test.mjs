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
  const limits = { "shadow-root": 0.25, "by-eye-root": 0.25, "head-lean": 0.5 };
  for (const pole of ROOTS.poles) {
    assert.ok(["shadow-root", "by-eye-root", "head-lean", "unresolved", "rejected"].includes(pole.verdict), `${pole.id} verdict ${pole.verdict}`);
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

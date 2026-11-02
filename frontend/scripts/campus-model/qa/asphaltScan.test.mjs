// node --test scripts/campus-model/qa/asphaltScan.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { baselineStatus, cellGrid, isAsphalt, openCells, proposeRings, rasterTop, scanRegions } from "./asphaltScan.mjs";

const ASPHALT = [63, 83, 85];
const GRASS = [60, 95, 40];
const square = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const parcel = (id, cls, ring, precedence = 3) => ({ id, class: cls, ring, holes: [], precedence, paintAllowed: cls === "road" || cls === "lot" });

// A grid in [E, N] metres whose cells are asphalt where paint(E, N) says so. Top-left corner at (0, h).
function gridOf(w, h, paint, { cellM = 1 } = {}) {
  const asphalt = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) asphalt[y * w + x] = paint(x + 0.5, h - y - 0.5) ? 1 : 0;
  return { w, h, origin: [0, h], cellM, asphalt };
}

test("isAsphalt takes the photo's grey road and refuses grass, deep shade, white paint and red roofs", () => {
  assert.equal(isAsphalt(...ASPHALT), true);
  assert.equal(isAsphalt(...GRASS), false);
  assert.equal(isAsphalt(10, 20, 35), false, "shade darker than any lit road");
  assert.equal(isAsphalt(235, 235, 235), false);
  assert.equal(isAsphalt(170, 70, 50), false);
});

test("cellGrid decides each cell on its visible pixels and leaves a mostly hidden cell unknown", () => {
  // 2 x 1 cells of 4 x 4 px: the left cell is asphalt and visible; the right one asphalt but hidden by the mask
  const [w, h] = [8, 4];
  const rgb = new Uint8Array(w * h * 3);
  for (let k = 0; k < w * h; k += 1) rgb.set(ASPHALT, k * 3);
  const mask = new Uint8Array(w * h);
  for (let j = 0; j < h; j += 1) for (let i = 4; i < w; i += 1) mask[j * w + i] = 1;
  const grid = cellGrid({ w, h, origin: [100, 50], gsdM: 0.25, rgb }, mask);
  assert.deepEqual([grid.w, grid.h, grid.cellM], [2, 1, 1]);
  assert.deepEqual([...grid.origin], [100, 50]);
  assert.deepEqual([...grid.asphalt], [1, 0]);
  assert.deepEqual([...grid.visible], [1, 0]);
});

test("cellGrid refuses a pixel buffer of the wrong size", () => {
  assert.throws(() => cellGrid({ w: 8, h: 4, origin: [0, 0], gsdM: 0.25, rgb: new Uint8Array(3) }, new Uint8Array(32)), /rgb/);
  assert.throws(() => cellGrid({ w: 8, h: 4, origin: [0, 0], gsdM: 0.25, rgb: new Uint8Array(96) }, new Uint8Array(3)), /mask/);
});

test("openCells drops a one-cell strip and keeps a block", () => {
  const grid = gridOf(30, 20, (E, N) => (N > 10 && N < 11) || (E > 15 && E < 25 && N > 2 && N < 9));
  const opened = openCells(grid.asphalt, grid.w, grid.h, 1);
  const at = (E, N) => opened[(grid.h - Math.ceil(N)) * grid.w + Math.floor(E)];
  assert.equal(at(5.5, 10.5), 0);
  assert.equal(at(20.5, 5.5), 1);
});

test("rasterTop keeps the highest precedence and the later record on a tie, and honours holes", () => {
  const grid = { w: 10, h: 10, origin: [0, 10], cellM: 1 };
  const parcels = [
    parcel("A", "road", square(0, 0, 10)),
    parcel("B", "sidewalk", square(0, 0, 5), 5),
    parcel("C", "lot", square(6, 6, 4), 3),
    { ...parcel("D", "plaza", square(0, 6, 4), 6), holes: [square(1, 7, 2)] },
  ];
  const top = rasterTop(parcels, grid);
  const at = (E, N) => top[(10 - Math.ceil(N)) * 10 + Math.floor(E)];
  assert.equal(parcels[at(2.5, 2.5)].id, "B");
  assert.equal(parcels[at(7.5, 7.5)].id, "C");
  assert.equal(parcels[at(0.5, 6.5)].id, "D");
  assert.equal(parcels[at(2.5, 8.5)].id, "A", "a hole shows the parcel under it");
  assert.equal(at(5.5, 2.5), 0);
});

test("scanRegions lists asphalt off road and lot parcels with its area and what lies under it", () => {
  const grid = gridOf(40, 20, (E, N) => E > 2 && E < 38 && N > 5 && N < 15);
  const parcels = [parcel("ROAD", "road", square(0, 0, 20)), parcel("PATH", "sidewalk", [[30, 0], [40, 0], [40, 20], [30, 20]], 2)];
  const { regions, coveredM2, asphaltM2 } = scanRegions(grid, parcels, { minAreaM2: 50 });
  assert.equal(regions.length, 1);
  const [r] = regions;
  assert.equal(r.areaM2, 180);
  assert.equal(asphaltM2, 360);
  assert.equal(coveredM2, 180);
  assert.deepEqual(r.bbox, [20, 5, 38, 15]);
  assert.deepEqual(r.under, { none: 100, sidewalk: 80 });
});

test("scanRegions reads the parcels it is given: covering the area empties the report, removing the road fills it", () => {
  const grid = gridOf(40, 20, (E, N) => E > 2 && E < 38 && N > 5 && N < 15);
  const road = parcel("ROAD", "road", square(0, 0, 40));
  assert.equal(scanRegions(grid, [road], { minAreaM2: 50 }).regions.length, 0);
  assert.equal(scanRegions(grid, [], { minAreaM2: 50 }).regions[0].areaM2, 360);
});

test("scanRegions drops areas under the minimum and cuts out the rings given as not asphalt", () => {
  const grid = gridOf(60, 20, (E, N) => (E > 2 && E < 22 && N > 5 && N < 15) || (E > 40 && E < 45 && N > 5 && N < 10));
  const out = scanRegions(grid, [], { minAreaM2: 50, notAsphalt: [{ id: "ROOF_1", ring: [[0, 0], [12, 0], [12, 20], [0, 20]], reason: "dark roof" }] });
  assert.equal(out.regions.length, 1, "the 25 m2 patch is under the minimum");
  assert.equal(out.regions[0].areaM2, 100);
  assert.equal(out.explained.ROOF_1, 100);
  const half = scanRegions(grid, [], { minAreaM2: 50, notAsphalt: [{ id: "ROOF_1", ring: square(0, 0, 40), reason: "dark roof" }] });
  assert.deepEqual(half.regions, []);
  assert.throws(() => scanRegions(grid, [], { minAreaM2: 50, notAsphalt: [{ id: "BAD", ring: [[0, 0]], reason: "x" }] }), /BAD/);
  assert.throws(() => scanRegions(grid, [], { minAreaM2: 50, notAsphalt: [{ id: "NO_REASON", ring: square(0, 0, 1) }] }), /NO_REASON/);
});

test("baselineStatus says which parcel covered an old area and leaves an uncovered one open", () => {
  const grid = gridOf(60, 20, (E, N) => (E > 2 && E < 22 && N > 5 && N < 15) || (E > 32 && E < 52 && N > 5 && N < 15));
  const base = scanRegions(grid, [], { minAreaM2: 50 });
  const now = [parcel("PARCEL_NEW", "lot", square(0, 0, 25))];
  const status = baselineStatus(base.regions, grid, now, [{ id: "ROOF_1", ring: square(30, 0, 25), reason: "dark roof" }]);
  assert.deepEqual(status.map((s) => s.status), ["covered", "reason"]);
  assert.deepEqual(status[0].by, ["PARCEL_NEW"]);
  assert.equal(status[1].reason, "dark roof");
  const open = baselineStatus(base.regions, grid, [], []);
  assert.deepEqual(open.map((s) => s.status), ["open", "open"]);
});

test("proposeRings traces a filled block, bridges a car-sized gap and stays off hard cells", () => {
  const grid = gridOf(40, 30, (E, N) => E > 5 && E < 35 && N > 5 && N < 25 && !(E > 18 && E < 21 && N > 12 && N < 15));
  const hard = new Uint8Array(grid.w * grid.h);
  for (let y = 0; y < grid.h; y += 1) for (let x = 30; x < grid.w; x += 1) hard[y * grid.w + x] = 1;
  const [p] = proposeRings(grid, { soft: new Uint8Array(grid.w * grid.h), hard, covered: new Uint8Array(grid.w * grid.h), minAreaM2: 50 });
  assert.ok(p.areaM2 >= 490 && p.areaM2 <= 510, `area ${p.areaM2}`);
  const xs = p.ring.map(([E]) => E);
  assert.ok(Math.max(...xs) <= 30.01 && Math.min(...xs) >= 4.99, `E range ${Math.min(...xs)}..${Math.max(...xs)}`);
  assert.ok(p.ring.length <= 12, `${p.ring.length} vertices for a rectangle`);
  assert.equal(p.hiddenEdgeShare, 0);
});

test("proposeRings counts hidden cells at the edge, so a shaded edge can be flagged as estimated", () => {
  const grid = gridOf(40, 30, (E, N) => E > 5 && E < 25 && N > 5 && N < 25);
  const soft = new Uint8Array(grid.w * grid.h);
  for (let y = 0; y < grid.h; y += 1) for (let x = 25; x < 30; x += 1) soft[y * grid.w + x] = 1; // shade east of the block
  const [p] = proposeRings(grid, { soft, hard: new Uint8Array(grid.w * grid.h), covered: new Uint8Array(grid.w * grid.h), minAreaM2: 50 });
  assert.ok(p.hiddenEdgeShare > 0.15, `hidden edge share ${p.hiddenEdgeShare}`);
  assert.ok(Math.max(...p.ring.map(([E]) => E)) >= 28, "hidden cells next to asphalt join the proposal");
});

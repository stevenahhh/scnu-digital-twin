import assert from "node:assert/strict";
import test from "node:test";

import { blueBlob, fitBox, isBlue, isLine, measureBay, measureLadder, oriented, peaks, placesToRow, railAt, ridgeAt, walkRow } from "./parkingFit.mjs";

// A 60 x 20 m raster at 0.25 m per pixel, origin (0, 20), dark asphalt; paint(x, y) in metres may recolour a pixel.
const raster = (paint) => {
  const [w, h] = [240, 80];
  const rgb = new Uint8Array(w * h * 3).fill(60);
  for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) {
    const c = paint((i + 0.5) * 0.25, 20 - (j + 0.5) * 0.25);
    if (c) rgb.set(c, (j * w + i) * 3);
  }
  return { w, h, origin: [0, 20], gsdM: 0.25, rgb };
};
// A frame along +E at N = 15, stalls towards the south (t grows south), as stages/parking.mjs rowFrame gives.
const frame = { a: [1, 0], d: [0, -1], length: 60, at: (s, t) => [s, 15 - t] };
const WHITE = [200, 200, 200];
const ladder = (places, { t0 = 0, t1 = 5 } = {}) => (x, y) => (places.some((s) => Math.abs(x - s) <= 0.13) && y <= 15 - t0 && y >= 15 - t1 ? WHITE : null);

test("ridgeAt reads a thin line, and a car's flank is not a line", () => {
  const line = raster(ladder([10]));
  assert.ok(ridgeAt(line, frame, 10, 0.5, 4.5).contrast > 50);
  const car = raster((x, y) => (x >= 10 && x <= 12 && y <= 15 && y >= 10 ? WHITE : null));
  assert.ok(ridgeAt(car, frame, 10, 0.5, 4.5).contrast < 5);
});

test("a row runs on across a car: paint resumes at the same pitch, and the stalls under the car are places nobody read", () => {
  const win = raster(ladder([2.6, 5.2, 7.8, 15.6, 18.2]));
  const { added, stop } = walkRow(win, frame, { from: 7.8, dir: 1, pitch: 2.6, depth: 5 });
  assert.deepEqual(added.map((p) => [Math.round(p.s * 10) / 10, p.read]), [[10.4, "unknown"], [13, "unknown"], [15.6, "line"], [18.2, "line"]]);
  assert.match(stop, /no paint/);
});

test("the walk ends where paint does not resume, and drops the places it could not read past the last line", () => {
  const win = raster(ladder([2.6, 5.2]));
  const { added, stop } = walkRow(win, frame, { from: 5.2, dir: 1, pitch: 2.6, depth: 5 });
  assert.deepEqual(added, []);
  assert.match(stop, /no paint/);
});

test("the walk stops at what the caller names, and goes both ways", () => {
  const win = raster(ladder([2.6, 5.2, 7.8, 10.4, 13]));
  const west = walkRow(win, frame, { from: 13, dir: -1, pitch: 2.6, depth: 5 });
  [10.4, 7.8, 5.2, 2.6].forEach((s, i) => assert.ok(Math.abs(west.added[i].s - s) <= 0.13, JSON.stringify(west.added))); // one 0.25 m pixel of paint reads within half a pixel
  assert.equal(west.added.length, 4);
  const fenced = walkRow(win, frame, { from: 2.6, dir: 1, pitch: 2.6, depth: 5, stop: (P) => (P[0] > 8 ? "row B" : null) });
  assert.equal(fenced.added.length, 2);
  assert.equal(fenced.stop, "row B");
});

test("both rails over a stall carry the row when its divider is under a car", () => {
  const rails = (x, y) => ((Math.abs(y - 15) <= 0.13 || Math.abs(y - 10) <= 0.13) && x <= 13 ? WHITE : null);
  const win = raster((x, y) => ladder([2.6, 5.2])(x, y) ?? rails(x, y));
  const { added } = walkRow(win, frame, { from: 5.2, dir: 1, pitch: 2.6, depth: 5 });
  assert.deepEqual(added.map((p) => [Math.round(p.s * 10) / 10, p.read]), [[7.8, "rails"], [10.4, "rails"], [13, "rails"]]);
});

test("railAt reads a rail at its steady offset from the record", () => {
  const win = raster((x, y) => (Math.abs(y - 14.6) <= 0.13 ? WHITE : null));
  const rail = railAt(win, frame, 2, 12, 0);
  assert.ok(Math.abs(rail.off - 0.4) <= 0.1, JSON.stringify(rail));
  assert.equal(railAt(raster(() => null), frame, 2, 12, 0), null);
});

test("placesToRow keeps a uniform pitch, and a stall whose paint drifts becomes an exception so later lines stay on their paint", () => {
  assert.deepEqual(placesToRow([0, 2.6, 5.2, 7.8]), { pitchM: 2.6, count: 4, stalls: [] });
  assert.deepEqual(placesToRow([0, 2.6, 5.2, 8.9, 11.5]), { pitchM: 2.6, count: 5, stalls: [{ index: 2, kind: "general", widthM: 3.7 }] });
});

test("isBlue takes painted blue, in sun and in shade, and not bluish asphalt", () => {
  assert.equal(isBlue([40, 110, 170]), true);
  assert.equal(isBlue([20, 50, 85]), true);
  assert.equal(isBlue([70, 80, 95]), false);
});

test("blueBlob measures a rotated bay: centre, size and direction", () => {
  const deg = (20 * Math.PI) / 180;
  const u = [Math.cos(deg), Math.sin(deg)];
  const v = [-u[1], u[0]];
  const win = raster((x, y) => {
    const [dx, dy] = [x - 30, y - 10];
    const [a, b] = [dx * u[0] + dy * u[1], dx * v[0] + dy * v[1]];
    return Math.abs(a) <= 2.5 && Math.abs(b) <= 1.5 ? [40, 110, 170] : null;
  });
  const blob = blueBlob(win, [30, 10]);
  assert.ok(Math.abs(blob.long - 5) <= 0.5 && Math.abs(blob.short - 3) <= 0.5, JSON.stringify(blob));
  assert.ok(Math.hypot(blob.centre[0] - 30, blob.centre[1] - 10) <= 0.3);
  assert.ok(Math.abs(Math.abs(blob.longDir[0] * u[0] + blob.longDir[1] * u[1]) - 1) <= 0.01, JSON.stringify(blob.longDir));
  assert.equal(blueBlob(win, [5, 5]), null);
});

test("oriented finds the tightest box; a square has no preferred long side", () => {
  const pts = [];
  for (let x = 0; x <= 4; x += 0.25) for (let y = 0; y <= 2; y += 0.25) pts.push([x, y]);
  const box = oriented(pts);
  assert.ok(Math.abs(box.long - 4) < 0.01 && Math.abs(box.short - 2) < 0.01);
});

test("peaks reports centre, prominence and width", () => {
  const prof = Array.from({ length: 41 }, (_, i) => ({ x: i * 0.1, v: i >= 19 && i <= 21 ? 100 : 50 }));
  const [p] = peaks(prof, 10);
  assert.equal(p.x, 2);
  assert.equal(p.prom, 50);
  assert.ok(p.w <= 0.3);
});

test("measureLadder finds a skewed ladder's direction, its places and its rails from a rough axis, and marks places under a car", () => {
  const skew = 0.5; // the lines lean 0.5 m per metre of depth
  const lines = [2, 4.6, 7.2, 12.4, 15];
  const win = raster((x, y) => {
    const t = 15 - y;
    if (t >= 0 && t <= 5 && lines.some((s) => Math.abs(x - (s + skew * t)) <= 0.13)) return WHITE;
    if ((Math.abs(y - 15) <= 0.13 || Math.abs(y - 10) <= 0.13) && x >= 2 && x <= 17.5) return WHITE;
    return null;
  });
  const row = measureLadder(win, { p: [2, 15.2], q: [15, 15.2], side: -1, depth: 5, pitch: 2.6 });
  assert.ok(Math.abs(row.bearingDeg - (180 - (Math.atan(skew) * 180) / Math.PI)) <= 3 || Math.abs(row.bearingDeg - (180 + (Math.atan(skew) * 180) / Math.PI)) <= 3, String(row.bearingDeg));
  assert.deepEqual(row.places.map((p) => p.read), ["line", "line", "line", "unknown", "line", "line"]);
  assert.ok(Math.abs(row.tBack - 0.2) <= 0.15, String(row.tBack));
  assert.ok(Math.abs(row.tFront - 5.2 / Math.cos(Math.atan(skew))) <= 0.2, String(row.tFront)); // t runs along the skewed lines
  assert.equal(row.back, true);
  assert.equal(row.front, true);
});

test("measureBay reads a bay from its blue: the box takes the blue plus its border, and a hatch on one side becomes the aisle", () => {
  const win = raster((x, y) => {
    if (x >= 28 && x <= 31 && y >= 6 && y <= 11) return [40, 110, 170];
    if (x > 31 && x <= 32.2 && y >= 6 && y <= 11) return Math.floor((x + y) * 2) % 2 ? WHITE : null;
    return null;
  });
  const bay = measureBay(win, [29.5, 8.5]);
  assert.ok(Math.abs(bay.depthM - 5.2) <= 0.4, JSON.stringify(bay));
  assert.ok(Math.abs(bay.widthM - 4.3) <= 0.5, JSON.stringify(bay));
  assert.ok(Math.abs(bay.aisleWidthM - 1.2) <= 0.4, JSON.stringify(bay));
  assert.ok(bay.aisleDir[0] > 0.9, JSON.stringify(bay));
});

test("fitBox moves a rough box onto the paint: place, angle and size", () => {
  const deg = (15 * Math.PI) / 180;
  const u = [Math.cos(deg), Math.sin(deg)];
  const v = [-u[1], u[0]];
  const on = ([x, y]) => { const [a, b] = [(x - 30) * u[0] + (y - 10) * u[1], (x - 30) * v[0] + (y - 10) * v[1]]; return Math.abs(a) <= 1.5 && Math.abs(b) <= 2.5; };
  const box = fitBox(on, { c: [30.4, 9.7], th: 0.1, w: 3.5, d: 4.5 }, { gsdM: 0.25 });
  assert.ok(Math.hypot(box.c[0] - 30, box.c[1] - 10) <= 0.2, JSON.stringify(box));
  assert.ok(Math.abs(box.w - 3) <= 0.3 && Math.abs(box.d - 5) <= 0.3, JSON.stringify(box));
  assert.ok(box.iou >= 0.85, JSON.stringify(box));
});

const within = (list, want) => { assert.deepEqual(list.map((p) => p.read), want.map((w) => w[1]), JSON.stringify(list)); want.forEach(([s], i) => assert.ok(Math.abs(list[i].s - s) <= 0.13, JSON.stringify(list))); }; // one 0.25 m pixel of paint reads within half a pixel

test("paint three unknown pitches away is another row: the walk bridges two and no more", () => {
  const win = raster(ladder([2.6, 5.2, 15.6, 18.2]));
  const { added, stop } = walkRow(win, frame, { from: 5.2, dir: 1, pitch: 2.6, depth: 5 });
  assert.deepEqual(added, []);
  assert.match(stop, /no paint for 3 pitches/);
});

test("one rail is a kerb: it does not carry the row, both rails do", () => {
  const back = (x, y) => (Math.abs(y - 15) <= 0.13 && x <= 13 ? WHITE : null);
  const win = raster((x, y) => ladder([2.6, 5.2])(x, y) ?? back(x, y));
  assert.deepEqual(walkRow(win, frame, { from: 5.2, dir: 1, pitch: 2.6, depth: 5 }).added, []);
});

test("a ladder whose pitch is longer than the guess is followed line by line", () => {
  const win = raster(ladder([0.5, 3.4, 6.3, 9.2, 12.1]));
  const { added } = walkRow(win, frame, { from: 0.5, dir: 1, pitch: 2.6, depth: 5 });
  assert.equal(added.length, 4, JSON.stringify(added));
  [3.4, 6.3, 9.2, 12.1].forEach((s, i) => { assert.equal(added[i].read, "line"); assert.ok(Math.abs(added[i].s - s) <= 0.13, JSON.stringify(added)); });
});

test("a truck is not a stall: where both rails stop, marks on its flanks do not carry the row, even when rails and lines resume past it", () => {
  const rails = (x, y) => ((Math.abs(y - 15) <= 0.13 || Math.abs(y - 10) <= 0.13) && (x <= 5.2 || x >= 15.6) ? WHITE : null);
  const win = raster((x, y) => ladder([2.6, 5.2, 7.8, 10.4, 13, 15.6, 18.2])(x, y) ?? rails(x, y));
  const { added, stop } = walkRow(win, frame, { from: 5.2, dir: 1, pitch: 2.6, depth: 5 });
  assert.deepEqual(added, []);
  assert.match(stop, /no paint for 3 pitches/);
});

test("a car on one rail does not end a row: the other rail still runs and the line reads", () => {
  const rails = (x, y) => (Math.abs(y - 10) <= 0.13 || (Math.abs(y - 15) <= 0.13 && (x <= 5.2 || x >= 7.8)) ? WHITE : null);
  const win = raster((x, y) => ladder([2.6, 5.2, 7.8, 10.4])(x, y) ?? (x <= 10.4 ? rails(x, y) : null));
  within(walkRow(win, frame, { from: 5.2, dir: 1, pitch: 2.6, depth: 5 }).added, [[7.8, "line"], [10.4, "line"]]);
});

test("a rail gone for one stall joins again when it resumes, and the stall in between stays a place nobody read", () => {
  const rails = (x, y) => ((Math.abs(y - 15) <= 0.13 || Math.abs(y - 10) <= 0.13) && (x <= 5.2 || x >= 7.8) ? WHITE : null);
  const win = raster((x, y) => ladder([2.6, 5.2, 7.8, 10.4])(x, y) ?? (x <= 10.4 ? rails(x, y) : null));
  within(walkRow(win, frame, { from: 5.2, dir: 1, pitch: 2.6, depth: 5 }).added, [[7.8, "unknown"], [10.4, "line"]]);
});

test("isLine wants most of the depth and real contrast", () => {
  assert.equal(isLine({ contrast: 40, cover: 0.5, rel: 0.5 }), true);
  assert.equal(isLine({ contrast: 40, cover: 0.3, rel: 0.5 }), false, "a short mark");
  assert.equal(isLine({ contrast: 6, cover: 1, rel: 0.05 }), true);
  assert.equal(isLine({ contrast: 3, cover: 1, rel: 0.1 }), true, "shade lowers contrast, not its share of the ground");
  assert.equal(isLine({ contrast: 3, cover: 1, rel: 0.05 }), false);
  assert.equal(isLine({ contrast: 1, cover: 1, rel: 0.5 }), false, "one level is no line");
  assert.equal(isLine({ contrast: null, cover: 1, rel: null }), false);
});

test("measureLadder leaves a gap off the pitch as one wide stall", () => {
  const win = raster(ladder([2, 4.6, 7.2, 11.2, 13.8]));
  const row = measureLadder(win, { p: [2, 15], q: [13.8, 15], side: -1, depth: 5, pitch: 2.6, bearingDeg: 180 });
  assert.deepEqual(row.places.map((p) => p.read), ["line", "line", "line", "line", "line"]);
});

const blueBay = (x0, x1, y0, y1) => (x, y) => (x >= x0 && x <= x1 && y >= y0 && y <= y1 ? [40, 110, 170] : null);
test("measureBay on a plain bay: blue plus a 0.12 m border, no aisle, width the short way", () => {
  const bay = measureBay(raster(blueBay(28, 31, 6, 11)), [29.5, 8.5]);
  assert.ok(Math.abs(bay.widthM - 3) <= 0.1, JSON.stringify(bay));
  assert.ok(Math.abs(bay.depthM - 5) <= 0.1, JSON.stringify(bay));
  assert.equal(bay.aisleWidthM, 0);
  assert.equal(bay.aisleDir, null);
  assert.ok(Math.abs(bay.widthDir[0]) > 0.9 && Math.abs(bay.depthDir[1]) > 0.9, JSON.stringify(bay));
});

test("measureBay centres a hatched bay between the blue and the hatch's far edge", () => {
  const win = raster((x, y) => {
    if (x > 31 && x <= 32.2 && y >= 6 && y <= 11) return Math.floor((x + y) * 2) % 2 ? WHITE : null;
    return blueBay(28, 31, 6, 11)(x, y);
  });
  const bay = measureBay(win, [29.5, 8.5]);
  const blueCentre = 29.5;
  assert.ok(Math.abs(bay.centre[0] - (blueCentre + bay.aisleWidthM / 2)) <= 0.15, JSON.stringify(bay));
  assert.ok(bay.centre[0] > blueCentre + 0.3, JSON.stringify(bay));
});

const box = (cx, cy, w, d, deg = 0) => { const th = (deg * Math.PI) / 180; const u = [Math.cos(th), Math.sin(th)]; return ([x, y]) => { const [dx, dy] = [x - cx, y - cy]; return Math.abs(dx * u[0] + dy * u[1]) <= w / 2 && Math.abs(-dx * u[1] + dy * u[0]) <= d / 2; }; };
test("fitBox turns to the paint's angle", () => {
  const fit = fitBox(box(30, 10, 3, 5, 15), { c: [30, 10], th: 0.1, w: 3, d: 5 }, { gsdM: 0.1 });
  assert.ok(Math.abs(fit.th - (15 * Math.PI) / 180) <= 0.03, JSON.stringify(fit));
});
test("fitBox stays within its reach: paint further away does not pull it", () => {
  const fit = fitBox(box(32, 10, 3, 5), { c: [30, 10], th: 0, w: 3, d: 5 }, { gsdM: 0.1 });
  assert.ok(Math.hypot(fit.c[0] - 30, fit.c[1] - 10) <= 0.7 + 1e-9, JSON.stringify(fit));
});
test("fitBox ends on its finest step, closer than the coarse 0.2 m", () => {
  const fit = fitBox(box(30, 10, 3, 5), { c: [30.1, 10], th: 0, w: 3.1, d: 5.1 }, { gsdM: 0.05 });
  assert.ok(Math.abs(fit.c[0] - 30) <= 0.06, JSON.stringify(fit));
  assert.ok(Math.abs(fit.w - 3) <= 0.06 && Math.abs(fit.d - 5) <= 0.06, JSON.stringify(fit));
});

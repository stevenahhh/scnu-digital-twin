import assert from "node:assert/strict";
import test from "node:test";

import {
  chainFragments, dashPhase, fitCrossing, fitPeriod, fitPath, layDashes, measuredPeriod, mergeCrossings, resample, straightness,
} from "./markingFit.mjs";

// Deterministic jitter (no Math.random): a fixed pseudo-random sequence in [-amp, amp].
const jitter = (i, amp) => amp * Math.sin(i * 12.9898 + 78.233) * Math.cos(i * 4.1414);

test("a jittered straight line with kinks fits as one straight run within 2 cm", () => {
  // 40 m along a 17 deg road, +-0.1 m pixel jitter and two 0.15 m kinks
  const dir = [Math.cos(0.3), Math.sin(0.3)];
  const points = Array.from({ length: 161 }, (_, i) => {
    const s = i * 0.25;
    const kink = i === 50 || i === 120 ? 0.15 : 0;
    const off = jitter(i, 0.08) + kink;
    return [10 + dir[0] * s - dir[1] * off, 5 + dir[1] * s + dir[0] * off];
  });
  const fit = fitPath(points);
  assert.equal(fit.lines.length, 1, "one straight run");
  assert.ok(straightness(fit.path) <= 0.02, `drawn line deviates ${straightness(fit.path)} m from straight`);
  assert.ok(fit.residual.max <= 0.25, `paint residual ${fit.residual.max} m beyond one photo pixel`);
  // the fitted direction is the road's
  const d = [fit.path.at(-1)[0] - fit.path[0][0], fit.path.at(-1)[1] - fit.path[0][1]];
  assert.ok(Math.abs(Math.atan2(d[1], d[0]) - 0.3) < 0.005);
});

test("a straight-curve-straight line fits as two runs joined by a tangent arc", () => {
  // 20 m east, a 90 deg left bend of radius 10 m, 20 m north (z negative = north in the model plane)
  const points = [];
  for (let s = 0; s <= 20; s += 0.25) points.push([s, 0]);
  for (let a = 0; a <= Math.PI / 2; a += 0.025) points.push([20 + 10 * Math.sin(a), -10 + 10 * Math.cos(a)]);
  for (let s = 0; s <= 20; s += 0.25) points.push([30, -10 - s]);
  const fit = fitPath(points.map((p, i) => [p[0] + jitter(i, 0.05), p[1] + jitter(i + 7, 0.05)]));
  assert.ok(fit.pieces.some((p) => p.type === "arc"), "the bend is an arc");
  assert.ok(fit.residual.p95 <= 0.25, `p95 residual ${fit.residual.p95}`);
  // the two straights are exactly straight in the drawn path
  const first = fit.pieces.find((p) => p.type === "line");
  assert.ok(Math.abs(first.to[1] - first.from[1]) <= 0.02 + Math.abs(first.to[0] - first.from[0]) * 0.002);
});

test("fragments of one dashed line chain in travel order; a parallel line stays separate", () => {
  const dash = (x0, z) => ({ points: resample([[x0, z], [x0 + 3, z]], 0.25) });
  const fragments = [
    { id: "b", ...dash(8, 0.05) }, { id: "a", ...dash(0, 0) }, { id: "c", ...dash(16, -0.04) }, { id: "e", ...dash(32, 0.02) },
    { id: "p", ...dash(8, 3.5) },
  ];
  const chains = chainFragments(fragments, { maxGap: 13.5 });
  const main = chains.find((c) => c.ids.includes("a"));
  assert.deepEqual(main.ids.length === 4 && (main.ids[0] === "a" ? main.ids : [...main.ids].reverse()), ["a", "b", "c", "e"]);
  assert.ok(chains.find((c) => c.ids.includes("p")).ids.length === 1, "the parallel lane line is its own chain");
});

test("dash phase follows the photo and the statute 3 m / 5 m pattern fills a hidden dash", () => {
  // detected dashes at 1.2-4.2, 9.2-12.2 and 25.2-28.2 (the one at 17.2 hidden by a car)
  const detected = [[1.2, 4.2], [9.2, 12.2], [25.2, 28.2]];
  assert.ok(Math.abs(dashPhase(detected.map(([a, b]) => (a + b) / 2), 8) - 2.7) < 1e-9);
  const { dashes, period } = layDashes({ length: 30, detected, dash: 3, gap: 5 });
  assert.equal(period, 8);
  assert.deepEqual(dashes.map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]), [[1.2, 4.2], [9.2, 12.2], [17.2, 20.2], [25.2, 28.2]]);
  // a measured period: spacing 8.4 m with one hidden dash
  assert.ok(Math.abs(measuredPeriod([[0, 3], [8.4, 11.4], [25.2, 28.2], [33.6, 36.6]], 8) - 8.4) < 1e-9);
  assert.equal(measuredPeriod([[0, 3], [8, 11]], 8), null);
});

test("staggered zebra bars become one rectangle of equal bars at the measured period", () => {
  // 9 bars along a crossing whose bars run north-south (bar axis z), walk axis x; centres jittered +-0.12 m along the
  // walk and +-0.4 m along the bar, lengths 2.6-3.2 m
  const period = 0.903;
  const bars = Array.from({ length: 9 }, (_, k) => ({
    id: `z${k}`,
    centre: [2 + k * period + jitter(k, 0.12), 5 + jitter(k + 3, 0.4)],
    axis: [Math.sin(0.02 * jitter(k, 1)), 1],
    length: 2.9 + jitter(k + 9, 0.3),
  }));
  const fit = fitCrossing(bars, { period, bar: 0.5 });
  assert.equal(fit.count, 9);
  // equal bars, all aligned: one centre line along the walk axis, spacing exactly the period
  for (let k = 1; k < fit.barCentres.length; k += 1) {
    const d = Math.hypot(fit.barCentres[k][0] - fit.barCentres[k - 1][0], fit.barCentres[k][1] - fit.barCentres[k - 1][1]);
    assert.ok(Math.abs(d - period) < 1e-9);
  }
  const lateral = fit.barCentres.map((c) => (c[0] - fit.barCentres[0][0]) * fit.rectangle.axis[0] + (c[1] - fit.barCentres[0][1]) * fit.rectangle.axis[1]);
  assert.ok(Math.max(...lateral.map(Math.abs)) < 1e-9, "bars are not staggered");
  const widths = fit.bars.map((r) => Math.hypot(r[1][0] - r[2][0], r[1][1] - r[2][1]));
  for (const w of widths) assert.ok(Math.abs(w - 0.5) < 1e-9);
  assert.ok(fit.phaseResidual.max <= 0.13);
  // the rectangle is perpendicular to the carriageway given as the road direction
  const road = fitCrossing(bars, { period, bar: 0.5, roadDir: [0, 1] });
  assert.ok(Math.abs(road.rectangle.axis[0]) < 1e-12);
});

test("two overlapping bar groups at one crossing merge into one bar set (no duplicates)", () => {
  const period = 0.903;
  const group = (id, offset, n) => ({ id, bars: Array.from({ length: n }, (_, k) => ({ id: `${id}${k}`, centre: [k * period + offset, 0], axis: [0, 1], length: 3 })) });
  // a second detection of the same crossing, half a period off for its first bars; and a separate crossing 30 m away
  const merged = mergeCrossings([group("A", 0, 8), group("B", 3 * period + 0.45, 6), group("C", 30, 6)]);
  assert.equal(merged.length, 2);
  const one = merged.find((m) => m.ids.includes("A"));
  assert.deepEqual(one.ids.sort(), ["A", "B"]);
  const fit = fitCrossing(one.bars, { period, bar: 0.5 });
  // one set: no two drawn bars closer than a period
  const xs = fit.barCentres.map((c) => c[0]).sort((a, b) => a - b);
  for (let k = 1; k < xs.length; k += 1) assert.ok(xs[k] - xs[k - 1] > period - 1e-9);
  assert.equal(new Set(xs.map((x) => x.toFixed(3))).size, xs.length);
});

test("a crossing split by a median is one bar set; two adjacent rows share one bar grid", () => {
  const period = 0.903;
  const row = (id, u, t0, n, offset = 0) => ({ id, bars: Array.from({ length: n }, (_, k) => ({ id: `${id}${k}`, centre: [t0 + k * period + offset, u], axis: [0, 1], length: 2 })) });
  // north half 6 bars, a 2.4 m median gap, south half 5 bars of the same row (bar axis z, walk x)
  const split = mergeCrossings([row("N", 0, 0, 6), row("S", 0, 5 * period + 2.4 + 0.3, 5)]);
  assert.equal(split.length, 1, "one crossing across the median");
  // a second row beside it (2.1 m along the bar axis), its bars half a period off: still its own crossing
  const rows = mergeCrossings([row("A", 0, 0, 8), row("B", 2.1, 0.45, 8)]);
  assert.equal(rows.length, 2);
  const a = fitCrossing(rows[0].bars, { period, bar: 0.5 });
  const origin = rows[0].bars[0].centre;
  const phase = dashPhase([...rows[0].bars, ...rows[1].bars].map((b) => b.centre[0] - origin[0]), period);
  const frame = { axis: a.rectangle.axis, origin, phase };
  const fa = fitCrossing(rows[0].bars, { period, bar: 0.5, frame });
  const fb = fitCrossing(rows[1].bars, { period, bar: 0.5, frame });
  // every bar of row B lines up with a bar of row A (same walk coordinate modulo the period)
  for (const c of fb.barCentres) {
    const d = Math.min(...fa.barCentres.map((q) => Math.abs((((c[0] - q[0]) % period) + period) % period)));
    assert.ok(d < 1e-9 || Math.abs(d - period) < 1e-9, `bar off the shared grid by ${d}`);
  }
});

test("each crossing row fits its own period and phase within the measured range", () => {
  // a row painted at 0.917 m with an offset phase, bars jittered +-3 cm: its own fit, not the 0.903 m statute grid
  const t = Array.from({ length: 12 }, (_, k) => 0.23 + k * 0.917 + jitter(k, 0.03));
  const own = fitPeriod(t, [0.88, 0.93]);
  assert.ok(Math.abs(own.period - 0.917) <= 0.003, `period ${own.period}`);
  const bars = t.map((x, k) => ({ id: `r${k}`, centre: [x, 0], axis: [0, 1], length: 3 }));
  const fit = fitCrossing(bars, { period: 0.903, bar: 0.5, periodRange: [0.88, 0.93] });
  assert.ok(Math.abs(fit.period - 0.917) <= 0.003);
  // every detected bar lies within 5 cm of a drawn one (a shared 0.903 m grid would drift 0.15 m over 11 periods)
  for (const x of t) assert.ok(Math.min(...fit.barCentres.map((c) => Math.abs(c[0] - x))) <= 0.05, `bar at ${x}`);
  assert.equal(fitPeriod(t.slice(0, 3), [0.88, 0.93]), null, "too few bars: the nominal period");
});

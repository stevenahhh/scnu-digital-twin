import { test } from "node:test";
import assert from "node:assert/strict";
import { fitSimilarity, nccSearch, robustFit } from "./registration.mjs";
import { tileBounds, tileOf, AERIAL12_GRID } from "../lib/aerial12.mjs";
import { validate } from "../lib/schemas.mjs";

// GIS-like footprint corners around the campus (EPSG:5186 metres).
const corners = [
  [243507.5, 263507.8], [243560.2, 263512.1], [243600.9, 263700.4], [243820.3, 263950.2],
  [244171.4, 263954.6], [244100.0, 263600.0], [243900.7, 263520.3], [243700.1, 263800.9],
];
const rotate = ([e, n], deg, [pe, pn]) => {
  const r = (deg * Math.PI) / 180;
  const de = e - pe;
  const dn = n - pn;
  return [pe + de * Math.cos(r) - dn * Math.sin(r), pn + de * Math.sin(r) + dn * Math.cos(r)];
};

test("synthetic shifted corners recover the offset within 0.01 m", () => {
  const pairs = corners.map((p) => ({ from: p, to: [p[0] + 0.37, p[1] - 1.21] }));
  const t = fitSimilarity(pairs, { scale: false });
  assert.ok(Math.abs(t.dE - 0.37) < 0.01, `dE ${t.dE}`);
  assert.ok(Math.abs(t.dN + 1.21) < 0.01, `dN ${t.dN}`);
  assert.ok(Math.abs(t.rotDeg) < 1e-6);
  assert.ok(t.residual_m < 0.01);
  assert.equal(t.n, corners.length);
});

test("a rotated and shifted set recovers rotation and keeps the offset at the pivot", () => {
  const pivot = [243800, 263700];
  const pairs = corners.map((p) => {
    const q = rotate(p, 0.2, pivot);
    return { from: p, to: [q[0] + 0.5, q[1] + 0.25] };
  });
  const t = fitSimilarity(pairs, { scale: false, pivot });
  assert.ok(Math.abs(t.rotDeg - 0.2) < 1e-4, `rot ${t.rotDeg}`);
  assert.ok(Math.abs(t.dE - 0.5) < 0.01 && Math.abs(t.dN - 0.25) < 0.01, `${t.dE} ${t.dN}`);
});

test("noisy pairs report the noise as residual, and the similarity fit recovers scale", () => {
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.2;
  const pairs = corners.map((p) => ({ from: p, to: [243800 + (p[0] - 243800) * 1.001 + 0.3 + noise(), 263700 + (p[1] - 263700) * 1.001 + noise()] }));
  const t = fitSimilarity(pairs, { scale: true, pivot: [243800, 263700] });
  assert.ok(Math.abs(t.scale - 1.001) < 2e-4, `scale ${t.scale}`);
  assert.ok(t.residual_m > 0.01 && t.residual_m < 0.15, `residual ${t.residual_m}`);
});

test("robustFit drops a gross outlier and names it", () => {
  const pairs = corners.map((p, i) => ({ id: `c${i}`, from: p, to: [p[0] + 0.2, p[1] + 0.1] }));
  pairs[3] = { ...pairs[3], to: [pairs[3].to[0] + 6, pairs[3].to[1]] };
  const t = robustFit(pairs, { scale: false, rejectM: 1 });
  assert.equal(t.n, corners.length - 1);
  assert.deepEqual(t.rejected, ["c3"]);
  assert.ok(Math.abs(t.dE - 0.2) < 0.01 && Math.abs(t.dN - 0.1) < 0.01);
});

test("fitSimilarity refuses fewer than two pairs", () => {
  assert.throws(() => fitSimilarity([{ from: [0, 0], to: [1, 1] }]), /two/);
});

test("nccSearch finds a known integer and sub-pixel shift of a textured patch", () => {
  const w = 24;
  const h = 24;
  const r = 4;
  const texture = (x, y) => Math.sin(x * 0.9) * 40 + Math.cos(y * 0.7) * 30 + Math.sin((x + 2 * y) * 0.31) * 50 + 128;
  const ref = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) ref[y * w + x] = texture(x, y);
  // the moving image shows the same content 2 px further right and 1 px further down (window starts at -r)
  const ww = w + 2 * r;
  const mov = new Float32Array(ww * ww);
  for (let y = 0; y < ww; y += 1) for (let x = 0; x < ww; x += 1) mov[y * ww + x] = texture(x - r - 2, y - r - 1);
  const m = nccSearch(ref, w, h, mov, r);
  assert.ok(Math.abs(m.dx - 2) < 0.15 && Math.abs(m.dy - 1) < 0.15, `${m.dx} ${m.dy}`);
  assert.ok(m.ncc > 0.99);
});

test("aerial12 georeference: WMS bbox edges are pixel corners, 0.125 m pixels", () => {
  const b = tileBounds(2, 3);
  assert.deepEqual(b, { E0: 243825, N1: 263715, E1: 243950, N0: 263590 });
  const t = tileOf(243825 + 0.0625, 263715 - 0.0625);
  assert.deepEqual([t.i, t.j], [2, 3]);
  assert.ok(Math.abs(t.col - 0.5) < 1e-9 && Math.abs(t.row - 0.5) < 1e-9, "first pixel centre");
  assert.equal(AERIAL12_GRID.tilePx * AERIAL12_GRID.mpp, AERIAL12_GRID.tileM);
});

const source = (extra = {}) => ({ source: "ngii-2025", available: true, transform: { type: "world-file" }, residual_m: 0, n: 0, measured: false, method: "definition", ...extra });

test("registration schema accepts a valid file and names a bad source", () => {
  const doc = { generated: "2026-11-02", frame: "EPSG:5186", sources: [source(), source({ source: "suncheon-12cm", available: false, transform: null, residual_m: null, n: 0 })] };
  assert.deepEqual(validate("registration", doc), { ok: true, errors: [] });
  const bad = { ...doc, sources: [source({ residual_m: -1 }), source()] };
  const { ok, errors } = validate("registration", bad);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /^ngii-2025: .*residual_m/.test(e)), errors.join("; "));
  assert.ok(errors.some((e) => /repeats/.test(e)), errors.join("; "));
});

test("registration schema: an available, measured source needs a transform and n >= 2", () => {
  const doc = { generated: "2026-11-02", frame: "EPSG:5186", sources: [source({ source: "vworld-z19", measured: true, transform: null, n: 1 })] };
  const { errors } = validate("registration", doc);
  assert.ok(errors.some((e) => /^vworld-z19: .*transform/.test(e)));
  assert.ok(errors.some((e) => /^vworld-z19: .*n/.test(e)));
});

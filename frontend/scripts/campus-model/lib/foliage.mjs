// Foliage cards for the instanced tree crowns (stages/trees.mjs): a leaf atlas drawn here from geometry (self-generated,
// no photo pixel, no external asset; the generator's own work, released with the model) and, per species, a set of
// alpha-tested leaf-cluster cards spread over the crown archetype's surface, so the fitted silhouettes, cover and camera
// clearance stay those of the crowns. Every shape and size is an estimate (추정) read on the SCNU 360 VR tour.
import { encodePng } from "./png.mjs";
import { mulberry32 } from "./raster.mjs";

// Atlas: ATLAS x ATLAS RGBA, four TILE x TILE tiles. The leaves are near-white (luminance 0.62-1.0) with a darker
// midrib, so the crown material and the per-instance colour (season tints) give the hue; background RGB is mid grey at
// alpha 0 so mipmaps do not darken the leaf edges.
export const ATLAS = 1024;
const TILE = ATLAS / 2;
export const TILES = { broadleaf: [0, 0], ginkgo: [1, 0], pine: [0, 1], spray: [1, 1] };

function makeTile(kind, seed) {
  const rgb = new Float32Array(TILE * TILE).fill(0.8);
  const alpha = new Float32Array(TILE * TILE);
  const rng = mulberry32(seed);
  // stamp a shape given a signed distance (pixels, < 0 inside) over a bounding box
  const stamp = (x0, y0, x1, y1, sdf, value) => {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(TILE, Math.ceil(y1)); y += 1) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(TILE, Math.ceil(x1)); x += 1) {
        const [d, v] = sdf(x + 0.5, y + 0.5);
        const a = Math.min(1, Math.max(0, 0.5 - d));
        if (a <= 0) continue;
        const k = y * TILE + x;
        rgb[k] = alpha[k] > 0 ? rgb[k] * (1 - a) + (value ?? v) * a : value ?? v;
        alpha[k] = Math.max(alpha[k], a);
      }
    }
  };
  const segment = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  };
  // an elliptic leaf of half-length a, half-width b, centred (cx, cy), axis angle th, with a darker midrib
  const leaf = (cx, cy, a, b, th, l) => {
    const c = Math.cos(th);
    const s = Math.sin(th);
    stamp(cx - a - 2, cy - a - 2, cx + a + 2, cy + a + 2, (x, y) => {
      const u = (x - cx) * c + (y - cy) * s;
      const v = -(x - cx) * s + (y - cy) * c;
      const taper = b * (1 - 0.35 * Math.max(0, u / a));
      const d = (Math.hypot(u / a, v / taper) - 1) * Math.min(a, taper);
      return [d, Math.abs(v) < 0.9 && Math.abs(u) < a * 0.9 ? l * 0.8 : l];
    });
  };
  const line = (ax, ay, bx, by, w, l) => stamp(Math.min(ax, bx) - w - 2, Math.min(ay, by) - w - 2, Math.max(ax, bx) + w + 2, Math.max(ay, by) + w + 2, (x, y) => [segment(x, y, ax, ay, bx, by) - w, l]);
  const lum = () => 0.62 + rng() * 0.38;

  if (kind === "broadleaf") {
    // zelkova / cherry: twigs of alternate serrate leaves in a few overlapping clusters
    for (let c = 0; c < 9; c += 1) {
      const cx = TILE * (0.22 + rng() * 0.56);
      const cy = TILE * (0.22 + rng() * 0.56);
      for (let i = 0; i < 26; i += 1) {
        const th = rng() * Math.PI * 2;
        const r = TILE * 0.17 * Math.sqrt(rng());
        leaf(cx + Math.cos(th) * r, cy + Math.sin(th) * r, TILE * (0.045 + rng() * 0.025), TILE * (0.02 + rng() * 0.01), th + (rng() - 0.5), lum());
      }
    }
  } else if (kind === "ginkgo") {
    // fan leaves (a sector of about 110 degrees, notched in the middle) on short stalks
    for (let i = 0; i < 150; i += 1) {
      const cx = TILE * (0.12 + rng() * 0.76);
      const cy = TILE * (0.12 + rng() * 0.76);
      const R = TILE * (0.05 + rng() * 0.03);
      const th = rng() * Math.PI * 2;
      const l = lum();
      line(cx, cy, cx - Math.cos(th) * R * 0.7, cy - Math.sin(th) * R * 0.7, 0.9, l * 0.85);
      stamp(cx - R - 2, cy - R - 2, cx + R + 2, cy + R + 2, (x, y) => {
        const dx = x - cx;
        const dy = y - cy;
        const r = Math.hypot(dx, dy);
        let a = Math.atan2(dy, dx) - th;
        a = Math.atan2(Math.sin(a), Math.cos(a));
        const notch = Math.abs(a) < 0.08 && r > R * 0.55;
        const dAng = (Math.abs(a) - 0.96) * r;
        return [notch ? 1 : Math.max(r - R, dAng, R * 0.08 - r), l];
      });
    }
  } else if (kind === "pine") {
    // needle tufts: bundles of long thin needles radiating from the shoot tips
    for (let t = 0; t < 46; t += 1) {
      const cx = TILE * (0.15 + rng() * 0.7);
      const cy = TILE * (0.15 + rng() * 0.7);
      const base = rng() * Math.PI * 2;
      for (let n = 0; n < 34; n += 1) {
        const a = base + (rng() - 0.5) * 2.6;
        const L = TILE * (0.08 + rng() * 0.07);
        line(cx, cy, cx + Math.cos(a) * L, cy + Math.sin(a) * L, 1.4, lum());
      }
    }
  } else {
    // metasequoia sprays (also the clipped conifers): drooping shoots with paired flat needles
    for (let s = 0; s < 17; s += 1) {
      const ax = TILE * (0.1 + rng() * 0.3);
      const ay = TILE * (0.1 + rng() * 0.8);
      const len = TILE * (0.35 + rng() * 0.3);
      const droop = 0.25 + rng() * 0.25;
      const pts = Array.from({ length: 9 }, (_, i) => {
        const u = i / 8;
        return [ax + u * len, ay + droop * len * u * u + (rng() - 0.5) * 2];
      });
      const l = lum();
      for (let i = 0; i < 8; i += 1) line(...pts[i], ...pts[i + 1], 1.1, l * 0.8);
      for (let i = 1; i < 8; i += 1) {
        for (let j = 0; j < 4; j += 1) {
          const u = (i + j / 4) / 8;
          const px = ax + u * len;
          const py = ay + droop * len * u * u;
          const tang = Math.atan2(2 * droop * u, 1);
          const nl = TILE * 0.03 * (1 - 0.5 * u);
          for (const side of [-1, 1]) {
            const a = tang + side * 1.25;
            leaf(px + Math.cos(a) * nl, py + Math.sin(a) * nl, nl, nl * 0.22, a, lum());
          }
        }
      }
    }
  }
  return { rgb, alpha };
}

export function leafAtlas() {
  const px = new Uint8Array(ATLAS * ATLAS * 4);
  let seed = 101;
  for (const [kind, [tx, ty]] of Object.entries(TILES)) {
    const { rgb, alpha } = makeTile(kind, (seed += 7));
    for (let y = 0; y < TILE; y += 1) {
      for (let x = 0; x < TILE; x += 1) {
        const k = y * TILE + x;
        const o = ((ty * TILE + y) * ATLAS + tx * TILE + x) * 4;
        const v = Math.round(255 * Math.min(1, rgb[k]));
        px.set([v, v, v, Math.round(255 * alpha[k])], o);
      }
    }
  }
  return encodePng(ATLAS, ATLAS, 4, px);
}

// Cards over a crown archetype (non-indexed positions in metres). opts: count, size [w, h] m, tile, kind
// ("outward": cards face out from the crown, random roll; "droop": a spray hanging down and out; "flat": near
// horizontal tufts on pads), inner (share of cards inside the crown, filling it), seed. Card centres lie 0.3 of a card
// inside the crown surface, so the cards form the visible surface and reach at most 0.2 of a card past the fitted crown. Normals point out from the crown axis
// (soft, volumetric light); COLOR_0 darkens the inner and lower cards.
export function foliageCards(crown, { count, size, tile, kind, inner = 0.25, seed }) {
  const rng = mulberry32(seed);
  const tris = [];
  let total = 0;
  let top = 0;
  let cy = 0;
  for (let i = 0; i < crown.length; i += 9) {
    const p = [0, 3, 6].map((o) => [crown[i + o], crown[i + o + 1], crown[i + o + 2]]);
    const e1 = p[1].map((v, k) => v - p[0][k]);
    const e2 = p[2].map((v, k) => v - p[0][k]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const area = Math.hypot(...n) / 2;
    if (area <= 1e-6) continue;
    total += area;
    tris.push({ p, n: n.map((v) => v / (2 * area)), cum: total });
    for (const q of p) { top = Math.max(top, q[1]); cy += q[1]; }
  }
  cy /= tris.length * 3;
  const [tu, tv] = TILES[tile];
  const u0 = tu / 2;
  const v0 = tv / 2;
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const pick = () => {
    const r = rng() * total;
    let lo = 0;
    let hi = tris.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tris[mid].cum < r) lo = mid + 1;
      else hi = mid;
    }
    return tris[lo];
  };
  const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (let c = 0; c < count; c += 1) {
    const t = pick();
    let a = rng();
    let b = rng();
    if (a + b > 1) { a = 1 - a; b = 1 - b; }
    let pt = [0, 1, 2].map((k) => t.p[0][k] + a * (t.p[1][k] - t.p[0][k]) + b * (t.p[2][k] - t.p[0][k]));
    const w = size[0] * (0.8 + rng() * 0.4);
    const h = size[1] * (0.8 + rng() * 0.4);
    const isInner = rng() < inner;
    const out = norm([pt[0], 0.35 * (pt[1] - cy), pt[2]]);
    // pull in by half a card (and the inner cards a further 35 % towards the axis at their height)
    pt = pt.map((v, k) => v - t.n[k] * 0.3 * Math.max(w, h));
    if (isInner) pt = [pt[0] * 0.65, pt[1], pt[2] * 0.65];
    let nrm;
    let along;
    const horiz = norm([out[0], 0, out[2]]);
    if (kind === "droop") {
      // the spray hangs out and down from its shoot: its long axis runs out and 30-55 degrees down
      const dip = 0.5 + rng() * 0.45;
      along = norm([horiz[0] * Math.cos(dip), -Math.sin(dip), horiz[2] * Math.cos(dip)]);
      nrm = norm(cross(along, cross([0, 1, 0], along)));
      if (nrm[1] < 0) nrm = nrm.map((v) => -v);
    } else if (kind === "flat") {
      const tilt = (rng() - 0.5) * 0.7;
      nrm = norm([horiz[0] * Math.sin(tilt) + (rng() - 0.5) * 0.2, 1, horiz[2] * Math.sin(tilt) + (rng() - 0.5) * 0.2]);
      along = norm(cross(nrm, [Math.cos(rng() * 6.3), 0, Math.sin(rng() * 6.3)]));
    } else {
      nrm = norm(t.n.map((v, k) => v + (rng() - 0.5) * 0.9 + (k === 1 ? 0.2 : 0)));
      const roll = rng() * Math.PI * 2;
      const ref = Math.abs(nrm[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      const e = norm(cross(ref, nrm));
      const f = cross(nrm, e);
      along = e.map((v, k) => v * Math.cos(roll) + f[k] * Math.sin(roll));
    }
    const side = norm(cross(nrm, along));
    const hw = w / 2;
    const hh = h / 2;
    const corners = [[-hh, -hw], [hh, -hw], [hh, hw], [-hh, hw]].map(([s1, s2]) => pt.map((v, k) => v + along[k] * s1 + side[k] * s2));
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => [u0 + x * 0.5, v0 + y * 0.5]);
    // light: out from the crown axis, a little up; shade: inner cards and the lower crown darker
    const ln = norm([out[0] + nrm[0] * 0.4, out[1] + 0.3 + nrm[1] * 0.4, out[2] + nrm[2] * 0.4]);
    const shade = Math.round(255 * Math.min(1, (isInner ? 0.62 : 0.86) + 0.18 * (pt[1] / top)));
    for (const idx of [0, 1, 2, 0, 2, 3]) {
      positions.push(...corners[idx]);
      normals.push(...ln);
      uvs.push(...uv[idx]);
      colors.push(shade, shade, shade, 255);
    }
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    colors: Uint8Array.from(colors),
    indices: Array.from({ length: positions.length / 3 }, (_, i) => i),
  };
}

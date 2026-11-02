// Occlusion masks for estimators that read the NGII orthophoto: which pixels of a sheet window are hidden by a leaned
// roof (footprint swept to its displaced roof, the facade in between included), by a tree crown, or by a cast shadow.
// An estimator skips every pixel set in `any`.
//
// A window is { w, h, origin: [E, N] of the window's top-left pixel corner (EPSG:5186 m), gsdM }; pixel (i, j) has its
// centre at (E0 + (i + 0.5) gsd, N0 - (j + 0.5) gsd). Buildings are { rings: [outer, ...holes] in [E, N], heightM,
// lean: [dE, dN] m per m of height }; trees are rows { east, north, crownDiameterM, heightM } (data/trees.json order).
// Shadows fall toward bearing sun.azimuthDeg + 180 with length h / tan(elevation) (lib/poleShadow.mjs sun model); grid
// convergence (under 0.3 deg here) is ignored. Pure functions of their inputs: no pixel is read or written here.
import { SUN, shadowLengthM } from "./poleShadow.mjs";

export const pixelCentre = (win, i, j) => [win.origin[0] + (i + 0.5) * win.gsdM, win.origin[1] - (j + 0.5) * win.gsdM];

function insideRings(rings, E, N) {
  let inside = false;
  for (const ring of rings) {
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a, a += 1) {
      const [xa, ya] = ring[a];
      const [xb, yb] = ring[b];
      if ((ya > N) !== (yb > N) && E < ((xb - xa) * (N - ya)) / (yb - ya) + xa) inside = !inside;
    }
  }
  return inside;
}

// Every pixel whose centre lies in rings + t d for some t in [0, 1] (sampled every half pixel along d).
function sweepRings(win, mask, rings, d) {
  const steps = Math.max(1, Math.ceil(Math.hypot(d[0], d[1]) / (win.gsdM / 2)));
  const xs = rings[0].map((p) => p[0]);
  const ys = rings[0].map((p) => p[1]);
  const lo = [Math.min(...xs, ...xs.map((x) => x + d[0])), Math.min(...ys, ...ys.map((y) => y + d[1]))];
  const hi = [Math.max(...xs, ...xs.map((x) => x + d[0])), Math.max(...ys, ...ys.map((y) => y + d[1]))];
  const i0 = Math.max(0, Math.floor((lo[0] - win.origin[0]) / win.gsdM));
  const i1 = Math.min(win.w - 1, Math.ceil((hi[0] - win.origin[0]) / win.gsdM));
  const j0 = Math.max(0, Math.floor((win.origin[1] - hi[1]) / win.gsdM));
  const j1 = Math.min(win.h - 1, Math.ceil((win.origin[1] - lo[1]) / win.gsdM));
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      if (mask[j * win.w + i]) continue;
      const [E, N] = pixelCentre(win, i, j);
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps;
        if (insideRings(rings, E - t * d[0], N - t * d[1])) {
          mask[j * win.w + i] = 1;
          break;
        }
      }
    }
  }
}

function disc(E, N, r, n = 24) {
  return [Array.from({ length: n }, (_, k) => [E + r * Math.cos((2 * Math.PI * k) / n), N + r * Math.sin((2 * Math.PI * k) / n)])];
}

function sweepDisc(win, mask, E, N, r, d) {
  const steps = Math.max(1, Math.ceil(Math.hypot(d[0], d[1]) / (win.gsdM / 2)));
  const i0 = Math.max(0, Math.floor((Math.min(E, E + d[0]) - r - win.origin[0]) / win.gsdM));
  const i1 = Math.min(win.w - 1, Math.ceil((Math.max(E, E + d[0]) + r - win.origin[0]) / win.gsdM));
  const j0 = Math.max(0, Math.floor((win.origin[1] - Math.max(N, N + d[1]) - r) / win.gsdM));
  const j1 = Math.min(win.h - 1, Math.ceil((win.origin[1] - Math.min(N, N + d[1]) + r) / win.gsdM));
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const [x, y] = pixelCentre(win, i, j);
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps;
        if (Math.hypot(x - E - t * d[0], y - N - t * d[1]) <= r) {
          mask[j * win.w + i] = 1;
          break;
        }
      }
    }
  }
}

// { roofs, crowns, shadows, any }: Uint8Array(w * h), 1 = hidden. Crowns are discs at the trunk (trees.json positions
// are lean-free trunks; a crown's own lean is not modelled). shadows excludes pixels already under a roof or crown.
// Pass sun: false (or shadows: false) to skip cast shadows.
export function occlusionMask(win, { buildings = [], trees = [], sun = SUN, shadows: withShadows = true } = {}) {
  const n = win.w * win.h;
  const roofs = new Uint8Array(n);
  const crowns = new Uint8Array(n);
  const cast = new Uint8Array(n);
  for (const b of buildings) sweepRings(win, roofs, b.rings, [b.lean[0] * b.heightM, b.lean[1] * b.heightM]);
  for (const t of trees) sweepDisc(win, crowns, t.east, t.north, t.crownDiameterM / 2, [0, 0]);
  if (withShadows && sun) {
    const bearing = ((sun.azimuthDeg + 180) * Math.PI) / 180;
    const dir = [Math.sin(bearing), Math.cos(bearing)];
    for (const b of buildings) {
      const L = shadowLengthM(b.heightM, sun.elevationDeg);
      sweepRings(win, cast, b.rings, [dir[0] * L, dir[1] * L]);
    }
    for (const t of trees) {
      const L = shadowLengthM(t.heightM, sun.elevationDeg);
      if (L > 0) sweepDisc(win, cast, t.east, t.north, t.crownDiameterM / 2, [dir[0] * L, dir[1] * L]);
    }
    for (let k = 0; k < n; k += 1) if (roofs[k] || crowns[k]) cast[k] = 0;
  }
  const any = new Uint8Array(n);
  for (let k = 0; k < n; k += 1) any[k] = roofs[k] | crowns[k] | cast[k];
  return { roofs, crowns, shadows: cast, any };
}

export { disc as crownRing };

// Tree trunk positions (design §18, §17 rule 2). Pure helpers for fetch/treeInventory.mjs:
//   - campusLeanRatio: the campus relief-lean ratio (m per m of height, [east, north]), the median of the roof-edge
//     fits of data/photo/building-lean.json (prior records carry no measurement and are left out).
//   - revertCrownLean: a crown at height h appears in the photo at trunk + h * ratio; move it back.
//   - intersectBearings: least-squares point of two or more VR bearing rays (scene frame: +x east, +z south; bearings
//     clockwise from north), refused when the rays are near parallel or the point lies behind a station.
//   - treePositionFromViews: two or more refined stations (distinct scenes) that read the crown move the tree to the
//     intersection; otherwise the photo/CHM position stays and is marked estimated.
// All results are estimates (추정).

const DEG = Math.PI / 180;
// Smallest spread between two rays for a usable intersection (degrees, ASSUMED: 1 deg bearing error then moves the
// point by at most ~6 x the range / 57).
export const MIN_SPREAD_DEG = 10;
// Largest move (m) from the photo/CHM crown position an intersection may make; beyond it the VR read another crown.
export const MAX_SHIFT_M = 4;

const median = (list) => {
  const s = [...list].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function campusLeanRatio(records) {
  const fitted = records.filter((r) => r.method === 'roof-edge');
  if (!fitted.length) throw new Error('campusLeanRatio: no roof-edge lean record');
  return [median(fitted.map((r) => r.lean[0])), median(fitted.map((r) => r.lean[1]))];
}

export function revertCrownLean([east, north], heightM, [le, ln]) {
  return [east - heightM * le, north - heightM * ln];
}

const direction = (bearingDeg) => [Math.sin(bearingDeg * DEG), -Math.cos(bearingDeg * DEG)];

export function intersectBearings(rays, { minSpreadDeg = MIN_SPREAD_DEG } = {}) {
  if (rays.length < 2) return null;
  const dirs = rays.map((r) => direction(r.bearingDeg));
  let spread = 0;
  for (let i = 0; i < dirs.length; i += 1) {
    for (let j = i + 1; j < dirs.length; j += 1) {
      const cross = Math.abs(dirs[i][0] * dirs[j][1] - dirs[i][1] * dirs[j][0]);
      spread = Math.max(spread, Math.asin(Math.min(1, cross)) / DEG);
    }
  }
  if (spread < minSpreadDeg) return null;
  // minimise the summed squared perpendicular distance to every ray line
  let a = 0, b = 0, c = 0, bx = 0, bz = 0;
  rays.forEach((r, k) => {
    const [dx, dz] = dirs[k];
    const m00 = 1 - dx * dx, m01 = -dx * dz, m11 = 1 - dz * dz;
    a += m00; b += m01; c += m11;
    bx += m00 * r.x + m01 * r.z;
    bz += m01 * r.x + m11 * r.z;
  });
  const det = a * c - b * b;
  if (Math.abs(det) < 1e-12) return null;
  const x = (c * bx - b * bz) / det;
  const z = (a * bz - b * bx) / det;
  // the point must lie in front of every station
  if (rays.some((r, k) => (x - r.x) * dirs[k][0] + (z - r.z) * dirs[k][1] <= 0)) return null;
  return { x, z, spreadDeg: spread };
}

export function treePositionFromViews([x0, z0], views, { unitsPerMetre, maxShiftM = MAX_SHIFT_M, minSpreadDeg = MIN_SPREAD_DEG } = {}) {
  const keep = { x: x0, z: z0, method: 'photo-chm', estimated: true, scenes: [] };
  const byScene = new Map();
  for (const v of views) if (v.refined && Number.isFinite(v.bearingDeg) && !byScene.has(v.scene)) byScene.set(v.scene, v);
  if (byScene.size < 2) return keep;
  const hit = intersectBearings([...byScene.values()], { minSpreadDeg });
  if (!hit || Math.hypot(hit.x - x0, hit.z - z0) / unitsPerMetre > maxShiftM) return keep;
  return { x: hit.x, z: hit.z, method: 'vr-intersection', estimated: false, scenes: [...byScene.keys()] };
}

// The single reprojection module: WGS84 <-> EPSG:5186 (Korea 2000 / Central Belt 2010) <-> scene <-> simulation.
//
// EPSG:5186 is GRS80 Transverse Mercator, lat0 38, lon0 127, k0 1, FE 200000, FN 600000 (NGII sheet metadata).
// The TM series is Krüger's (the form used for UTM), carried to n^4: forward/inverse error is far below 1 mm
// inside Korea. Scene units are uni.glb's (0.6242 per metre, +x east, +z south) with BLD_D4's bounding-box
// centre at D4_SCENE_ANCHOR; the simulation frame is metres east/north of the D4 anchor. Pure module, no dependencies.

export const EPSG5186 = Object.freeze({
  lat0: 38,
  lon0: 127,
  k0: 1,
  falseEasting: 200000,
  falseNorthing: 600000,
  a: 6378137,
  f: 1 / 298.257222101,
});

// uni.glb (and the traffic simulation) live in scene units with BLD_D4's bounding-box centre at D4_SCENE_ANCHOR.
// The SketchUp source behind uni.glb is the VWorld cadastral footprint set shifted by a constant offset
// (median over 43 buildings whose areas match within 1 %: 4.40 m east, 0.44 m north).
export const SCENE_UNITS_PER_METRE = 0.6242171526;
export const D4_ANCHOR = Object.freeze({ longitude: 127.4764043, latitude: 34.9700548 });
// Frame v2: the scene position that puts the GIS BLD_D4 footprint bbox centre (GIS건물통합정보 AL_D010_12_20261009
// record 133154, EPSG:5186 [243507.55, 263879.65]) exactly on the uni.glb BLD_D4 bbox centre (46.721, -266.797).
// fetch/frameV2.mjs computes it as v1 (46.513, -266.574) plus the v1 residual (2.030, 1.514 scene units, 4.06 m).
export const FRAME_VERSION = 2;
export const D4_SCENE_ANCHOR = Object.freeze({ x: 48.543, z: -265.06 });
export const SOURCE_MODEL_OFFSET = Object.freeze({ x: 2.744, z: -0.274 });

const DEG = Math.PI / 180;
const { a, f, k0, falseEasting: FE, falseNorthing: FN } = EPSG5186;
const n = f / (2 - f);
const n2 = n * n;
const n3 = n2 * n;
const n4 = n3 * n;
const A = (a / (1 + n)) * (1 + n2 / 4 + n4 / 64);
const ALPHA = [
  n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180,
  (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440,
  (61 * n3) / 240 - (103 * n4) / 140,
  (49561 * n4) / 161280,
];
const BETA = [
  n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360,
  n2 / 48 + n3 / 15 - (437 * n4) / 1440,
  (17 * n3) / 480 - (37 * n4) / 840,
  (4397 * n4) / 161280,
];
const DELTA = [
  2 * n - (2 * n2) / 3 - 2 * n3 + (116 * n4) / 45,
  (7 * n2) / 3 - (8 * n3) / 5 - (227 * n4) / 45,
  (56 * n3) / 15 - (136 * n4) / 35,
  (4279 * n4) / 630,
];
const E2N = (2 * Math.sqrt(n)) / (1 + n);

// Gauss-Krüger forward series: returns [xi, eta] (dimensionless, multiply by A).
function forward(lonDeg, latDeg) {
  const phi = latDeg * DEG;
  const dl = (lonDeg - EPSG5186.lon0) * DEG;
  const s = Math.sin(phi);
  const t = Math.sinh(Math.atanh(s) - E2N * Math.atanh(E2N * s));
  const xiP = Math.atan2(t, Math.cos(dl));
  const etaP = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let xi = xiP;
  let eta = etaP;
  for (let j = 1; j <= 4; j += 1) {
    xi += ALPHA[j - 1] * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
    eta += ALPHA[j - 1] * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
  }
  return [xi, eta];
}

// Meridian arc to lat0 (the standard series is the forward series on the central meridian).
const XI0 = forward(EPSG5186.lon0, EPSG5186.lat0)[0];

export function wgs84ToTm(lon, lat) {
  const [xi, eta] = forward(lon, lat);
  return [FE + k0 * A * eta, FN + k0 * A * (xi - XI0)];
}

function seriesInverse(E, N) {
  const xi = (N - FN) / (k0 * A) + XI0;
  const eta = (E - FE) / (k0 * A);
  let xiP = xi;
  let etaP = eta;
  for (let j = 1; j <= 4; j += 1) {
    xiP -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaP -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  let phi = chi;
  for (let j = 1; j <= 4; j += 1) phi += DELTA[j - 1] * Math.sin(2 * j * chi);
  const lon = EPSG5186.lon0 + Math.atan2(Math.sinh(etaP), Math.cos(xiP)) / DEG;
  return [lon, phi / DEG];
}

// The truncated inverse series is consistent with the forward one only to ~1e-6 m; two fixed-point steps
// against the forward series make the round trip exact to floating-point precision.
export function tmToWgs84(E, N) {
  const raw = seriesInverse(E, N);
  let lon = raw[0];
  let lat = raw[1];
  for (let i = 0; i < 2; i += 1) {
    const [qLon, qLat] = seriesInverse(...wgs84ToTm(lon, lat));
    lon += raw[0] - qLon;
    lat += raw[1] - qLat;
  }
  return [lon, lat];
}

// World file of NGII 2025 sheet 34702020 (0.25 m GSD). a/d = pixel size, c/f = centre of the top-left pixel.
export const TFW_34702020 = Object.freeze({
  a: 0.25,
  d: -0.25,
  c: 243324.125,
  f: 264485.875,
  width: 9588,
  height: 11544,
});

// Pixel coordinates have their origin at the CENTRE of the top-left pixel (world-file convention).
export function tmToPixel(E, N, tfw = TFW_34702020) {
  return [(E - tfw.c) / tfw.a, (N - tfw.f) / tfw.d];
}

export function pixelToTm(col, row, tfw = TFW_34702020) {
  return [tfw.c + col * tfw.a, tfw.f + row * tfw.d];
}

export const D4_ANCHOR_TM = Object.freeze(wgs84ToTm(D4_ANCHOR.longitude, D4_ANCHOR.latitude));

// Scene and simulation axes point to TRUE east/north at the D4 anchor (the frame uni.glb, the GLB generator and
// the traffic network were built in). EPSG:5186 grid north is rotated from true north by the meridian
// convergence (about 0.27 deg here, 0.48 deg east of the central meridian) and scaled by the point scale
// factor, so raw grid offsets would move the EXTENT corners by up to ~4 m. GRID_TO_LOCAL is the exact local
// affine at the anchor: the inverse Jacobian of wgs84ToTm times the GRS80 metres per degree. Residual against
// the previous equirectangular frame is second order (< 0.05 m over EXTENT).
const { latitude: ANCHOR_LAT, longitude: ANCHOR_LON } = D4_ANCHOR;
const E2 = f * (2 - f);
const SIN_LAT = Math.sin(ANCHOR_LAT * DEG);
const W = Math.sqrt(1 - E2 * SIN_LAT * SIN_LAT);
const METRES_PER_DEG_LAT = (((a * (1 - E2)) / (W * W * W)) * Math.PI) / 180;
const METRES_PER_DEG_LON = ((a / W) * Math.cos(ANCHOR_LAT * DEG) * Math.PI) / 180;
const H = 1e-4;
const [dEdLon, dNdLon] = (() => {
  const p = wgs84ToTm(ANCHOR_LON + H, ANCHOR_LAT);
  const m = wgs84ToTm(ANCHOR_LON - H, ANCHOR_LAT);
  return [(p[0] - m[0]) / (2 * H), (p[1] - m[1]) / (2 * H)];
})();
const [dEdLat, dNdLat] = (() => {
  const p = wgs84ToTm(ANCHOR_LON, ANCHOR_LAT + H);
  const m = wgs84ToTm(ANCHOR_LON, ANCHOR_LAT - H);
  return [(p[0] - m[0]) / (2 * H), (p[1] - m[1]) / (2 * H)];
})();
// LOCAL_TO_GRID maps local [east, north] metres to grid [dE, dN]; GRID_TO_LOCAL is its inverse.
const LOCAL_TO_GRID = [
  dEdLon / METRES_PER_DEG_LON,
  dEdLat / METRES_PER_DEG_LAT,
  dNdLon / METRES_PER_DEG_LON,
  dNdLat / METRES_PER_DEG_LAT,
];
const DET = LOCAL_TO_GRID[0] * LOCAL_TO_GRID[3] - LOCAL_TO_GRID[1] * LOCAL_TO_GRID[2];
const GRID_TO_LOCAL = [
  LOCAL_TO_GRID[3] / DET,
  -LOCAL_TO_GRID[1] / DET,
  -LOCAL_TO_GRID[2] / DET,
  LOCAL_TO_GRID[0] / DET,
];
// Exported for the SUMO export (coordinate_transform.json epsg5186_local_to_grid): [dE, dN] = M [east, north].
export const LOCAL_TO_GRID_MATRIX = Object.freeze([...LOCAL_TO_GRID]);
export const GRID_CONVERGENCE_DEG = Math.atan2(-LOCAL_TO_GRID[2], LOCAL_TO_GRID[3]) / DEG;

function gridToLocal(E, N) {
  const dE = E - D4_ANCHOR_TM[0];
  const dN = N - D4_ANCHOR_TM[1];
  return [GRID_TO_LOCAL[0] * dE + GRID_TO_LOCAL[1] * dN, GRID_TO_LOCAL[2] * dE + GRID_TO_LOCAL[3] * dN];
}

function localToGrid(east, north) {
  return [
    D4_ANCHOR_TM[0] + LOCAL_TO_GRID[0] * east + LOCAL_TO_GRID[1] * north,
    D4_ANCHOR_TM[1] + LOCAL_TO_GRID[2] * east + LOCAL_TO_GRID[3] * north,
  ];
}

export function tmToScene(E, N) {
  const [east, north] = gridToLocal(E, N);
  return [
    D4_SCENE_ANCHOR.x + east * SCENE_UNITS_PER_METRE - SOURCE_MODEL_OFFSET.x,
    D4_SCENE_ANCHOR.z - north * SCENE_UNITS_PER_METRE - SOURCE_MODEL_OFFSET.z,
  ];
}

export function sceneToTm(x, z) {
  return localToGrid(
    (x + SOURCE_MODEL_OFFSET.x - D4_SCENE_ANCHOR.x) / SCENE_UNITS_PER_METRE,
    -(z + SOURCE_MODEL_OFFSET.z - D4_SCENE_ANCHOR.z) / SCENE_UNITS_PER_METRE,
  );
}

// Simulation frame: metres true east/north of the D4 anchor (campus_transport_network.geojson).
export function tmToSimulation(E, N) {
  const [x, z] = gridToLocal(E, N);
  return { x, z };
}

export function simulationToTm({ x, z }) {
  return localToGrid(x, z);
}

export const wgs84ToSimulation = (lon, lat) => tmToSimulation(...wgs84ToTm(lon, lat));
export const simulationToWgs84 = (point) => tmToWgs84(...simulationToTm(point));

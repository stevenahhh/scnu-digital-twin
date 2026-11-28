// Where the 의대 유치 promo layer (med-promo.mjs) goes on the campus, read from the furniture survey of
// stages/furniture.mjs (loadFurniture objects, scene units): a poster over both faces of each campus banner board, an
// LED screen standing above the A19 gate letter sign, and the loop the three picket marchers walk on the gate plaza
// in front of it. Positions follow the survey; every size and the route are estimates (추정).
import { POSTER_DESIGNS } from "../../../src/render/medPromo/promoArt.mjs";
import { metres } from "../lib/frame.mjs";
import { frame, localPlan } from "../lib/solids.mjs";

const M = metres;

// The campus banner boards ("long campus banner" boards in data/photo/site-detail.geojson).
export const BANNER_IDS = Object.freeze([
  "SD-E1-S2", "SD-E3-S1", "SD-E3-S2", "SD-E5-S2", "SD-E7-S1", "SD-E8-S1", "SD-E8-S3", "SD-A17-S1", "SD-B1-S2",
]);
export const GATE_SIGN_ID = "RS-GATE-A19";
// Signboard defaults of stages/furniture.mjs (SIGNBOARD), for boards without sizes.
const BOARD_DEFAULTS = { widthM: 1.8, panelM: 1.2, clearanceM: 0.6 };
// LED screen over the letter sign (estimated): a 10.4 x 3.2 m face, its bottom 0.7 m above the 5.7 m sign, in a
// 0.5 m deep cabinet on two columns behind the letters.
export const GATE_SCREEN = Object.freeze({ widthM: 10.4, heightM: 3.2, bottomM: 6.4, depthM: 0.5, bezelM: 0.16, columnM: 0.32, backM: 0.75 });
// Marchers' loop (estimated): an ellipse 7 x 3 m round a point 9.5 m in front of the letters.
export const MARCH_LOOP = Object.freeze({ aheadM: 9.5, halfLengthM: 7, halfDepthM: 3, points: 64 });

const bearingDir = (deg) => [Math.sin((deg * Math.PI) / 180), -Math.cos((deg * Math.PI) / 180)];
const unit2 = ([x, z]) => {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
};

export function bannerPlacements(objects) {
  const byId = new Map(objects.map((o) => [o.id, o]));
  return BANNER_IDS.map((id, index) => {
    const o = byId.get(id);
    if (!o || o.kind !== "signboard" || !o.line) throw new Error(`med-promo: banner board ${id} is not in the furniture survey`);
    const [a, b] = [o.line[0], o.line.at(-1)];
    return {
      id,
      design: index % POSTER_DESIGNS.length,
      centre: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      u: unit2([b[0] - a[0], b[1] - a[1]]),
      widthM: o.p.width_m ?? BOARD_DEFAULTS.widthM,
      panelM: o.p.panel_m ?? BOARD_DEFAULTS.panelM,
      clearanceM: o.p.clearance_m ?? BOARD_DEFAULTS.clearanceM,
    };
  });
}

// Frame of the gate sign as stages/furniture.mjs B.gate_sign builds it: origin at the plan centre of the letters' axis
// (y = 0, the caller adds the ground), u the reading direction, `front` the sign of v on the side the letters face.
export function gateScreenPlacement(gate) {
  if (gate?.kind !== "gate_sign" || !gate.line) throw new Error(`med-promo: ${GATE_SIGN_ID} gate sign missing`);
  const [a, b] = [gate.line[0], gate.line.at(-1)];
  const right = bearingDir(gate.p.facing_deg - 90);
  const along = [b[0] - a[0], b[1] - a[1]];
  const u = along[0] * right[0] + along[1] * right[1] >= 0 ? along : [-along[0], -along[1]];
  const f = frame([(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2], u);
  const facing = bearingDir(gate.p.facing_deg);
  return { frame: f, front: f.v[0] * facing[0] + f.v[1] * facing[1] >= 0 ? 1 : -1, signTopM: gate.heightM, ...GATE_SCREEN };
}

// Closed loop of plan points (scene units), walked counter-clockwise seen from above.
export function marcherRoute(screen, loop = MARCH_LOOP) {
  const points = [];
  for (let i = 0; i < loop.points; i += 1) {
    const a = (2 * Math.PI * i) / loop.points;
    points.push(localPlan(screen.frame, loop.halfLengthM * Math.cos(a), screen.front * (loop.aheadM + loop.halfDepthM * Math.sin(a))));
  }
  return points;
}

// Keyframes of `count` marchers spread evenly round the closed route at speedMps: times (s), plan points and yaw
// (rotation about +y turning a +z-facing figure to the walking direction). The last key repeats the first.
export function marcherTracks(route, { count = 3, speedMps = 1.1, stepS = 0.25 } = {}) {
  const cumulative = [0];
  for (let i = 0; i < route.length; i += 1) {
    const [p, q] = [route[i], route[(i + 1) % route.length]];
    cumulative.push(cumulative[i] + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  const total = cumulative.at(-1);
  const at = (d) => {
    const s = ((d % total) + total) % total;
    let i = 0;
    while (cumulative[i + 1] < s) i += 1;
    const [p, q] = [route[i], route[(i + 1) % route.length]];
    const k = (s - cumulative[i]) / (cumulative[i + 1] - cumulative[i]);
    return { point: [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k], yaw: Math.atan2(q[0] - p[0], q[1] - p[1]) };
  };
  const duration = total / M(1) / speedMps;
  const n = Math.ceil(duration / stepS);
  return Array.from({ length: count }, (_, m) => {
    const times = [];
    const points = [];
    const yaws = [];
    for (let i = 0; i < n; i += 1) {
      const { point, yaw } = at(total * (i / n + m / count));
      times.push((duration * i) / n);
      points.push(point);
      yaws.push(yaw);
    }
    times.push(duration);
    points.push([...points[0]]);
    yaws.push(yaws[0]);
    return { times, points, yaws };
  });
}

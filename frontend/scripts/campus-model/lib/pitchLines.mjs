// Dimensions of the painted pitches. stages/surfaces.mjs paints their lines and stages/furniture.mjs stands the goals
// on the same end lines: the goals are surveyed by eye on the photo (confidence 0.5-0.6) and the lines come from the
// OSM outline, so a goal left at its survey point sits 1-2 m off the lines it belongs to.
export const TRACK_LANE_M = 1.22;
export const TRACK_LANES = 8;
export const FOOTBALL_HALF_M = Object.freeze({ length: 52.5, width: 34 });
// The campus futsal pitch: 38.2 x 20.2 m between its painted lines on the NGII 2025 orthophoto (0.25 m GSD; estimated).
export const FUTSAL_HALF_M = Object.freeze({ length: 19.1, width: 10.1 });

// Half length and half width (metres) of the football pitch painted inside a running track whose oriented frame has
// these half extents: the full field where it fits inside the track's inner edge, else the largest that does.
export function trackPitchHalf(halfLengthM, halfWidthM) {
  const radius = halfWidthM;
  const straight = Math.max(0, halfLengthM - radius);
  const inner = radius - TRACK_LANES * TRACK_LANE_M;
  const width = Math.min(FOOTBALL_HALF_M.width, inner - 2);
  const length = Math.min(FOOTBALL_HALF_M.length, straight + Math.sqrt(Math.max(0, inner * inner - width * width)) - 1);
  return { length, width };
}

// The middle of the end line nearest to a surveyed goal, when it lies within `reach` of the goal, and the direction
// from that line into the pitch. pitches: [{ centre: [x, z], axis: [ux, uz] (unit, along the pitch), halfLength }],
// all in one plan unit. null when no end line is that near.
export function snapGoalToEndLine(point, pitches, reach) {
  let best = null;
  for (const { centre, axis, halfLength } of pitches) {
    for (const side of [1, -1]) {
      const mouth = [centre[0] + side * axis[0] * halfLength, centre[1] + side * axis[1] * halfLength];
      const distance = Math.hypot(mouth[0] - point[0], mouth[1] - point[1]);
      if (distance <= reach && (!best || distance < best.distance)) best = { mouth, inward: [-side * axis[0], -side * axis[1]], distance };
    }
  }
  return best && { mouth: best.mouth, inward: best.inward.map((v) => v + 0) };
}

// The playing surface as a plan ring: the rectangle of half extents halfLength (along the axis) and halfWidth (across).
export function pitchRing({ centre, axis, halfLength, halfWidth }) {
  const across = [-axis[1], axis[0]];
  return [[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([w, s]) => [
    centre[0] + s * axis[0] * halfLength + w * across[0] * halfWidth + 0,
    centre[1] + s * axis[1] * halfLength + w * across[1] * halfWidth + 0,
  ]);
}

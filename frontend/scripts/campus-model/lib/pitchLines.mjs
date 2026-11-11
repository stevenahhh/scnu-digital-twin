// Dimensions of the painted pitches. stages/surfaces.mjs paints their lines and stages/furniture.mjs stands the goals
// on the same end lines: the goals are surveyed by eye on the photo (confidence 0.5-0.6) and the lines come from the
// OSM outline, so a goal left at its survey point sits 1-2 m off the lines it belongs to.
export const TRACK_LANE_M = 1.22;
export const TRACK_LANES = 8;
export const FOOTBALL_HALF_M = Object.freeze({ length: 52.5, width: 34 });
// The campus futsal pitch: 38.2 x 20.2 m between its painted lines on the NGII 2025 orthophoto (0.25 m GSD; estimated).
export const FUTSAL_HALF_M = Object.freeze({ length: 19.1, width: 10.1 });
// The blue full basketball court: 24.8 m baseline to baseline and 15.1 m sideline to sideline between the centres of its
// painted lines on the NGII 2025 orthophoto, 2026-11-11 (brightness peaks of the lines across the court; estimated). Its
// key (5.8 x 4.9 m), three-point arc (6.75 m) and centre circle (1.8 m) read as the FIBA ones on the same photo.
export const BASKETBALL_HALF_M = Object.freeze({ length: 12.4, width: 7.55 });
// The red court of the multi court: 15.2 x 6.6 m between the half-maximum edges of its red on the NGII 2025
// orthophoto, 2026-11-11 (estimated); the rest of its area is the green apron.
export const MULTI_COURT_HALF_M = Object.freeze({ length: 7.6, width: 3.3 });
// A tennis court between its outer (doubles) lines, 23.77 x 10.97 m: the green surfaces of the two campus courts measure
// 23.4 x 10.7 m on the NGII 2025 orthophoto (the white outer line is not green), and the clay starts at the lines.
export const TENNIS_COURT_HALF_M = Object.freeze({ length: 11.885, width: 5.485 });
// The two tennis courts stand side by side, their centres 14.88 m apart across their long axes (the green court
// surfaces fitted on the NGII 2025 orthophoto, 2026-11-11; estimated): each lies this far from the label point.
export const TENNIS_COURT_OFFSET_M = 7.44;
// No trunk stands this close to a court surface. It equals the reach of the tree stage's nudge (stages/trees.mjs NUDGE_M):
// a crown traced on a court's own green or teal paint (data/trees.json) is then left out instead of being moved onto the
// court's edge, where its crown would cover the court. placeTrees over the courts, 2026-11-11: trunks inside a court
// 8 -> 0, crowns more than 2 m over a court 12 -> 2 (both in the photo's row of real trees west of the futsal fence).
export const COURT_TREE_CLEARANCE_M = 3;

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

// The surface label of a facility that paints `point` (stages/surfaces.mjs): labels [{ point: [x, z], axis: [ux, uz]
// (unit), area: { centre: [x, z], halfLength, halfWidth } (along and across the axis) or none }], all in one plan unit.
// A label whose court area holds the point paints it; outside every area a label without an area does, and where every
// label has an area the nearest one does (the slivers between the courts and the facility outline). Ties and overlaps
// go to the nearest label point.
export function courtOwner(labels, point) {
  const holds = ({ axis, area }) => {
    const dx = point[0] - area.centre[0];
    const dz = point[1] - area.centre[1];
    return Math.abs(dx * axis[0] + dz * axis[1]) <= area.halfLength && Math.abs(-dx * axis[1] + dz * axis[0]) <= area.halfWidth;
  };
  const inside = labels.filter((label) => label.area && holds(label));
  const open = labels.filter((label) => !label.area);
  const pool = inside.length ? inside : open.length ? open : labels;
  let best = pool[0];
  for (const label of pool) {
    if (Math.hypot(label.point[0] - point[0], label.point[1] - point[1]) < Math.hypot(best.point[0] - point[0], best.point[1] - point[1])) best = label;
  }
  return best;
}

// The playing surfaces of surface labels as pitchRing rectangles: a label's court area, or for a tennis label without
// one its two courts. Labels as in courtOwner plus `surface`; unit: plan units per metre.
export function playingSurfaces(labels, unit = 1) {
  const out = [];
  for (const { surface, point, axis, area } of labels) {
    if (area) out.push({ centre: area.centre, axis, halfLength: area.halfLength, halfWidth: area.halfWidth });
    else if (surface === "tennis") {
      const across = [-axis[1], axis[0]];
      for (const side of [-1, 1]) {
        out.push({
          centre: [point[0] + side * across[0] * TENNIS_COURT_OFFSET_M * unit, point[1] + side * across[1] * TENNIS_COURT_OFFSET_M * unit],
          axis, halfLength: TENNIS_COURT_HALF_M.length * unit, halfWidth: TENNIS_COURT_HALF_M.width * unit,
        });
      }
    }
  }
  return out;
}

// The playing surface as a plan ring: the rectangle of half extents halfLength (along the axis) and halfWidth (across).
export function pitchRing({ centre, axis, halfLength, halfWidth }) {
  const across = [-axis[1], axis[0]];
  return [[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([w, s]) => [
    centre[0] + s * axis[0] * halfLength + w * across[0] * halfWidth + 0,
    centre[1] + s * axis[1] * halfLength + w * across[1] * halfWidth + 0,
  ]);
}

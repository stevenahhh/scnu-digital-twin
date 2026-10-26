// Clean templates for the symbol road markings (stages/markings.mjs): arrows, road text, the diamond, give-way
// triangle, chevrons, wheelchair and bicycle symbols. The photo (0.25 m) shows where such a marking is painted, how
// big it is and which way it points, but not its outline: a detected arrow or text is a blob of paint pixels. So the
// stage draws these templates at the detected centre, orientation and size instead of the blob.
//
// Shapes follow the drawings of 도로교통법 시행규칙 별표 6 (노면표시: 진행방향 5xx, 문자 5xx) as far as their proportions go;
// the proportions below are approximations (추정), the sizes come from the photo. Every template is built in a local
// frame in metres: x to the right of travel, y forward (towards the arrow head / the top of the text), and returned as
// polygons ([outer ring] lists; a ring is [x, y] points, counter-clockwise or not: the stage triangulates either).

const TAU = 2 * Math.PI;

// One straight stroke from a to b, `w` wide, as a rectangle.
export function bar(a, b, w) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  const n = [(-dy / l) * (w / 2), (dx / l) * (w / 2)];
  return [[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]];
}

// A polyline stroked `w` wide: one rectangle per segment plus a square joint at each inner vertex (same colour, so
// the overlaps are invisible).
export function strokes(points, w) {
  const out = [];
  for (let i = 1; i < points.length; i += 1) out.push([bar(points[i - 1], points[i], w)]);
  for (let i = 1; i + 1 < points.length; i += 1) out.push([ring(points[i], w / 2, w / 2, 8)]);
  return out;
}

// Ellipse (n vertices) and elliptic ring `w` wide as a polygon with a hole.
export function ring(c, rx, ry, n = 24) {
  return Array.from({ length: n }, (_, k) => [c[0] + rx * Math.cos((k / n) * TAU), c[1] + ry * Math.sin((k / n) * TAU)]);
}
export function ellipseRing(c, rx, ry, w, n = 28) {
  return [[ring(c, rx + w / 2, ry + w / 2, n), ring(c, Math.max(0.01, rx - w / 2), Math.max(0.01, ry - w / 2), n).reverse()]];
}

// ---------------------------------------------------------------- arrows
// Proportions of a straight arrow `length` long: head HEAD_SHARE of the length, shaft SHAFT_SHARE of the head width.
const HEAD_SHARE = 0.3;
const SHAFT_SHARE = 0.3;
export const ARROW_KINDS = Object.freeze(["arrow_straight", "arrow_left", "arrow_right", "arrow_straight_left", "arrow_straight_right", "arrow_uturn"]);

function head(tip, dir, length, width) {
  const n = [-dir[1], dir[0]];
  const base = [tip[0] - dir[0] * length, tip[1] - dir[1] * length];
  return [tip, [base[0] + (n[0] * width) / 2, base[1] + (n[1] * width) / 2], [base[0] - (n[0] * width) / 2, base[1] - (n[1] * width) / 2]];
}

// Arrow polygons in the local frame, tail at y = -length / 2, the straight head at y = +length / 2. `width` is the
// painted width of the head (photo), clamped to 18-32 % of the length.
export function arrowTemplate(kind, length, width) {
  const headWidth = Math.min(0.32 * length, Math.max(0.18 * length, width));
  const headLength = HEAD_SHARE * length;
  const shaft = SHAFT_SHARE * headWidth;
  const tail = -length / 2;
  const top = length / 2;
  const out = [];
  const straight = () => {
    out.push([bar([0, tail], [0, top - headLength + 0.01], shaft)]);
    out.push([head([0, top], [0, 1], headLength, headWidth)]);
  };
  // a turn branch leaving the shaft at y = from, running sideways (side -1 left, +1 right) with its own head
  const branch = (side, from, reach) => {
    const turnHead = 0.8 * headLength;
    out.push([bar([0, from], [side * (reach - turnHead + 0.01), from], shaft)]);
    out.push([head([side * reach, from], [side, 0], turnHead, 0.85 * headWidth)]);
  };
  const reach = Math.max(headWidth * 1.4, 0.32 * length);
  switch (kind) {
    case "arrow_straight":
      straight();
      break;
    case "arrow_left":
    case "arrow_right": {
      const side = kind === "arrow_left" ? -1 : 1;
      const from = top - 0.35 * length;
      out.push([bar([0, tail], [0, from + shaft / 2], shaft)]);
      branch(side, from, reach);
      break;
    }
    case "arrow_straight_left":
    case "arrow_straight_right":
      straight();
      branch(kind === "arrow_straight_left" ? -1 : 1, tail + 0.45 * length, reach);
      break;
    case "arrow_uturn": {
      // up the shaft, a half turn to the left, back down with the head
      const r = Math.max(0.5 * headWidth, 0.12 * length);
      const yTurn = top - r - shaft / 2;
      out.push([bar([0, tail], [0, yTurn], shaft)]);
      const n = 12;
      const arc = Array.from({ length: n + 1 }, (_, k) => [-r + r * Math.cos((k / n) * Math.PI), yTurn + r * Math.sin((k / n) * Math.PI)]);
      out.push(...strokes(arc, shaft));
      const downTip = [-2 * r, yTurn - 0.45 * length];
      out.push([bar([-2 * r, yTurn], [-2 * r, downTip[1] + 0.8 * headLength - 0.01], shaft)]);
      out.push([head(downTip, [0, -1], 0.8 * headLength, 0.85 * headWidth)]);
      break;
    }
    default:
      throw new Error(`no arrow template for ${kind}`);
  }
  return out;
}

// ---------------------------------------------------------------- road text
// Glyphs on a unit box (x 0..1 left to right, y 0..1 top to bottom), as polylines and ellipses; stroked at STROKE
// of the glyph width. The road-marking face is a narrow gothic stretched along the road (each character about 2.5
// times as long as it is wide); the stage stretches the box to the photo's character size.
const STROKE = 0.2;
const E = (cx, cy, rx, ry) => ({ ellipse: [cx, cy, rx, ry] });
const JAMO = {
  // initials in the left part of a syllable with a vertical vowel (x 0..0.6, y 0..0.55 with a final, 0..1 without)
  hieut: (h) => [[[0.3, 0.02], [0.3, 0.1 * h]], [[0.06, 0.13 * h], [0.54, 0.13 * h]], E(0.3, 0.6 * h, 0.2, 0.26 * h)],
  chieut: (h) => [[[0.3, 0.02], [0.3, 0.1 * h]], [[0.06, 0.13 * h], [0.54, 0.13 * h]], [[0.3, 0.14 * h], [0.06, 0.95 * h]], [[0.3, 0.14 * h], [0.56, 0.95 * h]]],
  sios: (h) => [[[0.3, 0.05], [0.06, 0.95 * h]], [[0.3, 0.05], [0.56, 0.95 * h]]],
  giyeok: (h) => [[[0.06, 0.08], [0.52, 0.08], [0.44, 0.95 * h]]],
};
const SYLLABLES = {
  서: [...JAMO.sios(1), [[0.86, 0.02], [0.86, 0.98]], [[0.6, 0.5], [0.86, 0.5]]],
  행: [...JAMO.hieut(0.58), [[0.72, 0.02], [0.72, 0.62]], [[0.92, 0.02], [0.92, 0.62]], [[0.6, 0.3], [0.72, 0.3]], E(0.5, 0.83, 0.3, 0.13)],
  천: [...JAMO.chieut(0.55), [[0.86, 0.02], [0.86, 0.62]], [[0.6, 0.3], [0.86, 0.3]], [[0.14, 0.66], [0.14, 0.96], [0.92, 0.96]]],
  히: [...JAMO.hieut(1), [[0.86, 0.02], [0.86, 0.98]]],
  경: [...JAMO.giyeok(0.58), [[0.86, 0.02], [0.86, 0.62]], [[0.6, 0.2], [0.86, 0.2]], [[0.6, 0.42], [0.86, 0.42]], E(0.5, 0.83, 0.3, 0.13)],
  차: [...JAMO.chieut(1), [[0.78, 0.02], [0.78, 0.98]], [[0.78, 0.5], [0.97, 0.5]]],
  0: [E(0.5, 0.5, 0.36, 0.44)],
  1: [[[0.55, 0.04], [0.55, 0.96]], [[0.3, 0.2], [0.55, 0.04]]],
  2: [[[0.12, 0.2], [0.3, 0.05], [0.7, 0.05], [0.88, 0.22], [0.88, 0.38], [0.12, 0.95], [0.9, 0.95]]],
  3: [[[0.12, 0.06], [0.86, 0.06], [0.45, 0.43], [0.72, 0.48], [0.88, 0.68], [0.76, 0.9], [0.32, 0.95], [0.1, 0.85]]],
  4: [[[0.7, 0.96], [0.7, 0.04], [0.1, 0.68], [0.92, 0.68]]],
  5: [[[0.86, 0.06], [0.2, 0.06], [0.15, 0.45], [0.6, 0.42], [0.86, 0.6], [0.86, 0.8], [0.66, 0.95], [0.26, 0.95], [0.1, 0.85]]],
  6: [[[0.8, 0.06], [0.42, 0.1], [0.16, 0.45], [0.16, 0.72]], E(0.5, 0.72, 0.34, 0.23)],
  7: [[[0.1, 0.06], [0.9, 0.06], [0.42, 0.96]]],
  8: [E(0.5, 0.27, 0.3, 0.21), E(0.5, 0.72, 0.36, 0.24)],
  9: [E(0.5, 0.3, 0.34, 0.24), [[0.84, 0.3], [0.6, 0.96]]],
};
export const GLYPH_CHARACTERS = Object.freeze(Object.keys(SYLLABLES));

// One character `width` x `height` metres, centred at the local origin, its top towards +y.
export function glyph(char, width, height) {
  const strokes_ = SYLLABLES[char];
  if (!strokes_) throw new Error(`no road-marking glyph for ${char}`);
  const w = STROKE * width;
  const map = ([x, y]) => [(x - 0.5) * width, (0.5 - y) * height];
  const out = [];
  for (const s of strokes_) {
    if (s.ellipse) {
      const [cx, cy, rx, ry] = s.ellipse;
      out.push(...ellipseRing(map([cx, cy]), rx * width, ry * height, w));
    } else {
      out.push(...strokes(s.map(map), w));
    }
  }
  return out;
}

// A word written across the road (left to right as the approaching driver reads it), characters `pitch` apart.
export function textTemplate(text, charWidth, charHeight, pitch = charWidth * 1.25) {
  const chars = [...text];
  const out = [];
  chars.forEach((char, i) => {
    const x = (i - (chars.length - 1) / 2) * pitch;
    for (const poly of glyph(char, charWidth, charHeight)) out.push(poly.map((r) => r.map(([px, py]) => [px + x, py])));
  });
  return out;
}

// ---------------------------------------------------------------- outlines and symbols
// Closed outline (rhombus, triangle) stroked `w` wide as one polygon with a hole: inner ring offset by w.
function outline(points, w) {
  const n = points.length;
  const inner = points.map((p, i) => {
    const a = points[(i + n - 1) % n];
    const b = points[(i + 1) % n];
    const c = [points.reduce((s, q) => s + q[0], 0) / n, points.reduce((s, q) => s + q[1], 0) / n];
    // move towards the centroid so the edge offset is w (exact for the symmetric shapes used here)
    const ea = Math.hypot(p[0] - a[0], p[1] - a[1]);
    const eb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ua = [(p[0] - a[0]) / ea, (p[1] - a[1]) / ea];
    const ub = [(b[0] - p[0]) / eb, (b[1] - p[1]) / eb];
    const sinTurn = Math.abs(ua[0] * ub[1] - ua[1] * ub[0]);
    const half = Math.acos(Math.max(-1, Math.min(1, -(ua[0] * ub[0] + ua[1] * ub[1])))) / 2;
    const d = w / Math.max(0.2, Math.sin(half));
    const toC = [c[0] - p[0], c[1] - p[1]];
    const l = Math.hypot(...toC) || 1;
    return sinTurn < 1e-6 ? p : [p[0] + (toC[0] / l) * d, p[1] + (toC[1] / l) * d];
  });
  return [[points, inner.reverse()]];
}
// Diamond (횡단보도 예고), `length` along the road, `width` across, outline `w` wide.
export const diamondTemplate = (length, width, w) => outline([[0, length / 2], [-width / 2, 0], [0, -length / 2], [width / 2, 0]], w);
// Inverted give-way triangle: base at +y (towards the oncoming driver), apex at -y.
export const triangleTemplate = (length, width, w) => outline([[-width / 2, length / 2], [0, -length / 2], [width / 2, length / 2]], w);
// Chevron: two arms of width w from the apex (0, -depth / 2) to the open ends (+-span / 2, depth / 2).
export const chevronTemplate = (depth, span, w) => [[bar([0, -depth / 2], [-span / 2, depth / 2], w)], [bar([0, -depth / 2], [span / 2, depth / 2], w)]];

// Wheelchair symbol (장애인 전용) in a size x size box: head, back and seat, leg, wheel ring.
export function wheelchairTemplate(size) {
  const s = size;
  const w = 0.09 * s;
  return [
    [ring([-0.08 * s, 0.38 * s], 0.08 * s, 0.08 * s, 16)],
    ...strokes([[-0.12 * s, 0.24 * s], [-0.12 * s, -0.02 * s], [0.16 * s, -0.02 * s], [0.26 * s, -0.3 * s], [0.36 * s, -0.3 * s]], w),
    [bar([-0.12 * s, 0.14 * s], [0.12 * s, 0.14 * s], w)],
    ...ellipseRing([-0.06 * s, -0.16 * s], 0.24 * s, 0.24 * s, w),
  ];
}
// Bicycle symbol in a length (along) x width (across) box: two wheels and the frame.
export function bicycleTemplate(length, width) {
  // painted in side view, flat on the lane: wheels behind and ahead, the frame between them
  const r = Math.min(0.2 * length, 0.45 * width);
  const w = 0.14 * r + 0.03;
  const back = [0, -length / 2 + r];
  const front = [0, length / 2 - r];
  const seat = [0.9 * r, -0.15 * r];
  const bars = [0.9 * r, front[1] - 0.3 * r];
  return [
    ...ellipseRing(back, r, r, w),
    ...ellipseRing(front, r, r, w),
    ...strokes([back, seat, [0, 0.2 * r], back], w),
    ...strokes([seat, bars, front], w),
    [bar([0, 0.2 * r], bars, w)],
  ];
}

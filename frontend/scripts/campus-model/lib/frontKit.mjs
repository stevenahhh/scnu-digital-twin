// Front kit: the solid pieces of a facade record's `front` (data/scnu-facades.json), as boxes for one instanced node.
//
// A front whose look is a curtain wall reads at close range only with real fins and columns, so they are geometry:
// every piece is a unit cube scaled, turned to the wall and coloured per instance (EXT_mesh_gpu_instancing, _COLOR_0).
// Pieces, all optional (sizes in metres, colours sRGB hex; estimated from the VR, 추정):
//   fascia   { height, overhang, rise, colour }       a thin band over the top of the wall, standing proud of it
//   columns  { every, width, depth, colour }            columns at even spacing (about `every`), ends included
//   fins     { spacing, width, depth, colour }          thin vertical fins between the columns, up to the fascia
//   entrance { width, storeys }                        fins start above these storeys in the middle `width`
//   block    { end, share, storeys, depth, colour, window: { width, colour } }  a side block at one end of the edge,
//            with one tall window on its face
//   roof     { width, depth, height, setback, offset, colour }  a rooftop block over the edge, set back from it and
//            `offset` metres right of the middle (negative: left, as seen from outside)
//   sign     { text, charWidth, charHeight, margin, colour }  lettering on the fascia face at its right end (as seen
//            from outside), every stroke of the road-marking glyphs (lib/markingGlyphs.mjs) a thin box
// The edge runs a -> b (scene x, z) with the outside on the left of a -> b, like the wall builders' `point(t, y, out)`.

import { glyph } from "./markingGlyphs.mjs";

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linearColour = (hexColour) => {
  const n = Number.parseInt(hexColour.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => srgbToLinear(c / 255));
};

// Boxes: { centre: [x, y, z], size: [along, up, out], yaw, roll, colour: linear [r, g, b] }; `metres(m)` converts to
// scene units. yaw turns the box's local x onto the edge and its local z onto the outside normal; roll (sign strokes
// only) turns it first about that normal. Seen from outside, +t (a -> b) runs to the viewer's right.
export function frontKit({ a, b, ground, top, storey, front, metres }) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const n = [-u[1], u[0]];
  const yaw = Math.atan2(-u[1], u[0]);
  const boxes = [];
  // a box spanning t0..t1 along the edge, y0..y1, out0..out1 from the wall face
  const box = (t0, t1, y0, y1, out0, out1, colour, roll = 0) => {
    const t = (t0 + t1) / 2;
    const o = (out0 + out1) / 2;
    boxes.push({
      centre: [a[0] + u[0] * t * length + n[0] * o, (y0 + y1) / 2, a[1] + u[1] * t * length + n[1] * o],
      size: [(t1 - t0) * length, y1 - y0, out1 - out0],
      yaw,
      roll,
      colour: linearColour(colour),
    });
  };
  const at = (m) => metres(m) / length; // metres along the edge as a share of it
  const { fascia, columns, fins, entrance, block, roof, sign } = front;
  const wallTop = fascia ? top - metres(fascia.height) : top;
  if (fascia) box(-at(fascia.overhang), 1 + at(fascia.overhang), wallTop, top + metres(fascia.rise ?? 0), 0, metres(fascia.overhang), fascia.colour);

  // the glazed span: the edge less the side block
  let [g0, g1] = [0, 1];
  if (block) {
    const k = { south: [1, 1], north: [1, -1], east: [0, 1], west: [0, -1] }[block.end];
    const startIsEnd = (a[k[0]] - b[k[0]]) * k[1] > 0;
    const [t0, t1] = startIsEnd ? [0, block.share] : [1 - block.share, 1];
    const blockTop = ground + block.storeys * storey;
    box(t0, t1, ground, blockTop, 0, metres(block.depth), block.colour);
    if (block.window) {
      const half = at(block.window.width) / 2;
      const mid = (t0 + t1) / 2;
      box(mid - half, mid + half, ground + metres(0.4), blockTop - metres(0.8), metres(block.depth), metres(block.depth + 0.04), block.window.colour);
    }
    [g0, g1] = startIsEnd ? [t1, 1] : [0, t0];
  }
  const span = g1 - g0;
  const posts = columns ? Math.max(1, Math.round((span * length) / metres(columns.every))) : 0;
  const columnAt = Array.from({ length: posts ? posts + 1 : 0 }, (_, k) => g0 + (span * k) / posts);
  for (const t of columnAt) {
    const half = at(columns.width) / 2;
    box(Math.max(g0, t - half), Math.min(g1, t + half), ground, wallTop, 0, metres(columns.depth), columns.colour);
  }
  if (fins) {
    const clear = (columns ? at(columns.width) / 2 : 0) + at(fins.spacing) / 2;
    const step = at(fins.spacing);
    const half = at(fins.width) / 2;
    for (let t = g0 + step / 2; t < g1 - step / 4; t += step) {
      if (columnAt.some((c) => Math.abs(c - t) < clear)) continue;
      const inDoors = entrance && Math.abs(t - 0.5) < at(entrance.width) / 2;
      const y0 = inDoors ? ground + entrance.storeys * storey : ground + metres(0.1);
      box(t - half, t + half, y0, wallTop, 0, metres(fins.depth), fins.colour);
    }
  }
  if (roof) {
    const half = at(roof.width) / 2;
    const mid = 0.5 + at(roof.offset ?? 0);
    box(mid - half, mid + half, top, top + metres(roof.height), -metres(roof.setback + roof.depth), -metres(roof.setback), roof.colour);
  }
  if (sign && fascia) {
    // strokes 3 cm proud of the fascia face, the text block's right edge `margin` in from the edge's right end
    const out0 = metres(fascia.overhang);
    const out1 = out0 + metres(0.03);
    const pitch = sign.charWidth * 1.15;
    const chars = [...sign.text];
    const right = 1 - at(sign.margin);
    const yMid = (wallTop + top + metres(fascia.rise ?? 0)) / 2;
    chars.forEach((char, i) => {
      if (char === " ") return;
      const x0 = right - at(pitch * (chars.length - 1 - i) + sign.charWidth / 2); // glyph centre, as a share
      for (const piece of strokeBoxes(glyph(char, sign.charWidth, sign.charHeight))) {
        const t = x0 + at(piece.x);
        const halfT = at(piece.length) / 2;
        const y = yMid + metres(piece.y);
        const halfY = metres(piece.width) / 2;
        box(t - halfT, t + halfT, y - halfY, y + halfY, out0, out1, sign.colour, piece.roll);
      }
    });
  }
  return boxes;
}

// Glyph polygons (markingGlyphs: stroke rectangles, 8-gon joints, elliptic rings with a hole) as strokes in the glyph
// plane, metres: { x, y, length, width, roll } (a rectangle centred at x, y, turned by roll from +x).
export function strokeBoxes(polygons) {
  const pieces = [];
  const bar = (p, q, width) => pieces.push({ x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2, length: Math.hypot(q[0] - p[0], q[1] - p[1]), width, roll: Math.atan2(q[1] - p[1], q[0] - p[0]) });
  for (const [outer, inner] of polygons) {
    if (inner) {
      // an elliptic ring (inner ring reversed): its centre line, one bar per segment, a little long so the joints close
      const n = outer.length;
      const mid = outer.map((p, k) => { const r = inner[n - 1 - k]; return [(p[0] + r[0]) / 2, (p[1] + r[1]) / 2]; });
      const width = Math.hypot(outer[0][0] - inner[n - 1][0], outer[0][1] - inner[n - 1][1]);
      mid.forEach((p, k) => {
        const q = mid[(k + 1) % n];
        const d = [q[0] - p[0], q[1] - p[1]];
        const e = (width * 0.25) / Math.hypot(...d);
        bar([p[0] - d[0] * e, p[1] - d[1] * e], [q[0] + d[0] * e, q[1] + d[1] * e], width);
      });
    } else if (outer.length === 4) {
      // bar(a, b, w) gives a+n, b+n, b-n, a-n
      const a = [(outer[0][0] + outer[3][0]) / 2, (outer[0][1] + outer[3][1]) / 2];
      const b = [(outer[1][0] + outer[2][0]) / 2, (outer[1][1] + outer[2][1]) / 2];
      bar(a, b, Math.hypot(outer[0][0] - outer[3][0], outer[0][1] - outer[3][1]));
    } else {
      // a round joint: a square of its diameter
      const c = outer.reduce((s, p) => [s[0] + p[0] / outer.length, s[1] + p[1] / outer.length], [0, 0]);
      const d = 2 * Math.hypot(outer[0][0] - c[0], outer[0][1] - c[1]);
      pieces.push({ x: c[0], y: c[1], length: d, width: d, roll: 0 });
    }
  }
  return pieces;
}

// Instance attributes for GlbBuilder.instancingExtension (rotation about +y by yaw after roll about +z).
export function kitInstances(boxes) {
  const translations = new Float32Array(boxes.length * 3);
  const rotations = new Float32Array(boxes.length * 4);
  const scales = new Float32Array(boxes.length * 3);
  const colors = new Float32Array(boxes.length * 3);
  boxes.forEach(({ centre, size, yaw, roll = 0, colour }, i) => {
    translations.set(centre, i * 3);
    const [sy, cy, sr, cr] = [Math.sin(yaw / 2), Math.cos(yaw / 2), Math.sin(roll / 2), Math.cos(roll / 2)];
    rotations.set([sy * sr, sy * cr, cy * sr, cy * cr], i * 4);
    scales.set(size, i * 3);
    colors.set(colour, i * 3);
  });
  return { translations, rotations, scales, colors };
}

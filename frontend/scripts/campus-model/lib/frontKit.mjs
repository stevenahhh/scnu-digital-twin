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
//   roof     { width, depth, height, setback, colour }  a rooftop block centred over the edge, set back from it
// The edge runs a -> b (scene x, z) with the outside on the left of a -> b, like the wall builders' `point(t, y, out)`.

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linearColour = (hexColour) => {
  const n = Number.parseInt(hexColour.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => srgbToLinear(c / 255));
};

// Boxes: { centre: [x, y, z], size: [along, up, out], yaw, colour: linear [r, g, b] }; `metres(m)` converts to scene
// units. yaw turns the box's local x onto the edge and its local z onto the outside normal.
export function frontKit({ a, b, ground, top, storey, front, metres }) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const n = [-u[1], u[0]];
  const yaw = Math.atan2(-u[1], u[0]);
  const boxes = [];
  // a box spanning t0..t1 along the edge, y0..y1, out0..out1 from the wall face
  const box = (t0, t1, y0, y1, out0, out1, colour) => {
    const t = (t0 + t1) / 2;
    const o = (out0 + out1) / 2;
    boxes.push({
      centre: [a[0] + u[0] * t * length + n[0] * o, (y0 + y1) / 2, a[1] + u[1] * t * length + n[1] * o],
      size: [(t1 - t0) * length, y1 - y0, out1 - out0],
      yaw,
      colour: linearColour(colour),
    });
  };
  const at = (m) => metres(m) / length; // metres along the edge as a share of it
  const { fascia, columns, fins, entrance, block, roof } = front;
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
    box(0.5 - half, 0.5 + half, top, top + metres(roof.height), -metres(roof.setback + roof.depth), -metres(roof.setback), roof.colour);
  }
  return boxes;
}

// Instance attributes for GlbBuilder.instancingExtension (rotation about +y by yaw).
export function kitInstances(boxes) {
  const translations = new Float32Array(boxes.length * 3);
  const rotations = new Float32Array(boxes.length * 4);
  const scales = new Float32Array(boxes.length * 3);
  const colors = new Float32Array(boxes.length * 3);
  boxes.forEach(({ centre, size, yaw, colour }, i) => {
    translations.set(centre, i * 3);
    rotations.set([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], i * 4);
    scales.set(size, i * 3);
    colors.set(colour, i * 3);
  });
  return { translations, rotations, scales, colors };
}

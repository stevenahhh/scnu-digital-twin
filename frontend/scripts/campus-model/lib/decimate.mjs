// Shape-preserving decimation of the flat ground decals and the road markings. The partition (lib/partition.mjs) cuts
// every decal along the Topography grid and every claim edge, so a straight 60 m lane line becomes hundreds of slivers.
// Those cuts only mattered to keep the ground non-overlapping while it was built; once a primitive is final, interior
// vertices can go as long as the drawn shape stays identical in plan and the surface stays on the terrain:
//   - the OUTLINE of every piece (its boundary in plan, where it meets another class) is locked: every boundary vertex
//     stays, so the plan geometry of the paint (lane lines, dashes, zebra bars, stall dividers) is bit-identical;
//   - a seam vertex that lies on a straight boundary edge with a straight neighbour is also removed when the terrain
//     between its two neighbours is flat (the surface would not leave the terrain by more than `toleranceM`);
//   - interior vertices (shared by faces of the same primitive only) collapse when the local surface is planar within
//     `toleranceM` and the collapse does not flip or degenerate a face.
// Attributes (normal, UV, UV1) ride along with the kept vertex: the decals have world-planar UVs and the markings a
// constant palette U, so an edge collapse never shifts a texture.
// Works on one indexed primitive at a time (positions xyz, Float32Array or array; indices Uint32/array).
import { MeshoptSimplifier } from "meshoptimizer";

function boundaryVertices(indices, vertexCount) {
  const edgeUse = new Map();
  const key = (a, b) => (a < b ? a * vertexCount + b : b * vertexCount + a);
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k += 1) {
      const e = key(indices[t + k], indices[t + ((k + 1) % 3)]);
      edgeUse.set(e, (edgeUse.get(e) ?? 0) + 1);
    }
  }
  const boundary = new Uint8Array(vertexCount);
  for (const [e, uses] of edgeUse) {
    if (uses !== 1) continue;
    boundary[Math.floor(e / vertexCount)] = 1;
    boundary[e % vertexCount] = 1;
  }
  return boundary;
}

// Simplifies with every boundary vertex locked. attributes: [{ array, size }] riding along; the collapse keeps the
// surviving vertex's values (meshopt keeps original vertices, never averages), so no attribute is interpolated.
// Returns { positions, indices, attributes, before, after } with unused vertices dropped.
// The paint invariant (qa/invariants.mjs) rejects emitted faces whose plan twice-area is at or below this floor.
export const PAINT_FACE_AREA2_FLOOR_M2 = 2e-8;

// Drops faces the collapse made degenerate in plan: they cover no visible area, and the invariant would reject them.
export function dropSliverFaces(indices, pos32, unitsPerMetre) {
  const floor = PAINT_FACE_AREA2_FLOOR_M2 * unitsPerMetre * unitsPerMetre;
  const kept = [];
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    const area2 = (pos32[b * 3] - pos32[a * 3]) * (pos32[c * 3 + 2] - pos32[a * 3 + 2]) - (pos32[b * 3 + 2] - pos32[a * 3 + 2]) * (pos32[c * 3] - pos32[a * 3]);
    if (Math.abs(area2) <= floor) continue;
    kept.push(a, b, c);
  }
  return kept;
}

export async function decimateDecal({ positions, indices, attributes = [], toleranceM, unitsPerMetre }) {
  await MeshoptSimplifier.ready;
  const vertexCount = positions.length / 3;
  const index32 = indices instanceof Uint32Array ? indices : Uint32Array.from(indices);
  const pos32 = positions instanceof Float32Array ? positions : Float32Array.from(positions);
  if (index32.length < 6) return { positions: pos32, indices: index32, attributes, before: index32.length / 3, after: index32.length / 3 };
  const lock = boundaryVertices(index32, vertexCount);
  // meshopt's error is relative to the mesh extent (getScale); one scene unit of error -> tolerance / extent.
  const extent = MeshoptSimplifier.getScale(pos32, 3);
  const targetError = (toleranceM * unitsPerMetre) / extent;
  const [simplified] = MeshoptSimplifier.simplifyWithAttributes(
    index32, pos32, 3, new Float32Array(0), 0, [], lock, 0, targetError, ["LockBorder"],
  );
  const kept = dropSliverFaces(simplified, pos32, unitsPerMetre);
  const remap = new Int32Array(vertexCount).fill(-1);
  const order = [];
  const outIndices = new Uint32Array(kept.length);
  kept.forEach((v, k) => {
    if (remap[v] < 0) {
      remap[v] = order.length;
      order.push(v);
    }
    outIndices[k] = remap[v];
  });
  const pick = (source, size) => {
    const out = new Float32Array(order.length * size);
    order.forEach((v, k) => {
      for (let c = 0; c < size; c += 1) out[k * size + c] = source[v * size + c];
    });
    return out;
  };
  return {
    positions: pick(pos32, 3),
    indices: outIndices,
    attributes: attributes.map(({ array, size }) => ({ array: pick(array, size), size })),
    before: index32.length / 3,
    after: outIndices.length / 3,
  };
}

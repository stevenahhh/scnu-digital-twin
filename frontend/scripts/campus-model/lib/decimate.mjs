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
import { D4_MATERIAL_SCOPE, splitD4GroundPolygon } from "./landcover.mjs";
import { convexOverlapArea, splitByLine, subtractConvex } from "./partition.mjs";
import { sceneToTm } from "../../../src/geo/epsg5186.mjs";

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
  // a single face has nothing to collapse, but a sliver of it still goes (one marking element can be one face)
  if (index32.length < 6) {
    const kept = Uint32Array.from(dropSliverFaces(index32, pos32, unitsPerMetre));
    return { positions: pos32, indices: kept, attributes, before: index32.length / 3, after: kept.length / 3 };
  }
  const lock = boundaryVertices(index32, vertexCount);
  // meshopt's error is relative to the mesh extent (getScale); one scene unit of error -> tolerance / extent.
  const extent = MeshoptSimplifier.getScale(pos32, 3);
  const targetError = (toleranceM * unitsPerMetre) / extent;
  let [simplified] = MeshoptSimplifier.simplifyWithAttributes(
    index32, pos32, 3, new Float32Array(0), 0, [], lock, 0, targetError, ["LockBorder"],
  );
  // A 3D-preserving collapse can invert its XZ projection at a steep kerb.
  // Restore the original partition inside those folded faces' boxes. Clipping
  // both meshes to the same boxes retains one cover without deleting faces or
  // rerunning meshopt's global queue (which changes distant geometry).
  const boxes = [];
  const [west, south, east, north] = D4_MATERIAL_SCOPE.bbox;
  for (let t = 0; t < simplified.length; t += 3) {
    const tri = Array.from(simplified.subarray(t, t + 3), v => [pos32[v * 3], pos32[v * 3 + 2]]);
    const [a, b, c] = tri;
    const area2 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (area2 <= PAINT_FACE_AREA2_FLOOR_M2 * unitsPerMetre ** 2 || !splitD4GroundPolygon(tri).inside) continue;
    const xs = tri.map(p => p[0]), zs = tri.map(p => p[1]);
    const box = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
    // TM scope edges are rotated in scene space. Even an interior triangle's
    // axis-aligned box can cross them; restore only their exact intersection.
    box.polygon = splitD4GroundPolygon([
      [box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]],
    ]).inside;
    if (!box.polygon) continue;
    boxes.push(box);
  }
  let drawnPositions = pos32, drawnAttributes = attributes;
  if (boxes.length) {
    const output = [], points = Array.from(pos32), boundary = [];
    const values = attributes.map(({ array, size }) => ({ array: Array.from(array), size }));
    for (const [pass, mesh] of [simplified, index32].entries()) {
      for (let t = 0; t < mesh.length; t += 3) {
        const ids = Array.from(mesh.subarray(t, t + 3));
        const tri = ids.map(v => [pos32[v * 3], pos32[v * 3 + 2]]);
        const xs = tri.map(p => p[0]), zs = tri.map(p => p[1]);
        const relevant = boxes.filter(b => Math.min(...xs) < b[2] && Math.max(...xs) > b[0] && Math.min(...zs) < b[3] && Math.max(...zs) > b[1] &&
          convexOverlapArea(tri, b.polygon) > 0);
        if (!relevant.length) { if (pass === 0) output.push(...ids); continue; }
        // A long triangle can cross the D4 border and the repair box. Keep
        // that triangle byte-for-byte and carve its claim from the restored
        // source instead of splitting any geometry outside the allowed box.
        if (pass === 0 && tri.some(([x, z]) => {
          const [e, n] = sceneToTm(x, z);
          return e < west || e > east || n < south || n > north;
        })) {
          output.push(...ids);
          boundary.push(tri);
          continue;
        }
        let rest = [tri];
        const restored = [];
        for (const b of relevant) {
          const outside = [];
          for (const polygon of rest) {
            let inside = polygon;
            for (let edge = 0; edge < b.polygon.length; edge++) {
              if (!inside) break;
              const a = b.polygon[edge], q = b.polygon[(edge + 1) % b.polygon.length];
              const f = p => (q[0] - a[0]) * (p[1] - a[1]) - (q[1] - a[1]) * (p[0] - a[0]);
              const cut = splitByLine(inside, f);
              if (cut.outside) outside.push(cut.outside);
              inside = cut.inside;
            }
            if (inside) restored.push(inside);
          }
          rest = outside;
        }
        const [a, b, c] = tri;
        const det = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        const vertex = p => {
          const original = tri.findIndex(q => p[0] === q[0] && p[1] === q[1]);
          if (original >= 0) return ids[original];
          const wb = ((p[0] - a[0]) * (c[1] - a[1]) - (p[1] - a[1]) * (c[0] - a[0])) / det;
          const wc = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / det;
          const weights = [1 - wb - wc, wb, wc];
          const v = points.length / 3;
          points.push(p[0], weights.reduce((sum, w, k) => sum + w * pos32[ids[k] * 3 + 1], 0), p[1]);
          values.forEach(({ array, size }, j) => {
            for (let k = 0; k < size; k += 1) array.push(weights.reduce((sum, w, q) => sum + w * attributes[j].array[ids[q] * size + k], 0));
          });
          return v;
        };
        let polygons = pass === 0 ? rest : restored;
        if (pass === 1) for (const claim of boundary) {
          polygons = polygons.flatMap(p => convexOverlapArea(p, claim) > 0 ? subtractConvex(p, claim) : [p]);
        }
        for (const polygon of polygons) {
          const corners = polygon.map(vertex);
          for (let k = 1; k + 1 < corners.length; k += 1) output.push(corners[0], corners[k], corners[k + 1]);
        }
      }
    }
    simplified = Uint32Array.from(output);
    drawnPositions = Float32Array.from(points);
    drawnAttributes = values.map(({ array, size }) => ({ array: Float32Array.from(array), size }));
  }
  const kept = dropSliverFaces(simplified, drawnPositions, unitsPerMetre);
  const remap = new Int32Array(drawnPositions.length / 3).fill(-1);
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
    positions: pick(drawnPositions, 3),
    indices: outIndices,
    attributes: drawnAttributes.map(({ array, size }) => ({ array: pick(array, size), size })),
    before: index32.length / 3,
    after: outIndices.length / 3,
  };
}

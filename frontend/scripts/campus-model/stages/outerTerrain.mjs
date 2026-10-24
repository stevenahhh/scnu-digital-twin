// Outer terrain stage: a ring of Copernicus GLO-30 hills (data/cop30.png, fetch/terrain.mjs) around
// uni.glb's Topography, so the campus no longer ends in a flat void. The Topography inside EXTENT is
// left untouched; the ring starts exactly on the EXTENT edge and is feathered onto uni.glb's heights.
//
// - Heights: COP30 surface heights smoothed with a Gaussian (sigma 1.5 px, ASSUMED) and shifted onto
//   uni.glb's vertical datum by the median DEM-minus-Topography difference along the EXTENT edge
//   (DERIVED at build time; the research fit gave 4.4 m).
// - Seam: over the first FEATHER_M outside the edge the height blends from uni.glb's edge height to
//   the DEM (smoothstep, 45 m ASSUMED). The cells touching the edge carry a vertex every 2 units on
//   it, the same vertices Topography has there, so the join has no cracks or T-junctions.
// - Mesh: one `OuterTerrain` node (one draw; its box centre stays near the campus centre, as the
//   shadow-camera test expects), a GRID-unit grid simplified with meshopt to about half the
//   triangles with the borders locked, and a flat "Ground" material (no texture) tinted by vertex
//   colours. The material name keeps CityModel from making it a shadow caster.
import { MeshoptSimplifier } from "meshoptimizer";
import { EXTENT, SCENE_UNITS_PER_METRE, geoToModel, metres, modelToGeo } from "../lib/frame.mjs";
import { LANDCOVER } from "../lib/landcover.mjs";
import { readTerrain } from "../fetch/terrain.mjs";

const SIGMA_PX = 1.5;
const FEATHER_M = 45;
const GRID = 18; // scene units (~29 m, about one COP30 pixel); divides the 504 x 378 EXTENT
const EDGE_STEP = 2; // Topography's vertex spacing on the EXTENT edge (stages/ground.mjs STEP)
const SIMPLIFY_RATIO = 0.5;

// Ground texture class colours of stages/ground.mjs (sRGB), averaged over its ~0.96 brightness noise,
// so the ring's inner edge starts in the colour of the textured ground beside it.
const EDGE_PALETTE = {
  [LANDCOVER.PAVED]: [158, 156, 148],
  [LANDCOVER.GRASS]: [112, 150, 74],
  [LANDCOVER.TREE]: [74, 106, 52],
  [LANDCOVER.SOIL]: [170, 140, 102],
  [LANDCOVER.TRACK]: [178, 84, 66],
  [LANDCOVER.COURT]: [62, 112, 168],
  [LANDCOVER.WATER]: [58, 88, 100],
};
// Muted backdrop tones (sRGB, ASSUMED): low ground (fields, town) and wooded hill slopes.
const LOWLAND = [128, 136, 100];
const HILLSIDE = [78, 98, 62];

const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
const toLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

function gaussianBlur(values, width, height, sigma) {
  const radius = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, k) => Math.exp(-((k - radius) ** 2) / (2 * sigma * sigma)));
  const total = kernel.reduce((a, b) => a + b, 0);
  const pass = (source, stepAlong, count, length, strideAcross) => {
    const out = new Float32Array(source.length);
    for (let line = 0; line < count; line += 1) {
      for (let i = 0; i < length; i += 1) {
        let sum = 0;
        for (let k = -radius; k <= radius; k += 1) {
          const j = Math.max(0, Math.min(length - 1, i + k));
          sum += source[line * strideAcross + j * stepAlong] * kernel[k + radius];
        }
        out[line * strideAcross + i * stepAlong] = sum / total;
      }
    }
    return out;
  };
  return pass(pass(values, 1, height, width, width), width, width, height, 1);
}

// Distance (scene units) from (x, z) to the EXTENT rectangle; 0 on or inside it.
const outsideDistance = (x, z) =>
  Math.hypot(Math.max(EXTENT.minX - x, 0, x - EXTENT.maxX), Math.max(EXTENT.minZ - z, 0, z - EXTENT.maxZ));

function axis(min, max, low, high) {
  // grid lines through both EXTENT edges, GRID apart, out to the DEM window [low, high]
  const lines = [];
  for (let v = min; v >= low; v -= GRID) lines.unshift(v);
  for (let v = min + GRID; v < max; v += GRID) lines.push(v);
  for (let v = max; v <= high; v += GRID) lines.push(v);
  if ((max - min) % GRID) throw new Error(`EXTENT span ${max - min} is not a multiple of ${GRID}`);
  return { lines, first: lines.indexOf(min), last: lines.indexOf(max) };
}

export async function buildOuterTerrain({ glb, inputs }) {
  const { heightAt, landcoverAt } = inputs;
  const dem = await readTerrain();
  const { width, height, meta } = dem;
  const smooth = gaussianBlur(dem.metres, width, height, SIGMA_PX);
  // bilinear DEM metres at (lon, lat); pixel centres sit half a pixel inside the window edges
  const demMetres = (x, z) => {
    const [lon, lat] = modelToGeo(x, z);
    const u = Math.max(0, Math.min(width - 1.001, (lon - meta.west) / meta.pixelDegreesX - 0.5));
    const v = Math.max(0, Math.min(height - 1.001, (meta.north - lat) / meta.pixelDegreesY - 0.5));
    const i = Math.floor(u);
    const j = Math.floor(v);
    const tu = u - i;
    const tv = v - j;
    const s = (ii, jj) => smooth[jj * width + ii];
    return (s(i, j) * (1 - tu) + s(i + 1, j) * tu) * (1 - tv) + (s(i, j + 1) * (1 - tu) + s(i + 1, j + 1) * tu) * tv;
  };

  // vertical datum: median DEM - Topography along the EXTENT edge (2 units inside it)
  const differences = [];
  for (let x = EXTENT.minX + 2; x <= EXTENT.maxX - 2; x += 4) {
    for (const z of [EXTENT.minZ + 2, EXTENT.maxZ - 2]) differences.push(demMetres(x, z) - heightAt(x, z) / SCENE_UNITS_PER_METRE);
  }
  for (let z = EXTENT.minZ + 2; z <= EXTENT.maxZ - 2; z += 4) {
    for (const x of [EXTENT.minX + 2, EXTENT.maxX - 2]) differences.push(demMetres(x, z) - heightAt(x, z) / SCENE_UNITS_PER_METRE);
  }
  differences.sort((a, b) => a - b);
  const offsetMetres = differences[differences.length >> 1];
  let lowMetres = Infinity;
  for (const m of smooth) lowMetres = Math.min(lowMetres, m);

  const feather = metres(FEATHER_M);
  const surfaceAt = (x, z) => {
    const inner = heightAt(x, z); // clamps to the EXTENT edge outside it
    const w = smoothstep(outsideDistance(x, z) / feather);
    return inner + ((demMetres(x, z) - offsetMetres) * SCENE_UNITS_PER_METRE - inner) * w;
  };
  const colourAt = (x, z, y) => {
    const d = outsideDistance(x, z);
    const metresAboveLow = y / SCENE_UNITS_PER_METRE + offsetMetres - lowMetres;
    const far = mix(LOWLAND, HILLSIDE, smoothstep((metresAboveLow - 15) / 45));
    // mean class colour over a GRID-wide patch at the nearest edge point (a single cell's class would
    // streak along the long stitch triangles)
    const near = [0, 0, 0];
    for (let dj = -2; dj <= 2; dj += 1) {
      for (let di = -2; di <= 2; di += 1) {
        const sx = Math.max(EXTENT.minX, Math.min(EXTENT.maxX - 0.5, x + (di * GRID) / 4));
        const sz = Math.max(EXTENT.minZ, Math.min(EXTENT.maxZ - 0.5, z + (dj * GRID) / 4));
        EDGE_PALETTE[landcoverAt(sx, sz)].forEach((c, k) => { near[k] += (c * 0.96) / 25; });
      }
    }
    return mix(near, far, smoothstep(d / (feather * 2))).map((c) => Math.round(toLinear(c) * 255));
  };

  // window in scene units, kept one pixel inside the outermost DEM pixel centres
  const [x0, z0] = geoToModel(meta.west + 1.5 * meta.pixelDegreesX, meta.north - 1.5 * meta.pixelDegreesY);
  const [x1, z1] = geoToModel(meta.west + (width - 1.5) * meta.pixelDegreesX, meta.north - (height - 1.5) * meta.pixelDegreesY);
  const xs = axis(EXTENT.minX, EXTENT.maxX, Math.min(x0, x1), Math.max(x0, x1));
  const zs = axis(EXTENT.minZ, EXTENT.maxZ, Math.min(z0, z1), Math.max(z0, z1));

  const positions = [];
  const normals = [];
  const colours = [];
  const addVertex = (x, z, onEdge, colour) => {
    const y = onEdge ? heightAt(x, z) : surfaceAt(x, z);
    // Edge vertices use Topography's own normal formula so the shading matches across the seam.
    const h = onEdge ? heightAt : surfaceAt;
    const delta = onEdge ? 1 : Math.max(1, Math.min(GRID / 2, outsideDistance(x, z)));
    const nx = (h(x - delta, z) - h(x + delta, z)) / delta;
    const nz = (h(x, z - delta) - h(x, z + delta)) / delta;
    const length = Math.hypot(nx, 2, nz);
    positions.push(x, y, z);
    normals.push(nx / length, 2 / length, nz / length);
    colours.push(...(colour ?? colourAt(x, z, y)), 255);
    return positions.length / 3 - 1;
  };
  const interior = (i, j) => i > xs.first && i < xs.last && j > zs.first && j < zs.last;
  const grid = new Map();
  const gridVertex = (i, j) => {
    const key = j * xs.lines.length + i;
    if (!grid.has(key)) {
      const x = xs.lines[i];
      const z = zs.lines[j];
      grid.set(key, addVertex(x, z, outsideDistance(x, z) === 0));
    }
    return grid.get(key);
  };
  const indices = [];
  const triangle = (a, b, c) => {
    // keep every face pointing up (+y)
    const ux = positions[b * 3] - positions[a * 3];
    const uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3];
    const vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    if (uz * vx - ux * vz >= 0) indices.push(a, b, c);
    else indices.push(a, c, b);
  };
  // Cell whose edge e0-e1 lies on the EXTENT edge: fan the fine edge points onto the far corners.
  const stitch = (e0, e1, o0, o1) => {
    const [ax, , az] = positions.slice(e0 * 3, e0 * 3 + 3);
    const [bx, , bz] = positions.slice(e1 * 3, e1 * 3 + 3);
    const steps = Math.round(Math.hypot(bx - ax, bz - az) / EDGE_STEP);
    const line = [e0];
    // fine points take the corners' colours linearly, so the fans carry no colour streaks
    const colourA = colours.slice(e0 * 4, e0 * 4 + 3);
    const colourB = colours.slice(e1 * 4, e1 * 4 + 3);
    for (let k = 1; k < steps; k += 1) {
      const colour = mix(colourA, colourB, k / steps).map(Math.round);
      line.push(addVertex(ax + ((bx - ax) * k) / steps, az + ((bz - az) * k) / steps, true, colour));
    }
    line.push(e1);
    const middle = steps >> 1;
    for (let k = 0; k < steps; k += 1) triangle(line[k], line[k + 1], k < middle ? o0 : o1);
    triangle(line[middle], o1, o0);
  };
  for (let j = 0; j + 1 < zs.lines.length; j += 1) {
    for (let i = 0; i + 1 < xs.lines.length; i += 1) {
      const insideX = i >= xs.first && i < xs.last;
      const insideZ = j >= zs.first && j < zs.last;
      if (insideX && insideZ) continue;
      if (interior(i, j) || interior(i + 1, j) || interior(i, j + 1) || interior(i + 1, j + 1)) {
        throw new Error(`OuterTerrain cell ${i},${j} reaches inside EXTENT`);
      }
      const a = gridVertex(i, j);
      const b = gridVertex(i + 1, j);
      const c = gridVertex(i, j + 1);
      const d = gridVertex(i + 1, j + 1);
      if (insideX && j === zs.first - 1) stitch(c, d, a, b); // north of the campus: south edge on EXTENT
      else if (insideX && j === zs.last) stitch(a, b, c, d); // south: north edge
      else if (insideZ && i === xs.first - 1) stitch(b, d, a, c); // west: east edge
      else if (insideZ && i === xs.last) stitch(a, c, b, d); // east: west edge
      else {
        triangle(a, c, b);
        triangle(b, c, d);
      }
    }
  }
  const vertexCountBefore = positions.length / 3;
  const triangleCountBefore = indices.length / 3;

  // simplify with both borders (EXTENT seam and outer rim) locked, then drop unused vertices
  await MeshoptSimplifier.ready;
  const target = Math.floor((indices.length * SIMPLIFY_RATIO) / 3) * 3;
  const [simplified] = MeshoptSimplifier.simplify(Uint32Array.from(indices), Float32Array.from(positions), 3, target, 0.01, ["LockBorder"]);
  const remap = new Int32Array(vertexCountBefore).fill(-1);
  const keep = [];
  const outIndices = Array.from(simplified, (index) => {
    if (remap[index] < 0) {
      remap[index] = keep.length;
      keep.push(index);
    }
    return remap[index];
  });
  const pick = (source, size, Type) => {
    const out = new Type(keep.length * size);
    keep.forEach((index, k) => {
      for (let c = 0; c < size; c += 1) out[k * size + c] = source[index * size + c];
    });
    return out;
  };
  const material = glb.addMaterial({
    name: "Ground",
    pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
  });
  const mesh = glb.addMesh("OuterTerrain", [
    {
      positions: pick(positions, 3, Float32Array),
      normals: pick(normals, 3, Float32Array),
      colors: pick(colours, 4, Uint8Array),
      indices: outIndices,
      material,
    },
  ]);
  glb.addNode({ name: "OuterTerrain", mesh }, { root: true });
  return {
    offsetMetres,
    vertexCountBefore,
    triangleCountBefore,
    vertexCount: keep.length,
    triangleCount: outIndices.length / 3,
    attribution: meta.attribution,
  };
}

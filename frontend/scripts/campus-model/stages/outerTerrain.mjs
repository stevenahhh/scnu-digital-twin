// Outer terrain stage: a ring of Copernicus GLO-30 hills (data/cop30.png, fetch/terrain.mjs) around
// uni.glb's Topography, so the campus no longer ends in a flat void. The Topography inside EXTENT is
// left untouched; the ring starts exactly on the EXTENT edge and is feathered onto uni.glb's heights.
//
// - Heights: COP30 surface heights smoothed with a Gaussian (sigma 1.5 px, ASSUMED) and shifted onto
//   uni.glb's vertical datum by the median DEM-minus-Topography difference along the EXTENT edge
//   (DERIVED at build time; the research fit gave 4.4 m).
// - Seam: over the first FEATHER_M outside the edge the height blends from uni.glb's edge height to
//   the DEM (smoothstep, 45 m ASSUMED). The cells touching the edge are a graded band: rows parallel
//   to the edge at BAND rows (vertex every 2 units on the edge itself, the same vertices Topography has
//   there, then 2, 6 and GRID units apart), zipped together, so the join has no cracks, T-junctions or
//   long fan triangles (whose interpolated normals and colours showed as radial streaks).
// - Colour: the inner edge takes the colour of the rendered ground beside it, read from the Ground
//   texture that stages/ground.mjs embedded (mean over a strip EDGE_DEPTH deep, linear light) and
//   darkened like Topography's baked ground AO darkens it (INDIRECT_SHARE, ASSUMED). Outward the
//   along-edge averaging widens with distance and the colour fades over COLOUR_FEATHER_M into the
//   muted backdrop tones, so no seam or streak survives the transition.
// - Mesh: one `OuterTerrain` node (one draw; its box centre stays near the campus centre, as the
//   shadow-camera test expects), a GRID-unit grid simplified with meshopt (normals and colours
//   weighted, the edge band and both borders locked) to about half the triangles, and a flat "Ground"
//   material (no texture) tinted by vertex colours. The material name keeps CityModel from making it a
//   shadow caster.
import { MeshoptSimplifier } from "meshoptimizer";
import { EXTENT, SCENE_UNITS_PER_METRE, geoToModel, metres, modelToGeo } from "../lib/frame.mjs";
import { decodePng } from "../lib/png.mjs";
import { readTerrain } from "../fetch/terrain.mjs";

const SIGMA_PX = 1.5;
const FEATHER_M = 45;
const GRID = 18; // scene units (~29 m, about one COP30 pixel); divides the 504 x 378 EXTENT
const EDGE_STEP = 2; // Topography's vertex spacing on the EXTENT edge (stages/ground.mjs STEP)
// Edge band rows: distance outside the edge and vertex spacing along it (scene units); the last row is
// the first GRID line.
const BAND = [
  { distance: 0, spacing: EDGE_STEP },
  { distance: 4, spacing: EDGE_STEP },
  { distance: 10, spacing: 6 },
  { distance: GRID, spacing: GRID },
];
const SIMPLIFY_RATIO = 0.5;
// Skirt under Topography's edge (scene units): pack.mjs quantizes each mesh on its own grid, which moves
// the two edges apart by up to ~0.1 unit; a hidden strip SKIRT_INSET inside the edge and SKIRT_DROP
// below it covers that crack.
const SKIRT_INSET = 0.25;
const SKIRT_DROP = 0.5;

// Edge colour sampling (scene units): strip depth inside the edge, along-edge half width at the edge and
// its growth per unit of distance outside it.
const EDGE_DEPTH = 3;
const EDGE_HALF_WIDTH = EDGE_STEP;
const EDGE_WIDEN = 0.6;
// ASSUMED: edge colour to backdrop tone. Short on purpose: the edge colour is one ground strip, and a bare-soil
// clearing on the north-west edge carried 160 m (or even 40 m) out read as a brown band across the forested hill
// behind BLD_D4 in the 공대 3호관 preset; over 12 m it only closes the seam.
const COLOUR_FEATHER_M = 12;
// Bare soil on the edge strip (a reddish, unvegetated sample: (R - G) / (R + G + B) in linear light; bare soil on the
// photo reads 0.2-0.25, vegetation below 0, asphalt and paving about 0) does not continue outside EXTENT: the clearing
// on the west edge north of BLD_D4 ends at the edge and the VWorld tiles west of it show closed forest. So outside the
// edge vertices themselves the soil share of the edge colour is replaced by the backdrop tone, and the soil stops at the
// seam instead of fading over the first band rows (ASSUMED thresholds, from the edge strip's own samples).
const SOIL_RATIO_FROM = 0.05;
const SOIL_RATIO_TO = 0.15;
// Share of the daylight ground lighting that is indirect (sky + ambient), the part three.js scales by
// the AO map (ASSUMED from CampusLighting's sun 4.0 / sky 0.45 / ambient 0.15 at 15:00).
const INDIRECT_SHARE = 0.35;
// Muted backdrop tones (sRGB, ASSUMED): low ground (fields, town) and wooded hill slopes.
const LOWLAND = [128, 136, 100];
const HILLSIDE = [78, 98, 62];

const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
const toLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

// Decoded pixels of a texture already embedded in the GLB (each addBufferView call is one chunk).
async function embeddedImage(glb, textureIndex) {
  const image = glb.json.images[glb.json.textures[textureIndex].source];
  const view = glb.json.bufferViews[image.bufferView];
  let offset = 0;
  for (const chunk of glb.chunks) {
    if (offset === view.byteOffset && chunk.byteLength === view.byteLength) {
      const png = image.mimeType === "image/png" ? chunk : await new Bun.Image(chunk).png().toBuffer();
      return decodePng(png);
    }
    offset += chunk.byteLength;
  }
  throw new Error(`texture ${textureIndex}: image bufferView ${image.bufferView} not found in the GLB chunks`);
}

// Per EXTENT edge, prefix sums of the mean linear value of a strip EDGE_DEPTH deep, one entry per image
// row/column along the edge. `at(x, z, halfWidth)` gives the strip mean over [s - halfWidth, s + halfWidth]
// along the nearest edge(s); outside a corner the two edges are weighted by how far the point is past each.
function edgeSampler({ width, height, channels, pixels }, count, decode) {
  const unitsX = (EXTENT.maxX - EXTENT.minX) / width;
  const unitsZ = (EXTENT.maxZ - EXTENT.minZ) / height;
  const profile = (length, depth, pixelAt) => {
    const sums = new Float64Array((length + 1) * count);
    for (let s = 0; s < length; s += 1) {
      for (let k = 0; k < count; k += 1) {
        let total = 0;
        for (let d = 0; d < depth; d += 1) total += decode(pixels[pixelAt(s, d) * channels + k]);
        sums[(s + 1) * count + k] = sums[s * count + k] + total / depth;
      }
    }
    return { sums, length };
  };
  const depthX = Math.max(1, Math.round(EDGE_DEPTH / unitsX));
  const depthZ = Math.max(1, Math.round(EDGE_DEPTH / unitsZ));
  const edges = {
    west: profile(height, depthX, (s, d) => s * width + d),
    east: profile(height, depthX, (s, d) => s * width + width - 1 - d),
    north: profile(width, depthZ, (s, d) => d * width + s),
    south: profile(width, depthZ, (s, d) => (height - 1 - d) * width + s),
  };
  const mean = ({ sums, length }, position, halfWidth, units) => {
    const lo = Math.max(0, Math.min(length - 1, Math.floor(position / units - halfWidth / units)));
    const hi = Math.max(lo + 1, Math.min(length, Math.ceil(position / units + halfWidth / units)));
    return Array.from({ length: count }, (_, k) => (sums[hi * count + k] - sums[lo * count + k]) / (hi - lo));
  };
  return (x, z, halfWidth) => {
    const cx = Math.max(EXTENT.minX, Math.min(EXTENT.maxX, x));
    const cz = Math.max(EXTENT.minZ, Math.min(EXTENT.maxZ, z));
    const sideX = x <= EXTENT.minX ? edges.west : x >= EXTENT.maxX ? edges.east : null;
    const sideZ = z <= EXTENT.minZ ? edges.north : z >= EXTENT.maxZ ? edges.south : null;
    const alongZ = sideX && mean(sideX, cz - EXTENT.minZ, halfWidth, unitsZ);
    const alongX = sideZ && mean(sideZ, cx - EXTENT.minX, halfWidth, unitsX);
    if (!alongX) return alongZ;
    if (!alongZ) return alongX;
    const dx = Math.abs(x - cx);
    const dz = Math.abs(z - cz);
    return mix(alongX, alongZ, dx + dz > 0 ? dx / (dx + dz) : 0.5);
  };
}

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
  const { heightAt } = inputs;
  // Topography's material (stages/ground.mjs): its ground texture and, when attached, its baked AO.
  const ground = glb.json.materials.find((m) => m.name === "Ground" && m.pbrMetallicRoughness.baseColorTexture);
  if (!ground) throw new Error("OuterTerrain: run after stages/ground.mjs (no textured Ground material)");
  const groundColourAt = edgeSampler(await embeddedImage(glb, ground.pbrMetallicRoughness.baseColorTexture.index), 3, toLinear);
  const groundAoAt = ground.occlusionTexture
    ? edgeSampler(await embeddedImage(glb, ground.occlusionTexture.index), 1, (v) => v / 255)
    : () => [1];
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
  const colourFeather = metres(COLOUR_FEATHER_M);
  const colourAt = (x, z, y) => {
    const d = outsideDistance(x, z);
    const metresAboveLow = y / SCENE_UNITS_PER_METRE + offsetMetres - lowMetres;
    const far = mix(LOWLAND, HILLSIDE, smoothstep((metresAboveLow - 15) / 45)).map(toLinear);
    const halfWidth = EDGE_HALF_WIDTH + d * EDGE_WIDEN;
    const shade = 1 - INDIRECT_SHARE * (1 - groundAoAt(x, z, halfWidth)[0]);
    const edge = groundColourAt(x, z, halfWidth);
    const soil = d > 0 ? smoothstep(((edge[0] - edge[1]) / (edge[0] + edge[1] + edge[2] + 1e-6) - SOIL_RATIO_FROM) / (SOIL_RATIO_TO - SOIL_RATIO_FROM)) : 0;
    const near = mix(edge.map((c) => c * shade), far, soil);
    return mix(near, far, smoothstep(d / colourFeather)).map((c) => Math.round(Math.min(1, c) * 255));
  };

  // window in scene units, kept one pixel inside the outermost DEM pixel centres
  const [x0, z0] = geoToModel(meta.west + 1.5 * meta.pixelDegreesX, meta.north - 1.5 * meta.pixelDegreesY);
  const [x1, z1] = geoToModel(meta.west + (width - 1.5) * meta.pixelDegreesX, meta.north - (height - 1.5) * meta.pixelDegreesY);
  const xs = axis(EXTENT.minX, EXTENT.maxX, Math.min(x0, x1), Math.max(x0, x1));
  const zs = axis(EXTENT.minZ, EXTENT.maxZ, Math.min(z0, z1), Math.max(z0, z1));

  const positions = [];
  const normals = [];
  const colours = [];
  const addVertex = (x, z, onEdge) => {
    const y = onEdge ? heightAt(x, z) : surfaceAt(x, z);
    // Edge vertices use Topography's own normal formula so the shading matches across the seam.
    const h = onEdge ? heightAt : surfaceAt;
    const delta = onEdge ? 1 : Math.max(1, Math.min(GRID / 2, outsideDistance(x, z)));
    const nx = (h(x - delta, z) - h(x + delta, z)) / delta;
    const nz = (h(x, z - delta) - h(x, z + delta)) / delta;
    const length = Math.hypot(nx, 2, nz);
    positions.push(x, y, z);
    normals.push(nx / length, 2 / length, nz / length);
    colours.push(...colourAt(x, z, y), 255);
    return positions.length / 3 - 1;
  };
  const interior = (i, j) => i > xs.first && i < xs.last && j > zs.first && j < zs.last;
  // every vertex is keyed by position, so band rows, corner cells and grid cells share their vertices
  const vertices = new Map();
  const vertexAt = (x, z) => {
    const key = `${x.toFixed(3)},${z.toFixed(3)}`;
    if (!vertices.has(key)) vertices.set(key, addVertex(x, z, outsideDistance(x, z) === 0));
    return vertices.get(key);
  };
  const gridVertex = (i, j) => vertexAt(xs.lines[i], zs.lines[j]);
  // skirt vertex at (x, z) inside EXTENT: the edge point's normal and colour, lowered by SKIRT_DROP
  const skirtAt = (x, z, edgeX, edgeZ) => {
    const key = `skirt ${x.toFixed(3)},${z.toFixed(3)}`;
    if (!vertices.has(key)) {
      const v = addVertex(edgeX, edgeZ, true);
      positions[v * 3] = x;
      positions[v * 3 + 1] = heightAt(x, z) - SKIRT_DROP;
      positions[v * 3 + 2] = z;
      vertices.set(key, v);
    }
    return vertices.get(key);
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
  // Zip two polylines spanning the same interval (vertex lists with their parameters along it).
  const zip = (inner, outer) => {
    let i = 0;
    let j = 0;
    while (i < inner.length - 1 || j < outer.length - 1) {
      if (j === outer.length - 1 || (i < inner.length - 1 && inner[i + 1].t <= outer[j + 1].t)) {
        triangle(inner[i].v, inner[i + 1].v, outer[j].v);
        i += 1;
      } else {
        triangle(inner[i].v, outer[j + 1].v, outer[j].v);
        j += 1;
      }
    }
  };
  // Band cell on the EXTENT edge: `at(t, d)` is the point t along the cell's edge span [t0, t1], d outside.
  const bandCell = (t0, t1, at) => {
    const rows = BAND.map(({ distance, spacing }) => {
      const steps = Math.round((t1 - t0) / spacing);
      return Array.from({ length: steps + 1 }, (_, k) => {
        const t = t0 + ((t1 - t0) * k) / steps;
        return { t, v: vertexAt(...at(t, distance)) };
      });
    });
    for (let r = 0; r + 1 < rows.length; r += 1) zip(rows[r], rows[r + 1]);
    const skirt = rows[0].map(({ t }) => ({ t, v: skirtAt(...at(t, -SKIRT_INSET), ...at(t, 0)) }));
    zip(skirt, rows[0]);
  };
  // Corner cell: fan from its far corner over the band row ends on its two inner sides.
  const cornerCell = (cornerX, cornerZ, sx, sz) => {
    const far = vertexAt(cornerX + sx * GRID, cornerZ + sz * GRID);
    const side = [...BAND].reverse().map(({ distance }) => vertexAt(cornerX + sx * distance, cornerZ));
    const other = BAND.slice(1).map(({ distance }) => vertexAt(cornerX, cornerZ + sz * distance));
    const line = [...side, ...other];
    for (let k = 0; k + 1 < line.length; k += 1) triangle(far, line[k], line[k + 1]);
  };
  for (let j = 0; j + 1 < zs.lines.length; j += 1) {
    for (let i = 0; i + 1 < xs.lines.length; i += 1) {
      const insideX = i >= xs.first && i < xs.last;
      const insideZ = j >= zs.first && j < zs.last;
      if (insideX && insideZ) continue;
      if (interior(i, j) || interior(i + 1, j) || interior(i, j + 1) || interior(i + 1, j + 1)) {
        throw new Error(`OuterTerrain cell ${i},${j} reaches inside EXTENT`);
      }
      const [x0, x1] = [xs.lines[i], xs.lines[i + 1]];
      const [z0, z1] = [zs.lines[j], zs.lines[j + 1]];
      const westOf = i === xs.first - 1;
      const eastOf = i === xs.last;
      const northOf = j === zs.first - 1;
      const southOf = j === zs.last;
      if (insideX && northOf) bandCell(x0, x1, (t, d) => [t, EXTENT.minZ - d]);
      else if (insideX && southOf) bandCell(x0, x1, (t, d) => [t, EXTENT.maxZ + d]);
      else if (insideZ && westOf) bandCell(z0, z1, (t, d) => [EXTENT.minX - d, t]);
      else if (insideZ && eastOf) bandCell(z0, z1, (t, d) => [EXTENT.maxX + d, t]);
      else if ((westOf || eastOf) && (northOf || southOf)) {
        cornerCell(westOf ? EXTENT.minX : EXTENT.maxX, northOf ? EXTENT.minZ : EXTENT.maxZ, westOf ? -1 : 1, northOf ? -1 : 1);
      } else {
        const a = gridVertex(i, j);
        const b = gridVertex(i + 1, j);
        const c = gridVertex(i, j + 1);
        const d = gridVertex(i + 1, j + 1);
        triangle(a, c, b);
        triangle(b, c, d);
      }
    }
  }
  const vertexCountBefore = positions.length / 3;
  const triangleCountBefore = indices.length / 3;

  // Simplify with both borders (EXTENT seam and outer rim) and the edge band locked, normals and colours
  // weighted so collapses do not stretch shading or colour into slivers, then drop unused vertices.
  await MeshoptSimplifier.ready;
  const target = Math.floor((indices.length * SIMPLIFY_RATIO) / 3) * 3;
  const attributes = new Float32Array(vertexCountBefore * 6);
  const lock = new Uint8Array(vertexCountBefore);
  for (let v = 0; v < vertexCountBefore; v += 1) {
    for (let k = 0; k < 3; k += 1) {
      attributes[v * 6 + k] = normals[v * 3 + k];
      attributes[v * 6 + 3 + k] = colours[v * 4 + k] / 255;
    }
    lock[v] = outsideDistance(positions[v * 3], positions[v * 3 + 2]) < GRID ? 1 : 0;
  }
  const [simplified] = MeshoptSimplifier.simplifyWithAttributes(
    Uint32Array.from(indices), Float32Array.from(positions), 3, attributes, 6, [0.5, 0.5, 0.5, 1, 1, 1], lock, target, 0.01, ["LockBorder"],
  );
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
  const finalPositions = pick(positions, 3, Float32Array);
  const mesh = glb.addMesh("OuterTerrain", [
    {
      positions: finalPositions,
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
    // the drawn mesh, for things that stand on the ring (stages/context.mjs meshHeightAt)
    positions: finalPositions,
    indices: outIndices,
  };
}

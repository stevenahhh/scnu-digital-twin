// Ground stage: the Topography terrain (chunked, natural ground material) and the class polygons of the modelled ground
// (network/surfaces.mjs: road zones, A003 walkways, lots, plazas, painted surfaces, building aprons), which
// stages/surfaces.mjs lays on it as Ground_* decal meshes. No photo pixel is baked into the ground (plan
// uhf-ground-roads-routing todo 10: the orthophoto ground composite and its module are gone; the VWorld z19 mosaic is read
// only for the roof colours and the road-marking photo checks). The surface-class label raster (groundInfo) the lamp
// rule reads is rasterised from the same polygons. Road markings are geometry (stages/markings.mjs), laid on the
// terrain triangles that topographySurface() describes.
// Topography primitives carry a planar TEXCOORD_1 over EXTENT; data/ao-ground.png (baked from the raw GLB by
// `bake/bake-ao.mjs --planar`, an estimated simulation and not a measurement) becomes the occlusionTexture of the
// Ground material and the Ground_* materials when its layout tag matches this build's.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmToScene } from "../../../src/geo/epsg5186.mjs";
import { EXTENT } from "../lib/frame.mjs";
import { MeshData } from "../lib/meshData.mjs";
import { SURFACE_CLASS } from "../lib/surfaceClass.mjs";
import { PX, buildSurfaces, loadGroundFeatures, loadWalkways } from "../network/surfaces.mjs";
import { GRASS_TILE, naturalGroundMaterial, planarTileUv } from "./surfaces.mjs";

const WIDTH = EXTENT.maxX - EXTENT.minX;
const DEPTH = EXTENT.maxZ - EXTENT.minZ;

const STEP = 2;
const CHUNK = 42;

const AO_GROUND = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "ao-ground.png");
const AO_GROUND_SIZE = 1024;
const AO_GROUND_LAYOUT = `planar:${EXTENT.minX},${EXTENT.minZ},${WIDTH}x${DEPTH}@${AO_GROUND_SIZE}`;

// The aoLayout tag a baked PNG carries in its tEXt chunk, or null.
function pngLayoutTag(bytes) {
  for (let offset = 8; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString("ascii", offset + 4, offset + 8) === "tEXt") {
      const [key, value] = bytes.toString("latin1", offset + 8, offset + 8 + length).split("\0");
      if (key === "aoLayout") return value;
    }
    offset += 12 + length;
  }
  return null;
}

// The Topography surface as drawn: heightAt sampled on the STEP grid over EXTENT, each cell split into the two
// triangles of the chunk meshes below (a c b and b c d: the diagonal runs from (x + STEP, z) to (x, z + STEP)),
// heights and vertex normals interpolated linearly inside them. stages/markings.mjs lays its geometry on it.
export function topographySurface(heightAt) {
  const cols = Math.round(WIDTH / STEP) + 1;
  const rows = Math.round(DEPTH / STEP) + 1;
  const heights = new Float64Array(cols * rows);
  const normals = new Float64Array(cols * rows * 3);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const x = EXTENT.minX + i * STEP;
      const z = EXTENT.minZ + j * STEP;
      const k = j * cols + i;
      heights[k] = heightAt(x, z);
      const nx = heightAt(x - 1, z) - heightAt(x + 1, z);
      const nz = heightAt(x, z - 1) - heightAt(x, z + 1);
      const length = Math.hypot(nx, 2, nz);
      normals.set([nx / length, 2 / length, nz / length], k * 3);
    }
  }
  // Corner indices and barycentric weights of the terrain triangle holding (x, z).
  const locate = (x, z) => {
    const fx = (x - EXTENT.minX) / STEP;
    const fz = (z - EXTENT.minZ) / STEP;
    const i = Math.max(0, Math.min(cols - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(rows - 2, Math.floor(fz)));
    const u = fx - i;
    const v = fz - j;
    const a = j * cols + i;
    const b = a + 1;
    const c = a + cols;
    const d = c + 1;
    return u + v <= 1 ? [[a, b, c], [1 - u - v, u, v]] : [[d, c, b], [u + v - 1, 1 - u, 1 - v]];
  };
  return {
    grid: { step: STEP, x0: EXTENT.minX, z0: EXTENT.minZ },
    height(x, z) {
      const [[p, q, r], [wp, wq, wr]] = locate(x, z);
      return heights[p] * wp + heights[q] * wq + heights[r] * wr;
    },
    normal(x, z) {
      const [corners, weights] = locate(x, z);
      const n = [0, 0, 0];
      corners.forEach((k, m) => { for (let axis = 0; axis < 3; axis += 1) n[axis] += normals[k * 3 + axis] * weights[m]; });
      const length = Math.hypot(n[0], n[1], n[2]);
      return [n[0] / length, n[1] / length, n[2] / length];
    },
  };
}

// Returns the Topography surface the decals and markings are laid on, the class polygons (layers) and the
// surface-class raster (groundInfo) the lamp rule reads.
export async function buildGround({ glb, inputs, selectableBuildings, campusBuildings, offCampusLots }) {
  const { heightAt, landcoverAt } = inputs;
  const surfaces = buildSurfaces({
    inputs,
    walkways: await loadWalkways(),
    groundFeatures: await loadGroundFeatures(),
    offCampusLots,
    buildings: [...selectableBuildings, ...campusBuildings],
    crosswalks: inputs.crosswalks,
  });
  const width = Math.round(WIDTH * PX);
  const height = Math.round(DEPTH * PX);
  const labels = surfaces.labelRaster(width, height, ([E, N]) => {
    const [x, z] = tmToScene(E, N);
    return [(x - EXTENT.minX) * PX, (z - EXTENT.minZ) * PX];
  });
  console.log(`ground: ${surfaces.layers.length} class polygons, arterial ${surfaces.arterial.strips} traced strips (${surfaces.arterial.quads} quads); label raster ${width}x${height}`);

  // Ground AO first: the natural Ground material and the Ground_* decals (stages/surfaces.mjs) share it.
  let aoTexture = null;
  if (existsSync(AO_GROUND)) {
    const png = readFileSync(AO_GROUND);
    const bakedFor = pngLayoutTag(png);
    if (bakedFor === AO_GROUND_LAYOUT) {
      aoTexture = glb.addTexture(png, "image/png", { repeat: false });
      console.log(`ground AO: ${path.basename(AO_GROUND)} (${png.length} B) attached as occlusionTexture`);
    } else {
      console.warn(`ground AO: ${path.basename(AO_GROUND)} was baked for ${bakedFor ?? "(none)"}, this build is ${AO_GROUND_LAYOUT}; left out. Re-bake: bun scripts/campus-model/bake/bake-ao.mjs --planar`);
    }
  } else {
    console.warn(`ground AO: ${path.basename(AO_GROUND)} missing; see scripts/campus-model/bake/README.md`);
  }
  const natural = await naturalGroundMaterial(glb, landcoverAt, aoTexture);
  const groundMaterial = natural.material;
  console.log(`ground: natural Topography ground, ${natural.width}x${natural.height} land-cover colour map (0.5 m/texel) under the ${GRASS_TILE} CC0 relief tile (${natural.tileSize} m); no photo pixels in the ground material`);
  glb.json.asset.extras = {
    ...glb.json.asset.extras,
    aoGroundLayout: AO_GROUND_LAYOUT,
    aoGroundSize: AO_GROUND_SIZE,
    ground: {
      method: "modelled surfaces (plan uhf-ground-roads-routing)",
      photoPixelsBaked: false,
      materials: "data/materials/ground-materials.json",
      note: "ground albedo, kerb heights and material values are estimates, not measurements",
    },
  };

  // ---- terrain (chunked so raycasts stay cheap)
  const topographyChildren = [];
  for (let cz = EXTENT.minZ; cz < EXTENT.maxZ; cz += CHUNK) {
    for (let cx = EXTENT.minX; cx < EXTENT.maxX; cx += CHUNK) {
      const data = new MeshData();
      const xs = [];
      const zs = [];
      for (let x = cx; x < Math.min(cx + CHUNK, EXTENT.maxX) + 1e-6; x += STEP) xs.push(Math.min(x, EXTENT.maxX));
      for (let z = cz; z < Math.min(cz + CHUNK, EXTENT.maxZ) + 1e-6; z += STEP) zs.push(Math.min(z, EXTENT.maxZ));
      if (xs.at(-1) < Math.min(cx + CHUNK, EXTENT.maxX)) xs.push(Math.min(cx + CHUNK, EXTENT.maxX));
      if (zs.at(-1) < Math.min(cz + CHUNK, EXTENT.maxZ)) zs.push(Math.min(cz + CHUNK, EXTENT.maxZ));
      for (const z of zs) {
        for (const x of xs) {
          const nx = heightAt(x - 1, z) - heightAt(x + 1, z);
          const nz = heightAt(x, z - 1) - heightAt(x, z + 1);
          const length = Math.hypot(nx, 2, nz);
          data.vertex([x, heightAt(x, z), z], [nx / length, 2 / length, nz / length], planarTileUv(x, z, natural.tileSize));
        }
      }
      for (let j = 0; j + 1 < zs.length; j += 1) {
        for (let i = 0; i + 1 < xs.length; i += 1) {
          const a = j * xs.length + i;
          const b = a + 1;
          const c = a + xs.length;
          const d = c + 1;
          data.indices.push(a, c, b, b, c, d);
        }
      }
      const name = `Topography_${topographyChildren.length}`;
      const primitive = data.toPrimitive(groundMaterial);
      const mesh = glb.addMesh(name, [primitive]);
      // GlbBuilder.addMesh writes TEXCOORD_0 only; the planar AO coordinate is added here.
      const uv1 = new Float32Array((primitive.positions.length / 3) * 2);
      for (let v = 0; v < uv1.length / 2; v += 1) {
        uv1[v * 2] = (primitive.positions[v * 3] - EXTENT.minX) / WIDTH;
        uv1[v * 2 + 1] = (primitive.positions[v * 3 + 2] - EXTENT.minZ) / DEPTH;
      }
      glb.json.meshes[mesh].primitives[0].attributes.TEXCOORD_1 = glb.addAccessor(uv1, "VEC2");
      topographyChildren.push(glb.addNode({ name, mesh }));
    }
  }
  glb.addNode({ name: "Topography", children: topographyChildren }, { root: true });
  return {
    surfaces,
    layers: surfaces.layers,
    aoTexture,
    surface: topographySurface(heightAt),
    groundInfo: { width, height, px: PX, labels, classes: SURFACE_CLASS },
  };
}

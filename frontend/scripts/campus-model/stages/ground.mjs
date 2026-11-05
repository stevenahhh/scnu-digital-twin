// Ground stage: the Topography terrain (chunked, natural ground material) and the class polygons of the modelled ground,
// read from the one parcel map data/ground/parcels.json (design §5, lib/parcels.mjs; seeded from network/surfaces.mjs:
// road zones, A003 walkways, lots, plazas, painted surfaces, building aprons, then curated), which
// stages/surfaces.mjs lays on it as Ground_* decal meshes. The kerb lines are the walkway parcel boundaries. No photo pixel is baked into the ground (plan
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
import { loadParcels, parcelLayers, parcelOutlines } from "../lib/parcels.mjs";
import { EDGE_STONE_M, PRECEDENCE, PX, labelRaster } from "../network/surfaces.mjs";
import { GRASS_TILE, groundTile, naturalGroundMaterial, planarTileUv, tileMaterial } from "./surfaces.mjs";
import { d4NaturalTile, splitD4GroundPolygon } from "../lib/landcover.mjs";
import { splitByLine } from "../lib/partition.mjs";

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

// The ground surfaces of a parcel map doc: { layers (stage layer records, file order), outlines (kerb lines: walkway
// parcel rings closed, then the open A003 kerbLines), strokes (the edge stone along every outline, label KERB),
// labelRaster }. The label raster keeps network/surfaces.mjs labelRaster semantics (lamps, kerbs, trees read it).
export function parcelSurfaces(doc) {
  const layers = parcelLayers(doc.parcels);
  const outlines = parcelOutlines(doc.parcels, doc.kerbLines ?? []);
  const strokes = outlines.map((o) => ({ line: o.line, widthM: EDGE_STONE_M, label: SURFACE_CLASS.KERB, precedence: PRECEDENCE.A003 + 0.6 }));
  return {
    parcels: doc.parcels,
    paintExcluded: doc.paintExcluded ?? [],
    paintSuppressed: doc.paintSuppressed ?? [],
    paintExcludedDetail: doc.paintExcludedDetail ?? [],
    layers,
    outlines,
    strokes,
    labelRaster: (width, height, toPixel) => labelRaster({ layers, strokes }, width, height, toPixel),
  };
}

// Returns the Topography surface the decals and markings are laid on, the class polygons (layers) and the
// surface-class raster (groundInfo) the lamp rule reads.
export async function buildGround({ glb, inputs, parcelsDoc = loadParcels() }) {
  const { heightAt, landcoverAt } = inputs;
  const surfaces = parcelSurfaces(parcelsDoc);
  const width = Math.round(WIDTH * PX);
  const height = Math.round(DEPTH * PX);
  const labels = surfaces.labelRaster(width, height, ([E, N]) => {
    const [x, z] = tmToScene(E, N);
    return [(x - EXTENT.minX) * PX, (z - EXTENT.minZ) * PX];
  });
  console.log(`ground: ${surfaces.layers.length} class polygons from data/ground/parcels.json (${surfaces.parcels.filter((p) => p.source === "photo-paint-support").length} paint supports), ${surfaces.outlines.length} kerb lines; label raster ${width}x${height}`);

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
  const d4Materials = new Map();
  for (const [cls, name] of [["d4-grass", "Ground_Grass_D4"], ["d4-soil", "Ground_Soil_D4"]]) {
    d4Materials.set(cls, {
      material: await tileMaterial(glb, { name, cls, rank: 0, ao: aoTexture }),
      size: groundTile(cls).entry.physicalSizeM,
    });
  }
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

  // ---- terrain (chunked so raycasts stay cheap): built last by buildTopography, from the natural ground the other
  // ground classes left (lib/partition.mjs), so the Topography never lies under a road, a walkway or a marking.
  const surface = topographySurface(heightAt);
  const buildTopography = (claim) => {
    const topographyChildren = [];
    const d4NaturalChildren = [];
    let triangles = 0;
    for (let cz = EXTENT.minZ; cz < EXTENT.maxZ; cz += CHUNK) {
      for (let cx = EXTENT.minX; cx < EXTENT.maxX; cx += CHUNK) {
        const groups = new Map([
          ["outside", { data: new MeshData(), vertexOf: new Map(), material: groundMaterial, size: natural.tileSize }],
          ...[...d4Materials].map(([cls, tile]) => [cls, { data: new MeshData(), vertexOf: new Map(), ...tile }]),
        ]);
        const vertex = ([x, z], group) => {
          const { data, vertexOf, size } = group;
          const key = `${Math.round(x * 1e5)},${Math.round(z * 1e5)}`;
          let i = vertexOf.get(key);
          if (i === undefined) {
            i = data.vertex([x, surface.height(x, z), z], surface.normal(x, z), planarTileUv(x, z, size));
            vertexOf.set(key, i);
          }
          return i;
        };
        for (let z = cz; z < Math.min(cz + CHUNK, EXTENT.maxZ) - 1e-6; z += STEP) {
          for (let x = cx; x < Math.min(cx + CHUNK, EXTENT.maxX) - 1e-6; x += STEP) {
            const [x1, z1] = [Math.min(x + STEP, EXTENT.maxX), Math.min(z + STEP, EXTENT.maxZ)];
            // the two triangles of the cell, as topographySurface splits it (a c b and b c d)
            for (const tri of [[[x, z], [x, z1], [x1, z]], [[x1, z], [x, z1], [x1, z1]]]) {
              for (const part of claim(tri)) {
                const { inside, outside } = splitD4GroundPolygon(part);
                const pieces = outside.map(polygon => ({ polygon, cls: "outside" }));
                if (inside) {
                  // landcoverAt reads one class per scene-unit cell. Split at
                  // those same boundaries before assigning a tiled material.
                  let cells = [inside];
                  for (const [axis, origin] of [[0, EXTENT.minX], [1, EXTENT.minZ]]) {
                    const low = Math.min(...inside.map(p => p[axis]));
                    const high = Math.max(...inside.map(p => p[axis]));
                    for (let edge = origin + Math.floor(low - origin) + 1; edge < high; edge++) {
                      cells = cells.flatMap(polygon => {
                        const halves = splitByLine(polygon, p => p[axis] - edge);
                        return [halves.inside, halves.outside].filter(Boolean);
                      });
                    }
                  }
                  for (const polygon of cells) {
                    const centre = [0, 1].map(axis => polygon.reduce((sum, p) => sum + p[axis], 0) / polygon.length);
                    pieces.push({ polygon, cls: d4NaturalTile(landcoverAt(...centre)) });
                  }
                }
                for (const { polygon, cls } of pieces) {
                  const group = groups.get(cls);
                  for (let k = 1; k + 1 < polygon.length; k += 1) {
                    const tri = [vertex(polygon[0], group), vertex(polygon[k], group), vertex(polygon[k + 1], group)];
                    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
                    group.data.indices.push(...tri);
                    triangles += 1;
                  }
                }
              }
            }
          }
        }
        // Topography_* chunks hold exactly one primitive in the shared Ground material (pack.mjs joins them);
        // the D4 tiled natural ground gets its own Ground_D4Natural_* nodes instead.
        for (const [cls, group] of groups) {
          if (!group.data.indices.length) continue;
          const primitive = group.data.toPrimitive(group.material);
          const name = cls === "outside" ? `Topography_${topographyChildren.length}` : `Ground_D4Natural_${cls}_${d4NaturalChildren.length}`;
          const mesh = glb.addMesh(name, [primitive]);
          // GlbBuilder.addMesh writes TEXCOORD_0 only; the planar AO coordinate is added here.
          const uv1 = new Float32Array((primitive.positions.length / 3) * 2);
          for (let v = 0; v < uv1.length / 2; v += 1) {
            uv1[v * 2] = (primitive.positions[v * 3] - EXTENT.minX) / WIDTH;
            uv1[v * 2 + 1] = (primitive.positions[v * 3 + 2] - EXTENT.minZ) / DEPTH;
          }
          glb.json.meshes[mesh].primitives[0].attributes.TEXCOORD_1 = glb.addAccessor(uv1, "VEC2");
          (cls === "outside" ? topographyChildren : d4NaturalChildren).push(glb.addNode({ name, mesh }));
        }
      }
    }
    glb.addNode({ name: "Topography", children: topographyChildren, extras: { naturalGround: true, note: "natural ground only: roads, walkways, lots and markings are cut out of it (Ground_*, Road_Markings)" } }, { root: true });
    if (d4NaturalChildren.length) glb.addNode({ name: "Ground_D4Natural", children: d4NaturalChildren, extras: { naturalGround: true, scope: { buildingId: "BLD_D4" }, note: "D4 natural ground in tiled CC0 grass/soil materials (estimated), cut from the same partition as Topography" } }, { root: true });
    return { chunks: topographyChildren.length, triangles };
  };
  return {
    surfaces,
    layers: surfaces.layers,
    aoTexture,
    surface,
    buildTopography,
    groundInfo: { width, height, px: PX, labels, classes: SURFACE_CLASS },
  };
}


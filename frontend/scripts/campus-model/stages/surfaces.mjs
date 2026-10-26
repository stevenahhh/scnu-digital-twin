// Ground surface stage (plan uhf-ground-roads-routing todo 9): the class polygons of network/surfaces.mjs as decal
// meshes laid on the Topography triangles (lib/conform.mjs), one mesh per class, each lifted SURFACE_LIFT_M by its
// precedence (0.006 m per step, at most 0.036 m: below the road markings' 0.04 m) so the higher class covers the lower
// one without polygon booleans; CityModel adds a polygon offset by the material's extras.polygonOffsetRank.
//
// Materials are CC0 tiles from data/materials (fetch/groundMaterials.mjs, ground-materials.json: colour, OpenGL normal,
// ARM = occlusion/roughness/metal) on world-planar UVs: u = (E - E0) / physicalSizeM, v = (N0 - N) / physicalSizeM in
// EPSG:5186 metres with E0, N0 whole multiples of the tile size (so u equals E / size up to a whole number of repeats,
// which keeps the float32 UVs small). TEXCOORD_1 is planar over EXTENT for the ground AO (data/ao-ground.png), as on
// the Topography. Painted surfaces (sports, water, the roundabout) carry a per-surface texture painted by the shaders
// below at SPORTS_TEXEL_M (0.05 m; lines 0.10 m wide), with a faint noise normal map: these are smooth painted surfaces.
// The Topography itself is natural ground: a 0.5 m/texel lawn/soil/tree-floor colour map from the land cover
// (landcoverAt) on TEXCOORD_1 under the ground-grass relief tile on TEXCOORD_0. No photo pixel reaches any ground
// material. Every albedo and roughness here is an estimate (tile or palette), not a measurement.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ShapeUtils, Vector2 } from "three";
import { sceneToTm, tmToScene } from "../../../src/geo/epsg5186.mjs";
import { conform } from "../lib/conform.mjs";
import { EXTENT, SCENE_UNITS_PER_METRE } from "../lib/frame.mjs";
import { LANDCOVER } from "../lib/landcover.mjs";
import { encodePng } from "../lib/png.mjs";
import { hashNoise, smoothNoise } from "../lib/raster.mjs";
import { orientedFrame } from "../network/surfaces.mjs";
import { pavingPattern, pavingTile } from "../lib/pavingPatterns.mjs";

// Statute basis of the tactile paving tile (stages/tactile.mjs, bake/tactile-tile.mjs).
export const TACTILE_BASIS = "장애인등편의법 시행규칙 별표 1 제16호: 0.3 m 모듈, 36 돌출, 6±1 mm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MATERIALS = path.join(HERE, "..", "data", "materials");
const MANIFEST = path.join(MATERIALS, "ground-materials.json");
const UNIT = SCENE_UNITS_PER_METRE;
const WIDTH = EXTENT.maxX - EXTENT.minX;
const DEPTH = EXTENT.maxZ - EXTENT.minZ;

export const SURFACE_LIFT_M = (precedence) => Math.min(0.036, 0.006 * precedence);

// Mesh -> CC0 tile class (ground-materials.json `cls`). Each primitive's material carries its layers' precedence as
// extras.polygonOffsetRank (CityModel), so the polygon offset and the lift agree.
export const GROUND_MESHES = Object.freeze({
  Ground_Sports: {},
  Ground_Asphalt: { tile: "asphalt" },
  Ground_Lot: { tile: "lot" },
  // VR scenes a2-e5: light grey pavers with scattered dark squares (data/paving-patterns.json campus-speckle, 추정)
  Ground_Pavers: { pattern: "campus-speckle" },
  Ground_Bicycle: { tile: "asphalt-red" },
  // catalogue paving supplements: one primitive per pattern, laid along each supplement's axis (layer.pattern, uvFrame)
  Ground_Plaza: { patterned: true },
  Ground_Apron: { tile: "concrete" },
  // network/walkways.mjs: estimated walkway strips beside the carriageway where NGII A003 has no sidewalk (추정)
  Ground_Walkway: { pattern: "campus-speckle" },
  // stages/kerbs.mjs: the gutter band on the road side of the kerbs (asphalt darkened 0.72, estimated)
  Ground_Gutter: { tile: "asphalt", baseColorFactor: [0.72, 0.72, 0.72, 1] },
  // network/stalls.mjs: the circular-arc speed humps (buildHumpMeshes), asphalt
  Ground_Hump: { tile: "asphalt" },
  // stages/tactile.mjs: generated tactile tile (bake/tactile-tile.mjs), band-aligned UVs
  Ground_Tactile: { generated: "tactile" },
});
const MESH_ORDER = Object.keys(GROUND_MESHES);

// ---------------------------------------------------------------- UVs
const tileOrigin = (size) => [Math.floor(243000 / size) * size, Math.ceil(265000 / size) * size];
export function planarTileUv(x, z, size) {
  const [E, N] = sceneToTm(x, z);
  const [E0, N0] = tileOrigin(size);
  return [(E - E0) / size, (N0 - N) / size];
}
const extentUv = (x, z) => [(x - EXTENT.minX) / WIDTH, (z - EXTENT.minZ) / DEPTH];

// Local frame UVs of a painted surface texture (see paintedTexture).
const localOf = (frame, x, z) => {
  const dx = x - frame.cx;
  const dz = z - frame.cz;
  return [(dx * frame.ux + dz * frame.uz) / UNIT, (-dx * frame.uz + dz * frame.ux) / UNIT];
};

// ---------------------------------------------------------------- geometry
// Triangles (model units, [x, z]) of a polygon given as EPSG:5186 rings [outer, ...holes].
export function triangulate(rings) {
  const model = rings.map((ring) => ring.map(([E, N]) => tmToScene(E, N)));
  const contour = model[0].map(([x, z]) => new Vector2(x, z));
  const holes = model.slice(1).map((ring) => ring.map(([x, z]) => new Vector2(x, z)));
  if (ShapeUtils.isClockWise(contour)) contour.reverse();
  for (const hole of holes) if (!ShapeUtils.isClockWise(hole)) hole.reverse();
  const all = [...contour, ...holes.flat()];
  return ShapeUtils.triangulateShape(contour, holes).map((face) => face.map((k) => [all[k].x, all[k].y]));
}

// Splits a triangle (model units) into four until its longest edge is at most maxEdge wherever needsFine(point,
// reachModel) holds (the slab ramps of stages/kerbs.mjs vary within a terrain triangle).
function refineTriangle(tri, maxEdge, needsFine) {
  const longest = Math.max(...tri.map((p, i) => Math.hypot(tri[(i + 1) % 3][0] - p[0], tri[(i + 1) % 3][1] - p[1])));
  const centre = [(tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3];
  if (longest <= maxEdge || !needsFine(centre, longest)) return [tri];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const [a, b, c] = tri;
  const [ab, bc, ca] = [mid(a, b), mid(b, c), mid(c, a)];
  return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]].flatMap((t) => refineTriangle(t, maxEdge, needsFine));
}

// One primitive per mesh (per surface for the painted ones): conformed, lifted, upward triangles with planar tile UVs
// (or local texture UVs) and the planar EXTENT TEXCOORD_1. tileSize(mesh) -> metres; heightOffset(layer, x, z) ->
// metres above the terrain (default: the precedence lift); refine: { maxEdgeM, needsFine(layer, point, reachModel) }
// for layers whose height varies inside a terrain triangle (the raised walkway slab).
export function surfaceGeometry({ layers, surface, tileSize, heightOffset = (layer) => SURFACE_LIFT_M(layer.precedence), refine = null }) {
  const primitives = new Map();
  layers.forEach((layer, index) => {
    const spec = GROUND_MESHES[layer.mesh] ?? {};
    const painted = !spec.tile && !spec.generated && !spec.pattern && !spec.patterned;
    const pattern = spec.patterned ? layer.pattern : spec.pattern ?? null;
    if (spec.patterned && !pattern) throw new Error(`surfaces: ${layer.mesh} layer ${layer.source_ref} has no pattern`);
    // One primitive per class and precedence (its material carries that precedence as the polygon-offset rank, so the
    // offset never contradicts the lift), per catalogue pattern, and one per painted surface (its own texture).
    const key = painted ? `${layer.mesh}#${index}` : `${layer.mesh}@${layer.precedence}${spec.patterned ? `#${pattern}` : ""}`;
    let primitive = primitives.get(key);
    if (!primitive) {
      const frame = painted ? orientedFrame(layer.rings[0].map(([E, N]) => tmToScene(E, N))) : null;
      primitive = { mesh: layer.mesh, rank: layer.precedence, layer: painted ? layer : null, pattern, frame, positions: [], normals: [], uvs: [], uv1: [], indices: [], vertexOf: new Map(), sourceTriangles: 0, precedence: [] };
      primitives.set(key, primitive);
    }
    if (!primitive.precedence.includes(layer.precedence)) primitive.precedence.push(layer.precedence);
    const size = painted || layer.uvFrame ? null : tileSize(layer.mesh);
    // uvFrame: { origin, u, v (model units, unit vectors), sizeM }: one tile per sizeM along u and v (tactile bands)
    const frameUv = layer.uvFrame ? ([x, z]) => {
      const { origin, u, v, sizeM } = layer.uvFrame;
      const d = [x - origin[0], z - origin[1]];
      return [(d[0] * u[0] + d[1] * u[1]) / (sizeM * UNIT), (d[0] * v[0] + d[1] * v[1]) / (sizeM * UNIT)];
    } : null;
    const vertex = ([x, z]) => {
      const lift = heightOffset(layer, x, z);
      const k = `${Math.round(x * 1e5)},${Math.round(z * 1e5)},${Math.round(lift * 1e5)}${frameUv ? `#${index}` : ""}`;
      let i = primitive.vertexOf.get(k);
      if (i === undefined) {
        i = primitive.positions.length / 3;
        primitive.vertexOf.set(k, i);
        primitive.positions.push(x, surface.height(x, z) + lift * UNIT, z);
        primitive.normals.push(...surface.normal(x, z));
        primitive.uvs.push(...(painted ? primitive.frame.uv(x, z) : frameUv ? frameUv([x, z]) : planarTileUv(x, z, size)));
        primitive.uv1.push(...extentUv(x, z));
      }
      return i;
    };
    if (painted && !primitive.frame.uv) primitive.frame.uv = paintedUv(primitive.frame, layer);
    const fine = refine ? (tri) => refineTriangle(tri, refine.maxEdgeM * UNIT, (p, reach) => refine.needsFine(layer, p, reach)) : (tri) => [tri];
    for (const tri of triangulate(layer.rings).flatMap(fine)) {
      primitive.sourceTriangles += 1;
      for (const piece of conform(tri, surface)) {
        const cross = (piece[1][0] - piece[0][0]) * (piece[2][1] - piece[0][1]) - (piece[1][1] - piece[0][1]) * (piece[2][0] - piece[0][0]);
        if (Math.abs(cross) < 1e-10) continue;
        const ordered = cross < 0 ? piece : [piece[0], piece[2], piece[1]];
        primitive.indices.push(...ordered.map(vertex));
      }
    }
  });
  return [...primitives.values()].sort((a, b) => MESH_ORDER.indexOf(a.mesh) - MESH_ORDER.indexOf(b.mesh) || a.rank - b.rank);
}

// ---------------------------------------------------------------- painted surfaces (sports, water, roundabout, courtyard tiles)
const SPORTS_TEXEL_M = 0.05;
const PLAIN_TEXEL_M = 0.1;
const MAX_TEXTURE = 4000;
const LINE_HALF_WIDTH_M = 0.05;
const LINE_WHITE = [236, 236, 228];
const SURFACE = {
  track: [168, 84, 64],
  turf: [72, 124, 60],
  futsal: [52, 106, 66],
  basketball: [58, 116, 176],
  multiApron: [116, 178, 146],
  multiCourt: [168, 82, 68],
  clay: [176, 126, 94],
  // Orange-tan clay courts (F3 학생테니스장) as read in SCNU 360 VR scene_f3 (estimated).
  clayCourt: [200, 152, 104],
  tennisCourt: [126, 156, 112],
  lawn: [104, 148, 70],
  water: [58, 88, 100],
  fountain: [92, 132, 150],
  roundabout: [170, 76, 64],
  island: [90, 128, 70],
  paver: [196, 198, 194],
  paverJoint: [168, 170, 168],
  tileBlue: [102, 121, 138],
  tileTerracotta: [176, 98, 66],
};
// Courtyard tiles (VR scene_e8 f, NGII 2025 sheet): 0.5 m grey pavers, and in rows TILE_ROW_M apart a 0.6 m blue-grey
// square every TILE_PITCH_M, the rows staggered by half a pitch, each square with a 0.2 m terracotta centre (estimated).
const PAVER_M = 0.5;
const TILE_PITCH_M = 2.8;
const TILE_ROW_M = 2.6;
const TILE_HALF_M = 0.3;
const TILE_CENTRE_HALF_M = 0.1;
function tilesShader(own) {
  const wrap = (v, p) => v - p * Math.round(v / p);
  return (x, z, i, j) => {
    const [ls, lt] = localOf(own, x, z);
    const row = Math.round(lt / TILE_ROW_M);
    const ds = Math.abs(wrap(ls - (row % 2 ? TILE_PITCH_M / 2 : 0), TILE_PITCH_M));
    const dt = Math.abs(lt - row * TILE_ROW_M);
    if (ds <= TILE_CENTRE_HALF_M && dt <= TILE_CENTRE_HALF_M) return grain(SURFACE.tileTerracotta, i, j, 36, 0.06);
    if (ds <= TILE_HALF_M && dt <= TILE_HALF_M) return grain(SURFACE.tileBlue, i, j, 37, 0.06);
    const joint = Math.min(Math.abs(wrap(ls, PAVER_M)), Math.abs(wrap(lt, PAVER_M))) < 0.012;
    return grain(joint ? SURFACE.paverJoint : SURFACE.paver, i, j, 38, 0.07);
  };
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shadeBy = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const grain = (base, i, j, seed, amount = 0.08) => shadeBy(base, 1 - amount / 2 + hashNoise(i, j, seed) * amount);
// Distance (m) to the outline of a centred rectangle with half sizes hs x ht.
const rectOutline = (s, t, hs, ht) => {
  const dx = Math.abs(s) - hs;
  const dy = Math.abs(t) - ht;
  return dx <= 0 && dy <= 0 ? Math.min(-dx, -dy) : Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
};

const texelOf = (layer) => (["track", "labels", "pitch", "tiles"].includes(layer.paint?.kind) ? SPORTS_TEXEL_M : PLAIN_TEXEL_M);
function paintedUv(frame, layer) {
  const texel = Math.max(texelOf(layer), (2 * Math.max(frame.halfLength, frame.halfWidth) + 2) / MAX_TEXTURE);
  const s0 = -frame.halfLength - texel;
  const t0 = -frame.halfWidth - texel;
  const width = Math.ceil((2 * frame.halfLength + 2 * texel) / texel);
  const height = Math.ceil((2 * frame.halfWidth + 2 * texel) / texel);
  frame.texture = { texel, s0, t0, width, height };
  return (x, z) => {
    const [s, t] = localOf(frame, x, z);
    return [(s - s0) / (width * texel), (t - t0) / (height * texel)];
  };
}

// Running track fitted to the facility outline: semicircular ends, 8 lanes of 1.22 m with white lane lines and a
// football pitch with standard markings inside (dimensions of the old ground shader; estimated layout).
function trackShader(frame, cover) {
  const radius = frame.halfWidth;
  const straight = Math.max(0, frame.halfLength - radius);
  const band = 8 * 1.22;
  const inner = radius - band;
  const pitchHalfWidth = Math.min(34, inner - 2);
  const pitchHalfLength = Math.min(52.5, straight + Math.sqrt(Math.max(0, inner * inner - pitchHalfWidth * pitchHalfWidth)) - 1);
  return (s, t, i, j) => {
    const depth = radius - (Math.abs(s) <= straight ? Math.abs(t) : Math.hypot(Math.abs(s) - straight, t));
    if (depth < band + LINE_HALF_WIDTH_M) {
      const lane = depth / 1.22;
      return mix(grain(SURFACE.track, i, j, 21), LINE_WHITE, cover((lane - Math.round(lane)) * 1.22) * 0.85);
    }
    if (Math.abs(s) > pitchHalfLength + 0.5 || Math.abs(t) > pitchHalfWidth + 0.5) return grain(SURFACE.track, i, j, 21);
    const stripe = Math.floor((s + pitchHalfLength) / ((pitchHalfLength * 2) / 18)) % 2 ? 1.05 : 0.95;
    const turf = grain(shadeBy(SURFACE.turf, stripe), i, j, 22, 0.06);
    const boxS = Math.abs(s) - (pitchHalfLength - 8.25);
    const goalS = Math.abs(s) - (pitchHalfLength - 2.75);
    const d = Math.min(
      rectOutline(s, t, pitchHalfLength, pitchHalfWidth),
      Math.abs(t) <= pitchHalfWidth ? Math.abs(s) : Infinity,
      Math.abs(Math.hypot(s, t) - 9.15),
      rectOutline(boxS, t, 8.25, 20.16),
      rectOutline(goalS, t, 2.75, 9.16),
    );
    return mix(turf, LINE_WHITE, cover(d) * 0.85);
  };
}

// Court surfaces around a label point; (s, t) are metres in the label's own frame.
function courtShader(surfaceName, lines, cover) {
  switch (surfaceName) {
    case "basketball":
      return (s, t, i, j) => {
        const base = grain(SURFACE.basketball, i, j, 23, 0.05);
        if (lines === false) return base;
        const key = Math.abs(s) - (14 - 2.9);
        const d = Math.min(
          rectOutline(s, t, 14, 7.5),
          Math.abs(t) <= 7.5 ? Math.abs(s) : Infinity,
          Math.abs(Math.hypot(s, t) - 1.8),
          rectOutline(key, t, 2.9, 2.45),
          Math.abs(s) < 14 - 1.575 ? Math.abs(Math.hypot(Math.abs(s) - (14 - 1.575), t) - 6.75) : Infinity,
        );
        return mix(base, LINE_WHITE, cover(d) * 0.85);
      };
    case "futsal":
      return (s, t, i, j) => {
        const d = Math.min(rectOutline(s, t, 20, 10), Math.abs(t) <= 10 ? Math.abs(s) : Infinity, Math.abs(Math.hypot(s, t) - 3), Math.abs(Math.hypot(Math.abs(s) - 20, t) - 6));
        return mix(grain(SURFACE.futsal, i, j, 24, 0.06), LINE_WHITE, cover(d) * 0.8);
      };
    case "multi":
      return (s, t, i, j) => {
        const inside = Math.abs(s) <= 9 && Math.abs(t) <= 4.5;
        const base = grain(inside ? SURFACE.multiCourt : SURFACE.multiApron, i, j, 25, 0.05);
        return mix(base, LINE_WHITE, cover(Math.min(rectOutline(s, t, 9, 4.5), Math.abs(t) <= 4.5 ? Math.abs(s) : Infinity)) * 0.8);
      };
    case "tennis":
      return (s, t, i, j) => {
        let colour = grain(SURFACE.clay, i, j, 26, 0.08);
        for (const offset of [-8.2, 8.2]) {
          const tt = t - offset;
          if (Math.abs(s) <= 11.885 + 3 && Math.abs(tt) <= 5.485 + 2) colour = grain(SURFACE.tennisCourt, i, j, 27, 0.05);
          const d = Math.min(rectOutline(s, tt, 11.885, 5.485), rectOutline(s, tt, 11.885, 4.115), rectOutline(s, tt, 6.4, 4.115), Math.abs(tt) <= 4.115 && Math.abs(s) <= 6.4 ? Math.abs(tt) : Infinity, Math.abs(tt) <= 5.485 ? Math.abs(s) : Infinity);
          colour = mix(colour, LINE_WHITE, cover(d) * 0.8);
        }
        return colour;
      };
    case "lawn":
      return (s, t, i, j) => grain(SURFACE.lawn, i, j, 28, 0.1);
    default:
      throw new Error(`osm-ground.json: unknown surface ${surfaceName}`);
  }
}

// Colour (sRGB) at local (s, t) metres of a painted surface; i, j: texel indices for the grain.
function paintShader(layer, frame, texel) {
  const cover = (distance) => clamp01((LINE_HALF_WIDTH_M + texel / 2 - Math.abs(distance)) / texel);
  const toModel = (s, t) => [frame.cx + (frame.ux * s - frame.uz * t) * UNIT, frame.cz + (frame.uz * s + frame.ux * t) * UNIT];
  const paint = layer.paint;
  switch (paint.kind) {
    case "track":
      return trackShader(frame, cover);
    case "pitch": {
      const colour = paint.surface === "clay" ? SURFACE.clayCourt : paint.sport === "tennis" ? SURFACE.tennisCourt : paint.sport === "basketball" ? SURFACE.basketball : SURFACE.turf;
      return (s, t, i, j) => mix(grain(colour, i, j, 32, 0.06), LINE_WHITE, cover(rectOutline(s, t, frame.halfLength - 1, frame.halfWidth - 1)) * 0.8);
    }
    case "labels": {
      const shaders = paint.labels.map((label) => {
        const point = tmToScene(...label.point);
        const own = label.headingDegrees === undefined
          ? { ...frame, cx: point[0], cz: point[1] }
          : { cx: point[0], cz: point[1], ux: Math.cos((label.headingDegrees * Math.PI) / 180), uz: Math.sin((label.headingDegrees * Math.PI) / 180) };
        return { point, own, shade: courtShader(label.surface, label.lines, cover) };
      });
      return (s, t, i, j) => {
        const [x, z] = toModel(s, t);
        let nearest = shaders[0];
        for (const entry of shaders) {
          if (Math.hypot(entry.point[0] - x, entry.point[1] - z) < Math.hypot(nearest.point[0] - x, nearest.point[1] - z)) nearest = entry;
        }
        const [ls, lt] = localOf(nearest.own, x, z);
        return nearest.shade(ls, lt, i, j);
      };
    }
    case "water": {
      // tint: a pool's own water colour read from the VR (sRGB hex, estimated)
      const colour = paint.tint ? [1, 3, 5].map((k) => parseInt(paint.tint.slice(k, k + 2), 16)) : SURFACE.water;
      return (s, t, i, j) => grain(colour, i, j, 31, 0.06);
    }
    case "fountain":
      return (s, t, i, j) => grain(SURFACE.fountain, i, j, 33, 0.06);
    case "roundabout":
      return (s, t, i, j) => grain(SURFACE.roundabout, i, j, 34, 0.08);
    case "island":
      return (s, t, i, j) => grain(SURFACE.island, i, j, 35, 0.12);
    case "tiles": {
      const [a, b] = paint.axis.map(([E, N]) => tmToScene(E, N));
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const shade = tilesShader({ cx: a[0], cz: a[1], ux: (b[0] - a[0]) / length, uz: (b[1] - a[1]) / length });
      return (s, t, i, j) => shade(...toModel(s, t), i, j);
    }
    default:
      throw new Error(`surfaces: unknown paint kind ${paint.kind}`);
  }
}

function paintedTexture(primitive) {
  const { frame } = primitive;
  const { texel, s0, t0, width, height } = frame.texture;
  const shade = paintShader(primitive.layer, frame, texel);
  const rgb = new Uint8Array(width * height * 3);
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const c = shade(s0 + (i + 0.5) * texel, t0 + (j + 0.5) * texel, i, j);
      const k = (j * width + i) * 3;
      rgb[k] = Math.max(0, Math.min(255, c[0]));
      rgb[k + 1] = Math.max(0, Math.min(255, c[1]));
      rgb[k + 2] = Math.max(0, Math.min(255, c[2]));
    }
  }
  return { png: encodePng(width, height, 3, rgb), width, height, texel };
}

// Near-flat normal map for the painted surfaces (rubber, acrylic, water): faint value-noise relief (estimated look). A
// solid flat map would be pruned by the pack step's texture optimisation, leaving the material without a normal map.
function paintedNormalMap(size = 256) {
  const height = (x, y) => smoothNoise(((x % size) + size) % size, ((y % size) + size) % size, 8, 41) * 0.6 + hashNoise(x, y, 42) * 0.4;
  const rgb = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (height(x - 1, y) - height(x + 1, y)) * 0.15;
      const ny = (height(x, y + 1) - height(x, y - 1)) * 0.15;
      const length = Math.hypot(nx, ny, 1);
      rgb.set([Math.round((nx / length * 0.5 + 0.5) * 255), Math.round((ny / length * 0.5 + 0.5) * 255), Math.round((1 / length * 0.5 + 0.5) * 255)], (y * size + x) * 3);
    }
  }
  return encodePng(size, size, 3, rgb);
}

// ---------------------------------------------------------------- CC0 tiles
let manifest = null;
export function groundTile(cls) {
  manifest ??= JSON.parse(readFileSync(MANIFEST, "utf8"));
  const entry = manifest.materials.find((m) => m.cls === cls);
  if (!entry) throw new Error(`data/materials/ground-materials.json has no ${cls} tile`);
  const files = {};
  for (const map of ["col", "nor", "arm"]) {
    const file = path.join(MATERIALS, `ground-${cls}-${map}.webp`);
    if (!existsSync(file)) throw new Error(`ground material tile missing: data/materials/ground-${cls}-${map}.webp (run bun scripts/campus-model/fetch/groundMaterials.mjs)`);
    files[map] = file;
  }
  return { entry, files };
}

const pngOf = async (file) => new Bun.Image(readFileSync(file)).png().toBuffer();

// Texture indices of one tile class (added once per GLB).
const tileCache = new WeakMap();
export async function tileTextures(glb, cls) {
  let byClass = tileCache.get(glb);
  if (!byClass) tileCache.set(glb, (byClass = new Map()));
  if (!byClass.has(cls)) {
    const { entry, files } = groundTile(cls);
    const [col, nor, arm] = await Promise.all(["col", "nor", "arm"].map((map) => pngOf(files[map])));
    byClass.set(cls, {
      entry,
      col: glb.addTexture(col, "image/png"),
      nor: glb.addTexture(nor, "image/png"),
      arm: glb.addTexture(arm, "image/png"),
    });
  }
  return byClass.get(cls);
}

export async function tileMaterial(glb, { name, cls, rank, ao = null, baseColorFactor = null, extras = {} }) {
  const tile = await tileTextures(glb, cls);
  return glb.addMaterial({
    name,
    pbrMetallicRoughness: {
      baseColorTexture: { index: tile.col },
      ...(baseColorFactor ? { baseColorFactor } : {}),
      metallicRoughnessTexture: { index: tile.arm },
      metallicFactor: 1,
      roughnessFactor: 1,
    },
    normalTexture: { index: tile.nor },
    ...(ao !== null ? { occlusionTexture: { index: ao, texCoord: 1 } } : {}),
    extras: {
      estimated: true,
      polygonOffsetRank: rank,
      tile: `${tile.entry.provider} ${tile.entry.asset} (${tile.entry.licence})`,
      physicalSizeM: tile.entry.physicalSizeM,
      note: "albedo, relief and roughness from a CC0 tile: estimated, not measured",
      ...extras,
    },
  });
}

// Paving pattern material (lib/pavingPatterns.mjs): colour and joint relief tiles drawn from the VR-read catalogue; the
// textures are shared by every primitive of the pattern.
const patternCache = new WeakMap();
async function patternMaterial(glb, { name, id, rank, ao }) {
  let byId = patternCache.get(glb);
  if (!byId) patternCache.set(glb, (byId = new Map()));
  if (!byId.has(id)) {
    const tile = pavingTile(id);
    byId.set(id, { tile, col: glb.addTexture(tile.colour, "image/png"), nor: glb.addTexture(tile.normal, "image/png") });
  }
  const { tile, col, nor } = byId.get(id);
  const p = pavingPattern(id);
  return glb.addMaterial({
    name,
    pbrMetallicRoughness: { baseColorTexture: { index: col }, metallicFactor: 0, roughnessFactor: 0.82 },
    normalTexture: { index: nor },
    ...(ao !== null ? { occlusionTexture: { index: ao, texCoord: 1 } } : {}),
    extras: { estimated: true, polygonOffsetRank: rank, paving: id, label: `${p.label} (추정)`, repeatM: tile.repeatM, source: p.source, note: "pattern, module size and colours read from the SCNU 360 VR tour: estimated, not measured; no photo pixels" },
  });
}

// Tactile paving material from the generated tile (bake/tactile-tile.mjs).
async function tactileMaterial(glb, { rank, ao }) {
  const textures = {};
  for (const map of ["col", "nor"]) {
    const file = path.join(MATERIALS, `ground-tactile-${map}.webp`);
    if (!existsSync(file)) throw new Error(`tactile tile missing: data/materials/ground-tactile-${map}.webp (run bun scripts/campus-model/bake/tactile-tile.mjs)`);
    textures[map] = glb.addTexture(await pngOf(file), "image/png");
  }
  return glb.addMaterial({
    name: "Ground_Tactile",
    pbrMetallicRoughness: { baseColorTexture: { index: textures.col }, metallicFactor: 0, roughnessFactor: 0.6 },
    normalTexture: { index: textures.nor },
    ...(ao !== null ? { occlusionTexture: { index: ao, texCoord: 1 } } : {}),
    extras: { estimated: true, polygonOffsetRank: rank, basis: TACTILE_BASIS, note: "placement and guidance length estimated; generated tile" },
  });
}

// ---------------------------------------------------------------- natural Topography ground
// Land-cover colours (estimated albedo), blended bilinearly between the 1-unit land-cover cells with a little noise,
// at NATURAL_TEXEL_M: the colour map of the Topography's Ground material.
const NATURAL_TEXEL_M = 0.5;
const NATURAL_PALETTE = {
  [LANDCOVER.PAVED]: [158, 156, 148],
  [LANDCOVER.GRASS]: [112, 150, 74],
  [LANDCOVER.TREE]: [86, 98, 58],
  [LANDCOVER.SOIL]: [150, 126, 96],
  [LANDCOVER.TRACK]: [178, 84, 66],
  [LANDCOVER.COURT]: [62, 112, 168],
};
export const GRASS_TILE = "grass";

export async function naturalGroundMaterial(glb, landcoverAt, ao) {
  const perUnit = 1 / (NATURAL_TEXEL_M * UNIT);
  const width = Math.ceil(WIDTH * perUnit);
  const height = Math.ceil(DEPTH * perUnit);
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const fx = (x + 0.5) / perUnit - 0.5;
      const fy = (y + 0.5) / perUnit - 0.5;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const colourAt = (cx, cy) => NATURAL_PALETTE[landcoverAt(EXTENT.minX + cx + 0.5, EXTENT.minZ + cy + 0.5)];
      const c00 = colourAt(ix, iy);
      const c10 = colourAt(ix + 1, iy);
      const c01 = colourAt(ix, iy + 1);
      const c11 = colourAt(ix + 1, iy + 1);
      const k = 0.92 + smoothNoise(x, y, 6, 1) * 0.1 + hashNoise(x, y, 2) * 0.04;
      const i = (y * width + x) * 3;
      for (let ch = 0; ch < 3; ch += 1) {
        const v = (c00[ch] * (1 - tx) + c10[ch] * tx) * (1 - ty) + (c01[ch] * (1 - tx) + c11[ch] * tx) * ty;
        rgb[i + ch] = Math.max(0, Math.min(255, v * k));
      }
    }
  }
  const colour = glb.addTexture(encodePng(width, height, 3, rgb), "image/png", { repeat: false });
  const grass = await tileTextures(glb, GRASS_TILE);
  const material = glb.addMaterial({
    name: "Ground",
    pbrMetallicRoughness: {
      baseColorTexture: { index: colour, texCoord: 1 },
      metallicRoughnessTexture: { index: grass.arm },
      metallicFactor: 0,
      roughnessFactor: 1,
    },
    normalTexture: { index: grass.nor },
    ...(ao !== null ? { occlusionTexture: { index: ao, texCoord: 1 } } : {}),
    extras: {
      estimated: true,
      colour: `land cover (data/landcover.png) palette at ${NATURAL_TEXEL_M} m/texel on TEXCOORD_1, no photo pixels`,
      relief: `${grass.entry.provider} ${grass.entry.asset} (${grass.entry.licence}) normal/ARM on TEXCOORD_0, ${grass.entry.physicalSizeM} m repeat`,
    },
  });
  return { material, width, height, tileSize: grass.entry.physicalSizeM };
}

// ---------------------------------------------------------------- stage
// layers: network/surfaces.mjs layers; surface: topographySurface(); ao: the ground AO texture index or null.
export async function buildSurfaceMeshes({ glb, layers, surface, ao = null, heightOffset, refine = null }) {
  const tileSize = (mesh) => (GROUND_MESHES[mesh].pattern ? pavingPattern(GROUND_MESHES[mesh].pattern).repeatM : groundTile(GROUND_MESHES[mesh].tile).entry.physicalSizeM);
  const primitives = surfaceGeometry({ layers, surface, tileSize, heightOffset, refine });
  const paintedNormal = glb.addTexture(paintedNormalMap(), "image/png");
  const materials = new Map();
  const byMesh = new Map();
  for (const primitive of primitives) {
    if (!primitive.indices.length) continue;
    const { mesh } = primitive;
    let material;
    if (GROUND_MESHES[mesh].generated === "tactile") {
      if (!materials.has(mesh)) materials.set(mesh, await tactileMaterial(glb, { rank: primitive.rank, ao }));
      material = materials.get(mesh);
    } else if (primitive.pattern) {
      const key = `${primitive.pattern}@${primitive.rank}`;
      if (!materials.has(key)) materials.set(key, await patternMaterial(glb, { name: mesh, id: primitive.pattern, rank: primitive.rank, ao }));
      material = materials.get(key);
    } else if (GROUND_MESHES[mesh].tile) {
      const key = `${mesh}@${primitive.rank}`;
      if (!materials.has(key)) materials.set(key, await tileMaterial(glb, { name: mesh, cls: GROUND_MESHES[mesh].tile, rank: primitive.rank, ao, baseColorFactor: GROUND_MESHES[mesh].baseColorFactor ?? null }));
      material = materials.get(key);
    } else {
      const texture = paintedTexture(primitive);
      material = glb.addMaterial({
        name: mesh,
        pbrMetallicRoughness: { baseColorTexture: { index: glb.addTexture(texture.png, "image/png", { repeat: false }) }, metallicFactor: 0, roughnessFactor: 0.8 },
        normalTexture: { index: paintedNormal },
        ...(ao !== null ? { occlusionTexture: { index: ao, texCoord: 1 } } : {}),
        extras: {
          estimated: true,
          polygonOffsetRank: primitive.rank,
          paint: primitive.layer.paint.kind,
          texelM: Number(texture.texel.toFixed(4)),
          source: primitive.layer.source,
          sourceRef: primitive.layer.source_ref,
          note: "painted surface layout and colours are estimates (near-smooth surface: faint noise normal map)",
        },
      });
    }
    if (!byMesh.has(mesh)) byMesh.set(mesh, { primitives: [], triangles: 0, layers: 0, precedence: new Set() });
    const entry = byMesh.get(mesh);
    entry.triangles += primitive.indices.length / 3;
    primitive.precedence.forEach((p) => entry.precedence.add(p));
    entry.primitives.push({
      positions: Float32Array.from(primitive.positions),
      normals: Float32Array.from(primitive.normals),
      uvs: Float32Array.from(primitive.uvs),
      uv1: Float32Array.from(primitive.uv1),
      indices: primitive.indices,
      material,
    });
  }
  const counts = {};
  for (const layer of layers) counts[layer.mesh] = (counts[layer.mesh] ?? 0) + 1;
  const stats = [];
  for (const mesh of MESH_ORDER) {
    const entry = byMesh.get(mesh);
    if (!entry) continue;
    const index = glb.addMesh(mesh, entry.primitives);
    glb.json.meshes[index].primitives.forEach((p, k) => {
      p.attributes.TEXCOORD_1 = glb.addAccessor(entry.primitives[k].uv1, "VEC2");
    });
    const note = mesh === "Ground_Walkway" ? { note: "추정 보행로: estimated 1.5 m walkway strips where no NGII A003 sidewalk exists (network/walkways.mjs), not surveyed" } : {};
    glb.addNode({ name: mesh, mesh: index, extras: { groundLayers: counts[mesh], precedence: [...entry.precedence].sort((a, b) => a - b), estimated: true, ...note } }, { root: true });
    stats.push({ mesh, triangles: entry.triangles, layers: counts[mesh], primitives: entry.primitives.length });
  }
  return stats;
}

export const describeSurfaces = (stats) => `surfaces: ${stats.map((s) => `${s.mesh} ${s.triangles} tri`).join(", ")} ` +
  `(${stats.map((s) => `${s.mesh} ${s.layers} polygons${s.primitives > 1 ? ` / ${s.primitives} primitives` : ""}`).join(", ")}); CC0 tiles, no photo pixels`;

// ---------------------------------------------------------------- speed humps
// One Ground_Hump node per hump of network/stalls.mjs: the arc h(s) over HUMP_LENGTH_M across the hump width, on the
// asphalt (just above its lift), with closed ends; asphalt tile on world-planar UVs. Dimensions are estimates.
export async function buildHumpMeshes({ glb, humps, surface, ao = null, profile, lengthM }) {
  if (!humps.length) return 0;
  const cls = GROUND_MESHES.Ground_Hump.tile;
  const size = groundTile(cls).entry.physicalSizeM;
  const material = await tileMaterial(glb, { name: "Ground_Hump", cls, rank: 3.6, ao, extras: { profile: `circular arc ${lengthM} m x ${profile(0)} m (estimated)` } });
  const base = SURFACE_LIFT_M(3) + 0.001;
  const STEP_S = 0.2;
  const STEP_T = 0.5;
  for (const hump of humps) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const uv1 = [];
    const indices = [];
    const ns = Math.round(lengthM / STEP_S);
    const nt = Math.max(1, Math.ceil(hump.widthM / STEP_T));
    const point = (sM, tM) => [hump.centre[0] + hump.u[0] * sM * UNIT + hump.v[0] * tM * UNIT, hump.centre[1] + hump.u[1] * sM * UNIT + hump.v[1] * tM * UNIT];
    const push = ([x, z], yM, normal) => {
      positions.push(x, surface.height(x, z) + yM * UNIT, z);
      normals.push(...normal);
      uvs.push(...planarTileUv(x, z, size));
      uv1.push(...extentUv(x, z));
      return positions.length / 3 - 1;
    };
    const grid = [];
    for (let i = 0; i <= ns; i += 1) {
      const sM = -lengthM / 2 + (i * lengthM) / ns;
      const slope = (profile(sM + 0.01) - profile(sM - 0.01)) / 0.02;
      const n = [-slope * hump.u[0], 1, -slope * hump.u[1]];
      const l = Math.hypot(...n);
      const row = [];
      for (let j = 0; j <= nt; j += 1) row.push(push(point(sM, -hump.widthM / 2 + (j * hump.widthM) / nt), base + profile(sM), n.map((c) => c / l)));
      grid.push(row);
    }
    for (let i = 0; i < ns; i += 1) {
      for (let j = 0; j < nt; j += 1) {
        const [a, b, c, d] = [grid[i][j], grid[i + 1][j], grid[i][j + 1], grid[i + 1][j + 1]];
        // upward faces: (x, z) cross product negative
        const ax = positions[a * 3], az = positions[a * 3 + 2];
        const cross = (positions[b * 3] - ax) * (positions[c * 3 + 2] - az) - (positions[b * 3 + 2] - az) * (positions[c * 3] - ax);
        if (cross < 0) indices.push(a, b, c, c, b, d);
        else indices.push(a, c, b, c, d, b);
      }
    }
    // closed ends at t = +-width / 2
    for (const [j, side] of [[0, -1], [nt, 1]]) {
      const outward = [hump.v[0] * side, 0, hump.v[1] * side];
      for (let i = 0; i < ns; i += 1) {
        const p0 = point(-lengthM / 2 + (i * lengthM) / ns, side * hump.widthM / 2);
        const p1 = point(-lengthM / 2 + ((i + 1) * lengthM) / ns, side * hump.widthM / 2);
        const s0 = -lengthM / 2 + (i * lengthM) / ns;
        const s1 = s0 + lengthM / ns;
        const q = [push(p0, base, outward), push(p1, base, outward), push(p1, base + profile(s1), outward), push(p0, base + profile(s0), outward)];
        // counter-clockwise seen from outside: the face normal (p1 - p0) x (p3 - p0) points outward
        const P = (k) => [positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]];
        const [v0, v1, v3] = [P(q[0]), P(q[1]), P(q[3])];
        const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
        const e2 = [v3[0] - v0[0], v3[1] - v0[1], v3[2] - v0[2]];
        const nrm = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (nrm[0] * outward[0] + nrm[2] * outward[2] > 0) indices.push(q[0], q[1], q[2], q[0], q[2], q[3]);
        else indices.push(q[0], q[2], q[1], q[0], q[3], q[2]);
      }
    }
    const mesh = glb.addMesh(`Ground_Hump_${hump.id}`, [{ positions: Float32Array.from(positions), normals: Float32Array.from(normals), uvs: Float32Array.from(uvs), indices, material }]);
    glb.json.meshes[mesh].primitives[0].attributes.TEXCOORD_1 = glb.addAccessor(Float32Array.from(uv1), "VEC2");
    glb.addNode({ name: `Ground_Hump_${hump.id}`, mesh, extras: { estimated: true, lengthM, heightM: profile(0), widthM: Number(hump.widthM.toFixed(2)), source: `data/photo/markings-extra.geojson ${hump.id}` } }, { root: true });
  }
  return humps.length;
}

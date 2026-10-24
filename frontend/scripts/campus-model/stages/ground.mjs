// Ground stage: paint the land-cover texture (walkways, roads, off-campus lots, building curbs),
// emit the chunked Topography terrain and the crosswalk stripes.
import { EXTENT, metres } from "../lib/frame.mjs";
import { LANDCOVER } from "../lib/landcover.mjs";
import { MeshData } from "../lib/meshData.mjs";
import { encodePng } from "../lib/png.mjs";
import { Raster, hashNoise, smoothNoise } from "../lib/raster.mjs";
import { ringArea } from "../lib/geometry.mjs";

const WIDTH = EXTENT.maxX - EXTENT.minX;
const DEPTH = EXTENT.maxZ - EXTENT.minZ;

const PX = 4; // texture pixels per scene unit
const STEP = 2;
const CHUNK = 42;

const jpeg = async (png, quality = 86) => new Bun.Image(png).jpeg({ quality }).toBuffer();

export async function buildGround({ glb, inputs, selectableBuildings, campusBuildings, offCampusLots, markingMaterial }) {
  const { heightAt, walkways, roadZones, crosswalks, landcoverAt } = inputs;

  // ---- ground texture
  const ground = new Raster(WIDTH * PX, DEPTH * PX);
  const toPixel = ([x, z]) => [(x - EXTENT.minX) * PX, (z - EXTENT.minZ) * PX];
  const PALETTE = {
    [LANDCOVER.PAVED]: [158, 156, 148],
    [LANDCOVER.GRASS]: [112, 150, 74],
    [LANDCOVER.TREE]: [74, 106, 52],
    [LANDCOVER.SOIL]: [170, 140, 102],
    [LANDCOVER.TRACK]: [178, 84, 66],
    [LANDCOVER.COURT]: [62, 112, 168],
  };
  for (let y = 0; y < ground.height; y += 1) {
    for (let x = 0; x < ground.width; x += 1) {
      // bilinear blend of the four nearest class colours softens the 1-unit class grid
      const fx = x / PX - 0.5;
      const fy = y / PX - 0.5;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const colourAt = (cx, cy) => PALETTE[landcoverAt(EXTENT.minX + cx + 0.5, EXTENT.minZ + cy + 0.5)];
      const c00 = colourAt(ix, iy);
      const c10 = colourAt(ix + 1, iy);
      const c01 = colourAt(ix, iy + 1);
      const c11 = colourAt(ix + 1, iy + 1);
      const k = 0.9 + smoothNoise(x, y, 14, 1) * 0.12 + hashNoise(x, y, 2) * 0.05;
      const i = (y * ground.width + x) * 3;
      for (let ch = 0; ch < 3; ch += 1) {
        const v = (c00[ch] * (1 - tx) + c10[ch] * tx) * (1 - ty) + (c01[ch] * (1 - tx) + c11[ch] * tx) * ty;
        ground.data[i + ch] = Math.max(0, Math.min(255, v * k));
      }
    }
  }
  const paving = (x, y) => {
    const joint = x % 6 === 0 || y % 6 === 0;
    const k = 0.95 + hashNoise(Math.floor(x / 6), Math.floor(y / 6), 3) * 0.08 - (joint ? 0.06 : 0);
    return [200 * k, 194 * k, 182 * k];
  };
  const asphalt = (x, y) => {
    const k = 0.9 + hashNoise(x, y, 4) * 0.12 + smoothNoise(x, y, 40, 5) * 0.06;
    return [70 * k, 73 * k, 77 * k];
  };
  for (const line of walkways) ground.strokePolyline(line.map(toPixel), metres(3) * PX, () => [164, 160, 150]);
  for (const line of walkways) ground.strokePolyline(line.map(toPixel), metres(2.4) * PX, paving);
  for (const polygon of roadZones) ground.fillPolygon(polygon.map((ring) => ring.map(toPixel)), asphalt);
  for (const polygon of roadZones) {
    for (const ring of polygon) ground.strokePolyline([...ring, ring[0]].map(toPixel), metres(0.35) * PX, () => [176, 174, 166]);
  }
  for (const lot of offCampusLots) {
    ground.fillPolygon([lot.map(toPixel)], (x, y) => {
      const k = 0.94 + hashNoise(x, y, 6) * 0.08;
      return [150 * k, 148 * k, 141 * k];
    });
  }
  for (const building of [...selectableBuildings, ...campusBuildings]) {
    for (const part of building.parts) {
      ground.strokePolyline([...part.outer, part.outer[0]].map(toPixel), metres(2.2) * PX, () => [182, 178, 170]);
    }
  }
  const groundTexture = glb.addTexture(await jpeg(encodePng(ground.width, ground.height, 3, ground.data), 84), "image/jpeg", { repeat: false });
  const groundMaterial = glb.addMaterial({
    name: "Ground",
    pbrMetallicRoughness: { baseColorTexture: { index: groundTexture }, metallicFactor: 0, roughnessFactor: 1 },
  });

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
          data.vertex([x, heightAt(x, z), z], [nx / length, 2 / length, nz / length], [(x - EXTENT.minX) / WIDTH, (z - EXTENT.minZ) / DEPTH]);
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
      const mesh = glb.addMesh(name, [data.toPrimitive(groundMaterial)]);
      topographyChildren.push(glb.addNode({ name, mesh }));
    }
  }
  glb.addNode({ name: "Topography", children: topographyChildren }, { root: true });

  // ---- crosswalk stripes
  {
    const stripes = new MeshData({ uvs: false });
    const lift = metres(0.08);
    for (const ring of crosswalks) {
      if (ring.length < 4) continue;
      const [p0, p1, p2] = ring;
      const e0 = [p1[0] - p0[0], p1[1] - p0[1]];
      const e1 = [p2[0] - p1[0], p2[1] - p1[1]];
      // stripes run along the short side (traffic direction) and repeat along the long side
      const [along, across, origin] = Math.hypot(...e0) >= Math.hypot(...e1) ? [e0, e1, p0] : [e1, [-e0[0], -e0[1]], p1];
      const length = Math.hypot(...along);
      const ux = along[0] / length;
      const uz = along[1] / length;
      const stripe = metres(0.5);
      for (let s = metres(0.25); s + stripe <= length; s += metres(1)) {
        const a = [origin[0] + ux * s, origin[1] + uz * s];
        const b = [a[0] + ux * stripe, a[1] + uz * stripe];
        const corners = [a, b, [b[0] + across[0], b[1] + across[1]], [a[0] + across[0], a[1] + across[1]]];
        const area = ringArea(corners);
        const ordered = area > 0 ? corners : [...corners].reverse();
        const base = stripes.vertexCount;
        ordered.forEach(([x, z]) => stripes.vertex([x, heightAt(x, z) + lift, z], [0, 1, 0]));
        stripes.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
    const mesh = glb.addMesh("Crosswalks", [stripes.toPrimitive(markingMaterial)]);
    glb.addNode({ name: "Crosswalks", mesh }, { root: true });
  }
}

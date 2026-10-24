// Building stage: match uni.glb's BLD_* nodes to VWorld footprints, pick campus/off-campus
// buildings, build their facade/roof materials and meshes, and emit the nodes.
import { metres } from "../lib/frame.mjs";
import { MeshData } from "../lib/meshData.mjs";
import { mulberry32 } from "../lib/raster.mjs";
import { FACADE_BAYS, FACADE_FLOORS, beigePunchedFacade, brickPunchedFacade, concreteRibbonFacade, glassCurtainFacade, greenhouseFacade, roofTexture } from "../lib/textures.mjs";
import { pointInRing, ringArea, ringCentroid, segmentDistance } from "../lib/geometry.mjs";
import { meshFootprint, toModelRing } from "./sources.mjs";

export const STYLE = Object.freeze({ CONCRETE: "concrete", BRICK: "brick", BEIGE: "beige", GLASS: "glass", GREENHOUSE: "greenhouse" });
const UNIT_AREA = metres(1) ** 2;
const BAY = metres(3.6);
const PARAPET = metres(0.9);

const jpeg = async (png, quality = 86) => new Bun.Image(png).jpeg({ quality }).toBuffer();

export const heightOf = (part) => {
  const fromFloors = part.floors > 0 ? part.floors * 3.5 + 0.8 : 0;
  return Math.max(part.heightMetres || 0, fromFloors, 3.5);
};

export function styleFor(name, fallback, seed) {
  if (/온실/.test(name)) return STYLE.GREENHOUSE;
  if (fallback) return fallback;
  if (/체육관|공급실|창고|공장/.test(name)) return STYLE.CONCRETE;
  return [STYLE.CONCRETE, STYLE.BEIGE, STYLE.BRICK, STYLE.GLASS, STYLE.CONCRETE][seed % 5];
}

const isGroundFeature = (part) => part.areaMetres > 8000 && part.floors <= 1;

// ---------------------------------------------------------------- geometry
function addWalls(mesh, ring, outward, base, ground, top, floorHeight) {
  const area = ringArea(ring);
  // A ring that is counter-clockwise in (x, z) has its interior on the left; walls face right.
  const ordered = (area > 0) === outward ? [...ring].reverse() : ring;
  let distance = 0;
  const v = (y) => -(y - ground) / (floorHeight * FACADE_FLOORS);
  for (let i = 0; i < ordered.length; i += 1) {
    const a = ordered[i];
    const b = ordered[(i + 1) % ordered.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u0 = distance / (BAY * FACADE_BAYS);
    const u1 = (distance + length) / (BAY * FACADE_BAYS);
    distance += length;
    mesh.quad(
      [a[0], base, a[1]],
      [b[0], base, b[1]],
      [b[0], top, b[1]],
      [a[0], top, a[1]],
      [[u0, v(base)], [u1, v(base)], [u1, v(top)], [u0, v(top)]],
    );
  }
}

function addBox(mesh, cx, cz, sx, sz, y0, y1, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corner = (dx, dz) => [cx + dx * cos - dz * sin, cz + dx * sin + dz * cos];
  const ring = [corner(-sx / 2, -sz / 2), corner(sx / 2, -sz / 2), corner(sx / 2, sz / 2), corner(-sx / 2, sz / 2)];
  addWalls(mesh, ring, true, y0, y0, y1, 1);
  mesh.horizontalPolygon(ring, [], y1);
}

function dominantAngle(ring) {
  let best = 0;
  let angle = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length > best) {
      best = length;
      angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  return angle;
}

function minEdgeDistance(point, rings) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) best = Math.min(best, segmentDistance(point, ring[i], ring[(i + 1) % ring.length]));
  }
  return best;
}

function buildingPrimitives(building, seed, { heightAt, facadeMaterials, roofMaterial, parapetMaterial, equipmentMaterial }) {
  const walls = new MeshData();
  const roof = new MeshData();
  const parapet = new MeshData({ uvs: false });
  const equipment = new MeshData({ uvs: false });
  const rng = mulberry32(seed);
  for (const part of building.parts) {
    if (!part.outer || part.outer.length < 3) continue;
    const samples = [...part.outer, ringCentroid(part.outer)].map(([x, z]) => heightAt(x, z));
    const ground = Math.min(...samples);
    const base = ground - metres(1.5);
    const height = metres(part.heightMetres);
    const top = ground + height;
    const floors = Math.max(1, part.floors || Math.round(part.heightMetres / 3.6));
    const floorHeight = Math.min(metres(5), Math.max(metres(3), height / floors));
    addWalls(walls, part.outer, true, base, ground, top, floorHeight);
    part.holes.forEach((hole) => addWalls(walls, hole, false, base, ground, top, floorHeight));
    roof.horizontalPolygon(part.outer, part.holes, top, { uvScale: 1 / metres(10) });
    if (building.style !== STYLE.GREENHOUSE) {
      for (const ring of [part.outer, ...part.holes]) {
        addWalls(parapet, ring, true, top, top, top + PARAPET, 1);
        addWalls(parapet, ring, false, top, top, top + PARAPET, 1);
      }
      const areaMetres = Math.abs(ringArea(part.outer)) / UNIT_AREA;
      const units = areaMetres > 300 ? Math.min(6, 1 + Math.floor(areaMetres / 700)) : 0;
      const angle = dominantAngle(part.outer);
      const xs = part.outer.map((p) => p[0]);
      const zs = part.outer.map((p) => p[1]);
      for (let placed = 0, tries = 0; placed < units && tries < 80; tries += 1) {
        const sx = metres(2.5 + rng() * 4);
        const sz = metres(2 + rng() * 3);
        const cx = Math.min(...xs) + rng() * (Math.max(...xs) - Math.min(...xs));
        const cz = Math.min(...zs) + rng() * (Math.max(...zs) - Math.min(...zs));
        if (!pointInRing([cx, cz], part.outer) || part.holes.some((h) => pointInRing([cx, cz], h))) continue;
        if (minEdgeDistance([cx, cz], [part.outer, ...part.holes]) < Math.hypot(sx, sz) / 2 + metres(1.2)) continue;
        addBox(equipment, cx, cz, sx, sz, top, top + metres(1.4 + rng() * 1.6), angle);
        placed += 1;
      }
    }
  }
  return [
    walls.toPrimitive(facadeMaterials[building.style]),
    roof.toPrimitive(roofMaterial),
    parapet.toPrimitive(parapetMaterial),
    equipment.toPrimitive(equipmentMaterial),
  ];
}

// ---------------------------------------------------------------- stage
export async function buildBuildings({ glb, inputs }) {
  const { source, vworld, roadZones, heightAt } = inputs;

  // ---- building selection
  const vworldParts = vworld.map((b, index) => {
    const [outer, ...holes] = b.polygons[0].map(toModelRing);
    return {
      index,
      name: b.name,
      floors: b.floors,
      heightMetres: b.heightMetres,
      outer,
      holes,
      centroid: ringCentroid(outer),
      areaMetres: Math.abs(ringArea(outer)) / UNIT_AREA,
    };
  });

  const used = new Set();
  const selectableBuildings = [];

  source.scene.children.forEach((object, index) => {
    const rawName = source.rawNames[index];
    if (!object.isMesh || !rawName.startsWith("BLD_")) return;
    const footprint = meshFootprint(object);
    const materialName = [].concat(object.material)[0]?.name ?? "";
    const fallbackStyle = /Brick/.test(materialName) ? STYLE.BRICK : /Glass/.test(materialName) ? STYLE.GREENHOUSE : null;
    const matches = vworldParts.filter((part) => !isGroundFeature(part) && pointInRing(part.centroid, footprint.outer));
    matches.forEach((part) => used.add(part.index));
    const oldArea = Math.abs(ringArea(footprint.outer)) / UNIT_AREA;
    const matchedArea = matches.reduce((sum, part) => sum + part.areaMetres, 0);
    const sourceHeight = (footprint.topY - footprint.minY) / metres(1);
    const name = matches.map((part) => part.name).find(Boolean) ?? "";
    // BLD_D4 anchors the traffic frame through its bounding box, so it keeps the original outline.
    const keepOutline = rawName === "BLD_D4" || matches.length === 0 || matchedArea < oldArea * 0.8;
    const parts = keepOutline
      ? [{
        outer: footprint.outer,
        holes: footprint.holes,
        heightMetres: matches.length ? Math.max(...matches.map(heightOf)) : Math.max(sourceHeight, 3.5),
        floors: matches.length ? Math.max(...matches.map((m) => m.floors)) : Math.round(sourceHeight / 3.6),
      }]
      : matches.map((part) => ({ outer: part.outer, holes: part.holes, heightMetres: heightOf(part), floors: part.floors }));
    selectableBuildings.push({
      nodeName: rawName,
      displayName: name,
      style: styleFor(name, fallbackStyle, index),
      parts,
    });
  });

  // Campus area: inside the hull of known campus buildings and close to a campus road zone.
  const campusPoints = [
    ...selectableBuildings.flatMap((b) => b.parts.map((p) => ringCentroid(p.outer))),
    ...vworldParts.filter((p) => /순천대/.test(p.name)).map((p) => p.centroid),
  ];
  const campusHull = (() => {
    const pts = [...campusPoints].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (const p of pts.reverse()) {
      while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
      upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  })();
  const distanceToRoads = (point) => {
    let best = Infinity;
    for (const polygon of roadZones) {
      if (pointInRing(point, polygon[0])) return 0;
      const ring = polygon[0];
      for (let i = 0; i < ring.length; i += 1) best = Math.min(best, segmentDistance(point, ring[i], ring[(i + 1) % ring.length]));
    }
    return best;
  };

  const campusBuildings = [];
  // Off-campus buildings are not modelled; their lots are painted as plain ground and kept free of trees.
  const offCampusLots = [];
  for (const part of vworldParts) {
    if (used.has(part.index) || isGroundFeature(part)) continue;
    const named = /순천대/.test(part.name);
    if (part.areaMetres < 12 || (!named && !(pointInRing(part.centroid, campusHull) && distanceToRoads(part.centroid) < metres(14)))) {
      offCampusLots.push(part.outer);
      continue;
    }
    campusBuildings.push({
      displayName: part.name,
      style: styleFor(part.name, null, part.index),
      parts: [{ outer: part.outer, holes: part.holes, heightMetres: heightOf(part), floors: part.floors }],
    });
  }

  // ---- materials
  const facadeSources = {
    [STYLE.CONCRETE]: concreteRibbonFacade(),
    [STYLE.BRICK]: brickPunchedFacade(),
    [STYLE.BEIGE]: beigePunchedFacade(),
    [STYLE.GLASS]: glassCurtainFacade(),
    [STYLE.GREENHOUSE]: greenhouseFacade(),
  };
  const facadeMaterials = {};
  for (const [style, textures] of Object.entries(facadeSources)) {
    const color = glb.addTexture(await jpeg(textures.color), "image/jpeg");
    const emissive = glb.addTexture(await jpeg(textures.emissive, 80), "image/jpeg");
    facadeMaterials[style] = glb.addMaterial({
      name: `Facade_${style}`,
      pbrMetallicRoughness: {
        baseColorTexture: { index: color },
        metallicFactor: style === STYLE.GLASS ? 0.25 : 0,
        roughnessFactor: style === STYLE.GLASS ? 0.45 : 0.85,
      },
      emissiveTexture: { index: emissive },
      emissiveFactor: [1, 1, 1],
    });
  }
  const roofMaterial = glb.addMaterial({
    name: "Roof_Membrane",
    pbrMetallicRoughness: { baseColorTexture: { index: glb.addTexture(await jpeg(roofTexture()), "image/jpeg") }, metallicFactor: 0, roughnessFactor: 0.95 },
  });
  const parapetMaterial = glb.addMaterial({
    name: "Roof_Parapet",
    pbrMetallicRoughness: { baseColorFactor: [0.78, 0.77, 0.74, 1], metallicFactor: 0, roughnessFactor: 0.9 },
    doubleSided: true,
  });
  const equipmentMaterial = glb.addMaterial({
    name: "Roof_Equipment",
    pbrMetallicRoughness: { baseColorFactor: [0.6, 0.63, 0.66, 1], metallicFactor: 0.4, roughnessFactor: 0.6 },
  });
  const markingMaterial = glb.addMaterial({
    name: "Road_Marking",
    pbrMetallicRoughness: { baseColorFactor: [0.93, 0.93, 0.9, 1], metallicFactor: 0, roughnessFactor: 0.7 },
  });

  // ---- meshes and nodes
  const primitivesContext = { heightAt, facadeMaterials, roofMaterial, parapetMaterial, equipmentMaterial };
  selectableBuildings.forEach((building, index) => {
    const mesh = glb.addMesh(building.nodeName, buildingPrimitives(building, 1000 + index, primitivesContext));
    glb.addNode({ name: building.nodeName, mesh, extras: { displayName: building.displayName, source: "VWorld LT_C_BLDGINFO" } }, { root: true });
  });

  {
    const merged = new Map();
    campusBuildings.forEach((building, index) => {
      buildingPrimitives(building, 5000 + index, primitivesContext).forEach((primitive) => {
        if (!merged.has(primitive.material)) merged.set(primitive.material, new MeshData({ uvs: Boolean(primitive.uvs) }));
        const target = merged.get(primitive.material);
        target.append({ positions: primitive.positions, normals: primitive.normals, uvs: primitive.uvs, indices: primitive.indices });
      });
    });
    const mesh = glb.addMesh("CampusBuildings", [...merged].map(([material, data]) => data.toPrimitive(material)));
    glb.addNode({ name: "CampusBuildings", mesh, extras: { buildings: campusBuildings.map((b) => b.displayName).filter(Boolean) } }, { root: true });
  }

  return { selectableBuildings, campusBuildings, offCampusLots, markingMaterial };
}

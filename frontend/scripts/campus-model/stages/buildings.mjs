// Building stage: match uni.glb's BLD_* nodes to the footprints in data/gis-buildings.json, pick
// campus/off-campus buildings, build their facade/roof materials and meshes, and emit the nodes.
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

// Storey heights: medians of height/floors over the building register records in the campus bbox,
// 4.39 m for SCNU buildings (n = 26) and 3.76 m for all buildings (n = 153).
const SCNU_STOREY = 4.4;
const STOREY = 3.8;
const MIN_HEIGHT = 3.5;
const SCNU_NAME = /^순천대학교/;

// Roof-slab height in metres (the 0.9 m parapet is added on top as geometry, see PARAPET) and where it
// came from, or null when the record has neither a height nor a floor count. A source height is used
// when it gives 2.5-6.5 m per storey (or when floors are unknown); otherwise floors x storey height.
export function heightOf(part, isSCNU) {
  const floors = part.floors || 0;
  const height = part.heightMetres || 0;
  if (height > 0 && (!floors || (height / floors >= 2.5 && height / floors <= 6.5))) {
    return { heightMetres: Math.max(height, MIN_HEIGHT), heightSource: "source height" };
  }
  if (floors > 0) {
    const storey = isSCNU ? SCNU_STOREY : STOREY;
    return { heightMetres: Math.max(floors * storey, MIN_HEIGHT), heightSource: `estimated: ${floors} floors x ${storey} m` };
  }
  return null;
}

// Campus buildings with neither a height nor a floor count anywhere: an assumed storey count by type
// (dormitories are mid-rise, other SCNU buildings low-rise) instead of a one-storey shed.
function assumedHeight(name, isSCNU) {
  const floors = /생활관|기숙사|관사/.test(name) ? 6 : isSCNU ? 3 : 1;
  const storey = isSCNU ? SCNU_STOREY : STOREY;
  return { heightMetres: Math.max(floors * storey, MIN_HEIGHT), heightSource: `assumed: ${floors} floors x ${storey} m (no floor data)` };
}

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
  const { source, footprints, roadZones, heightAt } = inputs;

  // ---- building selection
  const footprintParts = footprints.flatMap((b, index) => b.polygons.map((polygon) => {
    const [outer, ...holes] = polygon.map(toModelRing);
    return {
      index,
      name: b.name,
      floors: b.floors,
      heightMetres: b.heightMetres,
      footprintSource: b.footprintSource,
      floorsSource: b.floorsSource,
      outer,
      holes,
      centroid: ringCentroid(outer),
      areaMetres: Math.abs(ringArea(outer)) / UNIT_AREA,
    };
  }));

  const bldNodes = source.scene.children.flatMap((object, index) => {
    const rawName = source.rawNames[index];
    return object.isMesh && rawName.startsWith("BLD_") ? [{ object, index, rawName, footprint: meshFootprint(object) }] : [];
  });
  // A footprint belongs to an outline when its centroid lies inside it, or (for U- and L-shaped
  // buildings whose centroid falls outside the outline itself) within 5 m of the outline's centroid.
  const matchesIn = (outline) => {
    const [cx, cz] = ringCentroid(outline);
    return footprintParts.filter((part) => !isGroundFeature(part) &&
      (pointInRing(part.centroid, outline) || Math.hypot(part.centroid[0] - cx, part.centroid[1] - cz) < metres(5)));
  };
  const areaOf = (ring) => Math.abs(ringArea(ring)) / UNIT_AREA;
  // An outline is replaced only when the source footprints cover the uni.glb outline to within 15 %.
  const areaAgrees = (matches, outline) => {
    const ratio = matches.reduce((sum, part) => sum + part.areaMetres, 0) / areaOf(outline);
    return ratio >= 0.85 && ratio <= 1.15;
  };

  // Footprints traced from imagery (OSM) sit a few metres off the cadastral frame uni.glb uses. The
  // median centroid offset over one-to-one matches of similar area moves them onto uni.glb (and onto
  // the roads); for cadastral footprints it comes out close to zero.
  {
    const deltas = bldNodes.flatMap(({ footprint }) => {
      const matches = matchesIn(footprint.outer);
      if (matches.length !== 1 || !areaAgrees(matches, footprint.outer)) return [];
      const [cx, cz] = ringCentroid(footprint.outer);
      return [[cx - matches[0].centroid[0], cz - matches[0].centroid[1]]];
    });
    const median = (values) => values.sort((a, b) => a - b)[values.length >> 1];
    const [dx, dz] = deltas.length >= 5 ? [median(deltas.map((d) => d[0])), median(deltas.map((d) => d[1]))] : [0, 0];
    const move = (ring) => ring.map(([x, z]) => [x + dx, z + dz]);
    for (const part of footprintParts) {
      part.outer = move(part.outer);
      part.holes = part.holes.map(move);
      part.centroid = ringCentroid(part.outer);
    }
    console.log(`footprint shift onto uni.glb: ${(dx / metres(1)).toFixed(2)} m east, ${(-dz / metres(1)).toFixed(2)} m north (median of ${deltas.length} matches)`);
  }

  const used = new Set();
  const selectableBuildings = [];
  const heightLog = [];

  for (const { object, index, rawName, footprint } of bldNodes) {
    const materialName = [].concat(object.material)[0]?.name ?? "";
    const fallbackStyle = /Brick/.test(materialName) ? STYLE.BRICK : /Glass/.test(materialName) ? STYLE.GREENHOUSE : null;
    const inside = matchesIn(footprint.outer);
    // No footprint centred inside the outline: take floors from one whose outline contains its centre.
    const outlineCentre = ringCentroid(footprint.outer);
    const matches = inside.length ? inside : footprintParts.filter((part) => !isGroundFeature(part) && pointInRing(outlineCentre, part.outer));
    matches.forEach((part) => used.add(part.index));
    const sourceHeight = (footprint.topY - footprint.minY) / metres(1);
    const kept = { heightMetres: Math.max(sourceHeight, MIN_HEIGHT), heightSource: "uni.glb outline height" };
    const name = matches.map((part) => part.name).find(Boolean) ?? "";
    // BLD_D4 anchors the traffic frame through its bounding box, so it keeps the original outline.
    const keepOutline = rawName === "BLD_D4" || !inside.length || !areaAgrees(inside, footprint.outer);
    const heights = matches.map((part) => heightOf(part, true)).filter(Boolean);
    const parts = keepOutline
      ? [{
        outer: footprint.outer,
        holes: footprint.holes,
        ...(heights.length ? heights.reduce((a, b) => (b.heightMetres > a.heightMetres ? b : a)) : kept),
        floors: Math.max(0, ...matches.map((m) => m.floors || 0)) || Math.round(sourceHeight / 3.6),
      }]
      : matches.map((part) => ({ outer: part.outer, holes: part.holes, ...(heightOf(part, true) ?? kept), floors: part.floors }));
    const footprintSource = keepOutline ? "uni.glb outline" : [...new Set(matches.map((m) => m.footprintSource))].join(", ");
    const floorsSource = [...new Set(matches.map((m) => m.floorsSource).filter((s) => s && s !== "none"))].join(", ") || "none";
    heightLog.push({ label: rawName, footprintSource, floorsSource, heightSource: parts[0].heightSource, heightMetres: parts[0].heightMetres });
    selectableBuildings.push({
      nodeName: rawName,
      displayName: name,
      style: styleFor(name, fallbackStyle, index),
      footprintSource,
      floorsSource,
      heightSource: parts[0].heightSource,
      parts,
    });
  }

  // Campus area: inside the hull of known campus buildings and close to a campus road zone.
  const campusPoints = [
    ...selectableBuildings.flatMap((b) => b.parts.map((p) => ringCentroid(p.outer))),
    ...footprintParts.filter((p) => /순천대/.test(p.name)).map((p) => p.centroid),
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
  for (const part of footprintParts) {
    if (used.has(part.index) || isGroundFeature(part)) continue;
    const named = /순천대/.test(part.name);
    if (part.areaMetres < 12 || (!named && !(pointInRing(part.centroid, campusHull) && distanceToRoads(part.centroid) < metres(14)))) {
      offCampusLots.push(part.outer);
      continue;
    }
    const isSCNU = SCNU_NAME.test(part.name) || bldNodes.some(({ footprint }) => part.outer.some((p) => pointInRing(p, footprint.outer)));
    const height = heightOf(part, isSCNU) ?? assumedHeight(part.name, isSCNU);
    heightLog.push({ label: part.name || "(unnamed)", footprintSource: part.footprintSource, floorsSource: part.floorsSource, ...height });
    campusBuildings.push({
      displayName: part.name,
      style: styleFor(part.name, null, part.index),
      parts: [{ outer: part.outer, holes: part.holes, ...height, floors: part.floors }],
    });
  }

  for (const entry of heightLog) {
    console.log(`building ${entry.label}: footprint ${entry.footprintSource}; floors ${entry.floorsSource}; height ${entry.heightMetres.toFixed(1)} m (${entry.heightSource})`);
  }
  const bySource = Object.groupBy(heightLog, (entry) => entry.heightSource.replace(/: .*/, ""));
  console.log(`height sources: ${Object.entries(bySource).map(([key, list]) => `${key} ${list.length}`).join(", ")}; ` +
    `floor rule used for ${(bySource.estimated ?? []).length} buildings: ${(bySource.estimated ?? []).map((e) => e.label).join(", ")}`);

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
    glb.addNode({
      name: building.nodeName,
      mesh,
      extras: {
        displayName: building.displayName,
        source: building.footprintSource,
        floorsSource: building.floorsSource,
        heightSource: building.heightSource,
      },
    }, { root: true });
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

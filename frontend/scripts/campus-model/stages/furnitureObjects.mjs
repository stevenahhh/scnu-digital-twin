// Furniture objects as editable nodes. stages/furniture.mjs draws every object into merged per-material meshes in a
// scratch GlbBuilder; this stage recovers each vertex's owner from what that build records and hands the geometry to
// lib/objectNodes.mjs, which emits one node per object. stages/furniture.mjs is left untouched on purpose: its source
// text is part of the transform hash behind every free-standing anchor's sourceInput (data/free-standing-anchors.json).
// Owners:
//   Furniture, Furniture_Glass, Furniture_Water  the per-vertex _OBJECT_ID (extras.renderObjectIds); 0 marks the
//                                                wheel stops, drawn one equal box each in parking order
//   Furniture_Screen                             4 vertices per LED screen, in the order of the node's extras.screens
//   glow kit (Lamp_Head)                         the traffic-signal lenses, 4 vertices per lens in extras.signals
//                                                order (2 lenses on a pedestrian post, 8 on an arm signal); the lamp
//                                                heads that stages/lights.mjs adds next are tagged there
// Every node's extras say what is estimated: positions as surveyed or placed, shapes, sizes and heights estimated (추정).
import { metres } from "../lib/frame.mjs";
import { MeshData } from "../lib/meshData.mjs";
import { ObjectTags } from "../lib/objectNodes.mjs";

const LAYERS = [["Furniture", "solid"], ["Furniture_Glass", "glass"], ["Furniture_Water", "water"], ["Furniture_Screen", "screen"]];
const LENS_VERTICES = 4;
const lensesOf = (signal) => (signal[1] === "pedestrian-post" ? 2 : 8);
const TEXTURE_SLOTS = ["baseColorTexture", "metallicRoughnessTexture"];
const MATERIAL_TEXTURE_SLOTS = ["emissiveTexture", "normalTexture", "occlusionTexture"];

const categoryOf = (kind) => (kind.startsWith("street_lamp") ? "lamp" : kind === "traffic_signal_pole" ? "signal" : kind === "wheel_stop" ? "wheel_stop" : "furniture");
const meta = (kind, positionNote, extras = {}) => ({
  kind,
  category: categoryOf(kind),
  extras: { estimated: true, estimateNote: `${positionNote}; shape, size and height estimated (추정), not measured`, ...extras },
});

// Copies a scratch material (and the textures it uses) into glb; returns its new index.
function copyMaterial(glb, scratch, index) {
  const material = structuredClone(scratch.json.materials[index]);
  const copyTexture = (ref) => {
    const texture = scratch.json.textures[ref.index];
    const image = scratch.json.images[texture.source];
    ref.index = glb.addTexture(scratch.readBufferView(image.bufferView), image.mimeType, { repeat: texture.sampler === 0 });
  };
  for (const slot of TEXTURE_SLOTS) if (material.pbrMetallicRoughness?.[slot]) copyTexture(material.pbrMetallicRoughness[slot]);
  for (const slot of MATERIAL_TEXTURE_SLOTS) if (material[slot]) copyTexture(material[slot]);
  return glb.addMaterial(material);
}

// The scratch primitive as a MeshData plus its _OBJECT_ID array (or null).
function readPrimitive(scratch, primitive) {
  const { POSITION, NORMAL, TEXCOORD_0, COLOR_0, _OBJECT_ID } = primitive.attributes;
  const mesh = new MeshData({ uvs: TEXCOORD_0 !== undefined, colors: COLOR_0 !== undefined });
  mesh.positions = Array.from(scratch.readAccessor(POSITION));
  mesh.normals = Array.from(scratch.readAccessor(NORMAL));
  if (mesh.uvs) mesh.uvs = Array.from(scratch.readAccessor(TEXCOORD_0));
  if (mesh.colors) mesh.colors = Array.from(scratch.readAccessor(COLOR_0));
  mesh.indices = Array.from(scratch.readAccessor(primitive.indices));
  return { mesh, ids: _OBJECT_ID === undefined ? null : scratch.readAccessor(_OBJECT_ID) };
}

function centroidXZ(positions, from, to) {
  let x = 0;
  let z = 0;
  for (let v = from; v < to; v += 1) {
    x += positions[v * 3];
    z += positions[v * 3 + 2];
  }
  return [x / (to - from), z / (to - from)];
}

// scratch: the GlbBuilder buildFurniture() wrote into; glow: the glow kit it returned (signal lenses so far).
// Returns { objects: ObjectTags (layers solid, glass, water, screen, glow), objectNumbers: id -> _OBJECT_ID }.
export function furnitureObjects({ glb, scratch, furniture, lamps, wheelStops, glow }) {
  const nodes = new Map(scratch.json.nodes.map((node) => [node.name, node]));
  for (const name of nodes.keys()) if (!LAYERS.some(([layer]) => layer === name)) throw new Error(`furnitureObjects: unexpected scratch node ${name}`);
  const extras = nodes.get("Furniture").extras;
  const objectNumbers = new Map(Object.entries(extras.renderObjectIds));
  const idOf = new Map([...objectNumbers].map(([id, number]) => [number, id]));
  const objects = new ObjectTags();

  // registration order = drawing order: built objects, then wheel stops, then lamps (buildFurniture's order)
  const byId = new Map(furniture.objects.map((o) => [o.id, o]));
  for (const [id, kind] of extras.objects) {
    const o = byId.get(id);
    const placed = o.estimated === true || o.source === "rest-spaces" || o.source === "site-detail";
    objects.register(id, meta(kind, placed ? `position estimated (${o.source})` : "position from the NGII 2025 orthophoto survey"));
  }
  const stopIds = wheelStops.map((stop) => `WS_${stop.id.replaceAll("/", "_")}`);
  wheelStops.forEach((stop, k) => {
    objectNumbers.set(stopIds[k], objectNumbers.size + 1);
    objects.register(stopIds[k], meta("wheel_stop", `position from the stall row ${stop.record} of data/parking.json${stop.estimated ? " (estimated)" : ""}`, { parkingRecord: stop.record }));
  });
  for (const lamp of lamps) {
    if (!objectNumbers.has(lamp.id)) throw new Error(`furnitureObjects: lamp ${lamp.id} has no _OBJECT_ID (not a furniture object)`);
    objects.register(lamp.id, meta(`street_lamp/${lamp.type}`, `position at the photo pole base (${lamp.pole.verdict})`));
  }

  const screens = nodes.get("Furniture_Screen")?.extras.screens ?? [];
  for (const [name, layerName] of LAYERS) {
    const node = nodes.get(name);
    // an empty kit gets no mesh (GlbBuilder.addMesh returns null)
    if (!node || node.mesh === null) continue;
    const [primitive, ...rest] = scratch.json.meshes[node.mesh].primitives;
    if (rest.length) throw new Error(`furnitureObjects: ${name} has ${rest.length + 1} primitives, expected 1`);
    const { mesh, ids } = readPrimitive(scratch, primitive);
    const layer = objects.addLayer(layerName, mesh, copyMaterial(glb, scratch, primitive.material));
    if (layerName === "screen") {
      if (mesh.vertexCount !== screens.length * 4) throw new Error(`furnitureObjects: ${mesh.vertexCount} screen vertices for ${screens.length} screens`);
      for (const [id] of screens) layer.owners.push(id, id, id, id);
      continue;
    }
    const stops = [];
    ids.forEach((number, v) => {
      if (number === 0) stops.push(v);
      else if (!idOf.has(number)) throw new Error(`furnitureObjects: ${name} vertex ${v} has the unknown _OBJECT_ID ${number}`);
      layer.owners.push(number === 0 ? null : idOf.get(number));
    });
    if (!stops.length) continue;
    // the wheel stops: one contiguous block of equal boxes, in parking order
    const size = stops.length / wheelStops.length;
    if (layerName !== "solid" || !Number.isInteger(size) || stops.at(-1) - stops[0] + 1 !== stops.length) {
      throw new Error(`furnitureObjects: ${stops.length} untagged ${name} vertices are not ${wheelStops.length} wheel-stop boxes`);
    }
    wheelStops.forEach((stop, k) => {
      const from = stops[0] + k * size;
      const [x, z] = centroidXZ(mesh.positions, from, from + size);
      if (Math.hypot(x - stop.centre[0], z - stop.centre[1]) > metres(0.5)) throw new Error(`furnitureObjects: wheel stop ${stop.id} box is not at its centre`);
      layer.owners.fill(stopIds[k], from, from + size);
    });
  }
  for (const extension of scratch.extensionsUsed) glb.extensionsUsed.add(extension);

  // the signal lenses already in the glow kit, checked against the signal's own solid geometry
  const glowLayer = objects.addLayer("glow", glow.mesh);
  const lensVertices = extras.signals.reduce((sum, signal) => sum + lensesOf(signal) * LENS_VERTICES, 0);
  if (glow.mesh.vertexCount !== lensVertices) throw new Error(`furnitureObjects: ${glow.mesh.vertexCount} glow vertices, the signals draw ${lensVertices}`);
  const solid = objects.layer("solid");
  for (const signal of extras.signals) {
    const from = glowLayer.owners.length;
    const count = lensesOf(signal) * LENS_VERTICES;
    const [x, z] = centroidXZ(glow.mesh.positions, from, from + count);
    let near = Infinity;
    solid.owners.forEach((owner, v) => {
      if (owner === signal[0]) near = Math.min(near, Math.hypot(solid.mesh.positions[v * 3] - x, solid.mesh.positions[v * 3 + 2] - z));
    });
    if (!(near < metres(1.5))) throw new Error(`furnitureObjects: the lenses of signal ${signal[0]} are not on its arm (${near} units away)`);
    for (let k = 0; k < count; k += 1) glowLayer.owners.push(signal[0]);
  }

  glb.addNode({
    name: "Furniture",
    extras: {
      ...extras,
      renderObjectIds: Object.fromEntries(objectNumbers),
      ...(screens.length ? { screens, screensNote: nodes.get("Furniture_Screen").extras.note } : {}),
      objectNodesNote: "every outdoor object, street lamp, traffic signal and wheel stop is its own node Furniture/<kind>/<id> (extras.editable, stages/furnitureObjects.mjs); this collection node holds no geometry",
    },
  // the Furniture collection node itself (lib/glb.mjs groupRoots), so packing's prune keeps it
  }, { collectionNode: "Furniture" });
  return { objects, objectNumbers };
}

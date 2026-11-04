// Check the exposed doorway in the locally generated, meshopt-compressed GLB, not its source grid.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { wallCoordinates } from "../lib/anchors.mjs";
import { sceneToTm } from "../../../src/geo/epsg5186.mjs";

export function connectedTrianglePatch(faces, seeds) {
  const edges = new Map();
  const faceEdges = faces.map((face, index) => [0, 1, 2].map(k => {
    const key = [face.keys[k], face.keys[(k + 1) % 3]].sort().join("|");
    const touching = edges.get(key) ?? [];
    touching.push(index); edges.set(key, touching);
    return key;
  }));
  const connected = new Set(seeds), queue = [...seeds];
  for (let i = 0; i < queue.length; i++) {
    for (const edge of faceEdges[queue[i]]) for (const next of edges.get(edge)) {
      if (!connected.has(next)) { connected.add(next); queue.push(next); }
    }
  }
  return connected;
}

export async function inspectDoor(model) {
  const { loadTmFootprints } = await import("../lib/footprints.mjs");
  const entry = JSON.parse(readFileSync(new URL("../data/buildings/entrances.json", import.meta.url), "utf8"))
    .records.find(r => r.id === "SD-E5-C1");
  const wall = (await loadTmFootprints())[entry.anchor.building].walls.find(w => w.wall === entry.anchor.wall);
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const document = await io.read(model);
  const node = document.getRoot().listNodes().find(n => n.getName() === entry.anchor.building);
  const matrix = node.getWorldMatrix();
  const right = entry.anchor.sM + entry.widthM / 2;
  const faces = [];
  let leftBoundaryVertices = 0;
  for (const primitive of node.getMesh().listPrimitives().filter(p => p.getMaterial().getName() === "Facade_Atlas")) {
    const positions = primitive.getAttribute("POSITION"), indices = primitive.getIndices(), uvs = primitive.getAttribute("TEXCOORD_0");
    const vertex = index => {
      const [x, y, z] = positions.getElement(index, []);
      const point = [
        matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
      ];
      // Equal position alone is not enough: adjoining blank-wall tiles are not doorway pieces.
      const key = [...point, ...uvs.getElement(index, [])].map(v => Math.round(v * 1e5)).join(",");
      return { ...wallCoordinates(sceneToTm(point[0], point[2]), wall), y: point[1], key };
    };
    for (let i = 0; i < indices.getCount(); i += 3) {
      const triangle = [0, 1, 2].map(k => vertex(indices.getScalar(i + k)));
      leftBoundaryVertices += triangle.filter(p => Math.abs(p.tM) < 0.3 &&
        Math.abs(p.sM - (entry.anchor.sM - entry.widthM / 2)) < 0.02).length;
      const left = Math.min(...triangle.map(p => p.sM)), end = Math.max(...triangle.map(p => p.sM));
      // The right edge is unique to this anchored doorway, unlike the repeated upper bays.
      // 2 cm is only a mesh-quantisation matching allowance; the centre criterion stays 0.3 m.
      if (triangle.every(p => Math.abs(p.tM) < 0.3)) faces.push({
        left, right: end, keys: triangle.map(p => p.key),
        seed: Math.abs(end - right) < 0.02 && left < entry.anchor.sM && end > entry.anchor.sM,
      });
    }
  }
  // Exposure splits one physical door into several quads. Join only their shared, UV-continuous
  // edges, so a missing fragment or a neighbouring wall cannot make the centre test pass.
  const patch = [...connectedTrianglePatch(faces, faces.flatMap((f, i) => f.seed ? [i] : []))].map(i => faces[i]);
  const leftM = patch.length ? Math.min(...patch.map(f => f.left)) : null;
  const rightM = patch.length ? Math.max(...patch.map(f => f.right)) : null;
  const centreM = leftM === null ? null : (leftM + rightM) / 2;
  const deltaSM = centreM === null ? null : Math.abs(centreM - entry.anchor.sM);
  return {
    id: entry.id, building: entry.anchor.building, wall: entry.anchor.wall,
    canopySM: entry.anchor.sM, leftM, rightM, centreM, deltaSM, leftBoundaryVertices,
    pass: deltaSM !== null && deltaSM <= 0.3,
  };
}

if (import.meta.main) {
  const arg = process.argv.indexOf("--model");
  const model = arg >= 0 ? process.argv[arg + 1] : fileURLToPath(new URL("../../../public/campus-v2.glb", import.meta.url));
  const report = await inspectDoor(model);
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
}

// One editable glTF node per outdoor object. The stages draw every object into a few shared kits (one MeshData per
// material); ObjectTags records which object owns each vertex as it is drawn, and emitObjectNodes splits the kits by
// owner into one node per object: named by its id, one mesh (same name) with one primitive per material it uses, its
// vertices relative to a base pivot (bbox centre x/z, bbox minimum y) held in the node's translation, so an editor can
// move, rotate and scale it about its foot. Each node carries extras.editable = { id, kind, category } and sits in the
// Furniture/<kind with "/" as "_"> collection (lib/glb.mjs groupRoots).
import { MeshData } from "./meshData.mjs";

export class ObjectTags {
  constructor() {
    this.layers = [];
    // id -> { kind, category, extras }, in the order the objects were drawn
    this.objects = new Map();
  }

  // material: glTF material index of the layer (setMaterial when it is created later).
  addLayer(name, mesh, material = null) {
    const layer = { name, mesh, material, owners: [] };
    this.layers.push(layer);
    return layer;
  }

  layer(name) {
    return this.layers.find((layer) => layer.name === name);
  }

  setMaterial(name, material) {
    this.layer(name).material = material;
  }

  // Records an object (emission follows the order of first registration).
  register(id, meta) {
    if (!this.objects.has(id)) this.objects.set(id, meta);
  }

  // Every vertex added to any layer since the previous tag belongs to `id` (null: to no object).
  tag(id, meta) {
    for (const layer of this.layers) while (layer.owners.length < layer.mesh.vertexCount) layer.owners.push(id);
    if (id !== null && meta) this.register(id, meta);
  }
}

// Map owner -> compact MeshData of the owner's triangles (first-seen order). Throws on a triangle shared by two owners.
export function splitByOwner(mesh, owners) {
  const parts = new Map();
  const remap = new Map();
  const { positions, normals, uvs, colors, indices } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    const owner = owners[a];
    if (owners[b] !== owner || owners[c] !== owner) throw new Error(`splitByOwner: triangle ${t / 3} has mixed owners ${owners[a]}, ${owners[b]}, ${owners[c]}`);
    if (!parts.has(owner)) {
      parts.set(owner, new MeshData({ uvs: uvs !== null, colors: colors !== null }));
      remap.set(owner, new Map());
    }
    const part = parts.get(owner);
    const local = remap.get(owner);
    for (const v of [a, b, c]) {
      if (!local.has(v)) {
        local.set(v, part.vertexCount);
        part.positions.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
        part.normals.push(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
        if (uvs) part.uvs.push(uvs[v * 2], uvs[v * 2 + 1]);
        if (colors) part.colors.push(colors[v * 4], colors[v * 4 + 1], colors[v * 4 + 2], colors[v * 4 + 3]);
      }
      part.indices.push(local.get(v));
    }
  }
  return parts;
}

// [bbox centre x, bbox min y, bbox centre z] over the positions of every mesh.
export function pivotOf(meshes) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      for (let k = 0; k < 3; k += 1) {
        if (mesh.positions[i + k] < min[k]) min[k] = mesh.positions[i + k];
        if (mesh.positions[i + k] > max[k]) max[k] = mesh.positions[i + k];
      }
    }
  }
  return [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
}

// Positions relative to the pivot, in place.
export function rebase(mesh, pivot) {
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let k = 0; k < 3; k += 1) mesh.positions[i + k] -= pivot[k];
  }
  return mesh;
}

export const kindGroup = (kind) => kind.replaceAll("/", "_");

// objectNumbers: id -> the u16 written as a constant _OBJECT_ID per vertex (the packed-render masks of
// scripts/perf/compare-vr.mjs; distinct per object, which also keeps gltf-transform's dedup from merging two objects'
// meshes). Returns [{ id, node }] in drawing order; throws when any triangle of a layer has no owner.
export function emitObjectNodes(glb, tags, { objectNumbers = new Map() } = {}) {
  const split = tags.layers.map((layer) => {
    if (layer.owners.length !== layer.mesh.vertexCount) throw new Error(`emitObjectNodes: ${layer.mesh.vertexCount - layer.owners.length} ${layer.name} vertices were never tagged`);
    const parts = splitByOwner(layer.mesh, layer.owners);
    const unowned = parts.get(null);
    if (unowned) throw new Error(`emitObjectNodes: no object owns ${unowned.indices.length / 3} triangles of the ${layer.name} layer`);
    return { layer, parts };
  });
  const emitted = [];
  for (const [id, meta] of tags.objects) {
    const pieces = split.flatMap(({ layer, parts }) => (parts.has(id) ? [{ layer, mesh: parts.get(id) }] : []));
    if (pieces.length === 0) continue;
    const pivot = pivotOf(pieces.map((piece) => piece.mesh));
    const primitives = pieces.map(({ layer, mesh }) => {
      if (layer.material === null) throw new Error(`emitObjectNodes: layer ${layer.name} has geometry but no material`);
      return rebase(mesh, pivot).toPrimitive(layer.material);
    });
    const mesh = glb.addMesh(id, primitives);
    const number = objectNumbers.get(id);
    if (number !== undefined) {
      for (const primitive of glb.json.meshes[mesh].primitives) {
        const count = glb.json.accessors[primitive.attributes.POSITION].count;
        primitive.attributes._OBJECT_ID = glb.addAccessor(new Uint16Array(count).fill(number), "SCALAR");
      }
    }
    const node = glb.addNode({
      name: id,
      mesh,
      translation: pivot,
      extras: { editable: { id, kind: meta.kind, category: meta.category }, ...meta.extras },
    }, { root: true, collection: `Furniture/${kindGroup(meta.kind)}` });
    emitted.push({ id, node, kind: meta.kind, category: meta.category });
  }
  return emitted;
}

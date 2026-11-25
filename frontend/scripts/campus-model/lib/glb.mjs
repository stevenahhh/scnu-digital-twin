// Small binary glTF 2.0 writer: indexed triangle meshes, PBR materials with embedded PNG/JPEG
// textures, a node hierarchy and EXT_mesh_gpu_instancing. three's GLTFExporter needs a DOM canvas
// for textures, which the build script does not have.
const FLOAT = 5126;
const UNSIGNED_BYTE = 5121;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const REPEAT = 10497;
const CLAMP_TO_EDGE = 33071;
const LINEAR = 9729;
const LINEAR_MIPMAP_LINEAR = 9987;

export class GlbBuilder {
  constructor() {
    this.json = {
      asset: { version: "2.0", generator: "scnu-digital-twin campus-model generator" },
      scene: 0,
      scenes: [{ name: "Scene", nodes: [] }],
      nodes: [],
      meshes: [],
      materials: [],
      textures: [],
      images: [],
      samplers: [
        { magFilter: LINEAR, minFilter: LINEAR_MIPMAP_LINEAR, wrapS: REPEAT, wrapT: REPEAT },
        { magFilter: LINEAR, minFilter: LINEAR_MIPMAP_LINEAR, wrapS: CLAMP_TO_EDGE, wrapT: CLAMP_TO_EDGE },
      ],
      accessors: [],
      bufferViews: [],
      buffers: [{ byteLength: 0 }],
    };
    this.chunks = [];
    // bufferView index -> its bytes (readBufferView, readAccessor)
    this.viewChunks = [];
    this.byteLength = 0;
    this.extensionsUsed = new Set();
    // root node index -> collection path given by addNode({ collection }), taken by groupRoots before any match rule
    this.rootCollections = new Map();
    // collection path -> node index given by addNode({ collectionNode }): groupRoots uses that node as the collection
    this.collectionNodes = new Map();
  }

  addBufferView(bytes, target) {
    const padding = (4 - (this.byteLength % 4)) % 4;
    if (padding) {
      this.chunks.push(new Uint8Array(padding));
      this.byteLength += padding;
    }
    const view = { buffer: 0, byteOffset: this.byteLength, byteLength: bytes.byteLength };
    if (target) view.target = target;
    const chunk = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.chunks.push(chunk);
    this.viewChunks.push(chunk);
    this.byteLength += bytes.byteLength;
    this.json.bufferViews.push(view);
    return this.json.bufferViews.length - 1;
  }

  readBufferView(index) {
    return this.viewChunks[index];
  }

  // A copy of an accessor's data as the typed array it was written from.
  readAccessor(index) {
    const accessor = this.json.accessors[index];
    const Type = { [FLOAT]: Float32Array, [UNSIGNED_INT]: Uint32Array, [UNSIGNED_SHORT]: Uint16Array, [UNSIGNED_BYTE]: Uint8Array }[accessor.componentType];
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
    const bytes = this.readBufferView(accessor.bufferView);
    return new Type(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + accessor.count * size * Type.BYTES_PER_ELEMENT));
  }

  addAccessor(array, type, { target = ARRAY_BUFFER, normalized = false, minMax = false } = {}) {
    const componentType =
      array instanceof Float32Array ? FLOAT
        : array instanceof Uint32Array ? UNSIGNED_INT
          : array instanceof Uint16Array ? UNSIGNED_SHORT
            : UNSIGNED_BYTE;
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const accessor = {
      bufferView: this.addBufferView(array, target),
      componentType,
      count: array.length / size,
      type,
    };
    if (normalized) accessor.normalized = true;
    if (minMax) {
      const min = new Array(size).fill(Infinity);
      const max = new Array(size).fill(-Infinity);
      for (let i = 0; i < array.length; i += size) {
        for (let k = 0; k < size; k += 1) {
          if (array[i + k] < min[k]) min[k] = array[i + k];
          if (array[i + k] > max[k]) max[k] = array[i + k];
        }
      }
      accessor.min = min;
      accessor.max = max;
    }
    this.json.accessors.push(accessor);
    return this.json.accessors.length - 1;
  }

  // bytes: encoded PNG/JPEG. Returns a texture index.
  addTexture(bytes, mimeType, { repeat = true } = {}) {
    const bufferView = this.addBufferView(new Uint8Array(bytes));
    this.json.images.push({ bufferView, mimeType });
    this.json.textures.push({ source: this.json.images.length - 1, sampler: repeat ? 0 : 1 });
    return this.json.textures.length - 1;
  }

  addMaterial(material) {
    this.json.materials.push(material);
    return this.json.materials.length - 1;
  }

  // primitives: [{ positions, normals, uvs?, colors? (Uint8 RGBA), indices, material }]
  addMesh(name, primitives) {
    const mesh = { name, primitives: [] };
    for (const primitive of primitives) {
      if (primitive.indices.length === 0) continue;
      const attributes = {
        POSITION: this.addAccessor(primitive.positions, "VEC3", { minMax: true }),
        NORMAL: this.addAccessor(primitive.normals, "VEC3"),
      };
      if (primitive.uvs) attributes.TEXCOORD_0 = this.addAccessor(primitive.uvs, "VEC2");
      if (primitive.colors) attributes.COLOR_0 = this.addAccessor(primitive.colors, "VEC4", { normalized: true });
      const vertexCount = primitive.positions.length / 3;
      const indices = vertexCount < 65536 ? Uint16Array.from(primitive.indices) : Uint32Array.from(primitive.indices);
      mesh.primitives.push({
        attributes,
        indices: this.addAccessor(indices, "SCALAR", { target: ELEMENT_ARRAY_BUFFER }),
        material: primitive.material,
      });
    }
    if (mesh.primitives.length === 0) return null;
    this.json.meshes.push(mesh);
    return this.json.meshes.length - 1;
  }

  // instances: { translations: Float32Array(n*3), rotations: Float32Array(n*4), scales: Float32Array(n*3), colors?: Float32Array(n*3) }
  instancingExtension(instances) {
    this.extensionsUsed.add("EXT_mesh_gpu_instancing");
    const attributes = {
      TRANSLATION: this.addAccessor(instances.translations, "VEC3"),
      ROTATION: this.addAccessor(instances.rotations, "VEC4"),
      SCALE: this.addAccessor(instances.scales, "VEC3"),
    };
    if (instances.colors) attributes._COLOR_0 = this.addAccessor(instances.colors, "VEC3");
    return { EXT_mesh_gpu_instancing: { attributes } };
  }

  // collectionNode: this mesh-less node becomes the collection node of that path in groupRoots (it keeps its name and
  // extras and gains extras.collection), so a data-only node is never an empty leaf, which gltf-transform's prune drops.
  addNode(node, { root = false, collection = null, collectionNode = null } = {}) {
    this.json.nodes.push(node);
    const index = this.json.nodes.length - 1;
    if (root) this.json.scenes[0].nodes.push(index);
    if (root && collection) this.rootCollections.set(index, collection);
    if (collectionNode) this.collectionNodes.set(collectionNode, index);
    return index;
  }

  // Moves every scene root node under a collection node (identity transform, extras.collection = true): the first
  // group whose match(name) is true takes the node (a root added with a collection path goes there instead), nested
  // groups by "Parent/Child" names. Blender's glTF importer shows
  // each collection node as an empty with its children, so the outliner reads as layers. Throws on a root no group takes.
  groupRoots(groups) {
    const scene = this.json.scenes[0];
    const byPath = new Map();
    const collection = (pathName) => {
      if (byPath.has(pathName)) return byPath.get(pathName);
      const parts = pathName.split("/");
      const carrier = this.collectionNodes.get(pathName);
      if (carrier !== undefined) {
        const node = this.json.nodes[carrier];
        if (node.mesh !== undefined || node.children?.length) throw new Error(`groupRoots: collection node ${pathName} must be mesh-less and childless`);
        Object.assign(node, { children: [], extras: { ...node.extras, collection: true } });
      }
      const index = carrier ?? this.json.nodes.push({ name: parts.at(-1), children: [], extras: { collection: true } }) - 1;
      if (parts.length === 1) scene.nodes.push(index);
      else this.json.nodes[collection(parts.slice(0, -1).join("/"))].children.push(index);
      byPath.set(pathName, index);
      return index;
    };
    const roots = scene.nodes;
    scene.nodes = [];
    for (const index of roots) {
      const name = this.json.nodes[index].name ?? "";
      const path = this.rootCollections.get(index) ?? groups.find((g) => g.match(name))?.path;
      if (!path) throw new Error(`groupRoots: no collection for root node ${name}`);
      this.json.nodes[collection(path)].children.push(index);
    }
    for (const [pathName] of this.collectionNodes) {
      if (!byPath.has(pathName)) throw new Error(`groupRoots: collection node ${pathName} received no children`);
    }
    return byPath;
  }

  toBuffer() {
    const binary = new Uint8Array(Math.ceil(this.byteLength / 4) * 4);
    let offset = 0;
    for (const chunk of this.chunks) {
      binary.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.json.buffers[0].byteLength = binary.byteLength;
    if (this.extensionsUsed.size) this.json.extensionsUsed = [...this.extensionsUsed];
    for (const key of ["textures", "images", "materials"]) {
      if (this.json[key].length === 0) delete this.json[key];
    }
    if (!this.json.textures) delete this.json.samplers;
    const jsonBytes = new TextEncoder().encode(JSON.stringify(this.json));
    const jsonPadded = new Uint8Array(Math.ceil(jsonBytes.length / 4) * 4).fill(0x20);
    jsonPadded.set(jsonBytes);
    const total = 12 + 8 + jsonPadded.length + 8 + binary.length;
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, total, true);
    view.setUint32(12, jsonPadded.length, true);
    view.setUint32(16, 0x4e4f534a, true);
    out.set(jsonPadded, 20);
    view.setUint32(20 + jsonPadded.length, binary.length, true);
    view.setUint32(24 + jsonPadded.length, 0x004e4942, true);
    out.set(binary, 28 + jsonPadded.length);
    return out;
  }
}

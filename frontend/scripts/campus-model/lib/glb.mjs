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
    this.byteLength = 0;
    this.extensionsUsed = new Set();
  }

  addBufferView(bytes, target) {
    const padding = (4 - (this.byteLength % 4)) % 4;
    if (padding) {
      this.chunks.push(new Uint8Array(padding));
      this.byteLength += padding;
    }
    const view = { buffer: 0, byteOffset: this.byteLength, byteLength: bytes.byteLength };
    if (target) view.target = target;
    this.chunks.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    this.byteLength += bytes.byteLength;
    this.json.bufferViews.push(view);
    return this.json.bufferViews.length - 1;
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

  addNode(node, { root = false } = {}) {
    this.json.nodes.push(node);
    const index = this.json.nodes.length - 1;
    if (root) this.json.scenes[0].nodes.push(index);
    return index;
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

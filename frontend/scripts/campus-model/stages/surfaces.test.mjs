import assert from "node:assert/strict";
import test from "node:test";

import { sceneToTm } from "../../../src/geo/epsg5186.mjs";
import { SCENE_UNITS_PER_METRE } from "../lib/frame.mjs";
import { topographySurface } from "./ground.mjs";
import { GlbBuilder } from "../lib/glb.mjs";
import { GROUND_MESHES, SURFACE_LIFT_M, buildSurfaceMeshes, surfaceGeometry } from "./surfaces.mjs";

const TERRAIN = 12;
const surface = topographySurface(() => TERRAIN);
const tmRect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => sceneToTm(x, z));
const layers = [
  { mesh: "Ground_Asphalt", precedence: 3, rings: [tmRect(100, -200, 140, -190)], source: "road-zone-measured" },
  { mesh: "Ground_Asphalt", precedence: 3, rings: [tmRect(150, -200, 160, -190)], source: "OSM-derived" },
  { mesh: "Ground_Pavers", precedence: 5, rings: [tmRect(120, -195, 130, -185)], source: "NGII-A003" },
  { mesh: "Ground_Apron", precedence: 6, rings: [tmRect(200, -200, 202, -190)], source: "project-estimated" },
  { mesh: "Ground_Sports", precedence: 1, rings: [tmRect(300, -100, 330, -80)], source: "OSM-derived", paint: { kind: "pitch", sport: "soccer" } },
];
const sizes = { Ground_Asphalt: 3, Ground_Pavers: 0.9, Ground_Apron: 1.1 };
const primitives = surfaceGeometry({ layers, surface, tileSize: (mesh) => sizes[mesh] });

test("shared paving textures preserve each surface class albedo at equal precedence", async () => {
  const glb = new GlbBuilder();
  const meshes = ["Ground_Pavers", "Ground_Walkway"];
  await buildSurfaceMeshes({
    glb, surface, decimate: false,
    layers: meshes.map((mesh, i) => ({
      mesh, precedence: 5, rings: [tmRect(100 + i * 10, -200, 104 + i * 10, -196)],
      source: "project-estimated",
    })),
  });
  const materials = meshes.map((name) => {
    const mesh = glb.json.meshes.find((m) => m.name === name);
    return glb.json.materials[mesh.primitives[0].material];
  });
  for (let i = 0; i < meshes.length; i++) {
    assert.deepEqual(materials[i].pbrMetallicRoughness.baseColorFactor, GROUND_MESHES[meshes[i]].baseColorFactor);
  }
  assert.equal(materials[0].pbrMetallicRoughness.baseColorTexture.index, materials[1].pbrMetallicRoughness.baseColorTexture.index);
});

test("one primitive per tiled class (the painted surface gets its own) with vertices", () => {
  assert.deepEqual(primitives.map((p) => p.mesh), ["Ground_Sports", "Ground_Asphalt", "Ground_Pavers", "Ground_Apron"]);
  for (const p of primitives) {
    assert.ok(p.positions.length / 3 > 0, `${p.mesh} has no vertices`);
    assert.equal(p.indices.length % 3, 0);
    assert.equal(p.uv1.length / 2, p.positions.length / 3);
  }
});

test("lift above the terrain grows with precedence", () => {
  const liftOf = (mesh) => {
    const p = primitives.find((q) => q.mesh === mesh);
    return (p.positions[1] - TERRAIN) / SCENE_UNITS_PER_METRE;
  };
  const lifts = ["Ground_Sports", "Ground_Asphalt", "Ground_Pavers", "Ground_Apron"].map(liftOf);
  for (let i = 1; i < lifts.length; i += 1) assert.ok(lifts[i] > lifts[i - 1], `lifts ${lifts}`);
  assert.ok(Math.abs(liftOf("Ground_Asphalt") - SURFACE_LIFT_M(3)) < 1e-9);
  assert.ok(lifts.at(-1) < 0.04, "every ground layer stays below the road markings' 0.04 m");
});

test("tile UVs repeat every physicalSizeM metres of EPSG:5186: u = E / size up to whole repeats", () => {
  for (const p of primitives.filter((q) => q.mesh !== "Ground_Sports")) {
    const size = sizes[p.mesh];
    for (let v = 0; v < p.positions.length / 3; v += 1) {
      const [E, N] = sceneToTm(p.positions[v * 3], p.positions[v * 3 + 2]);
      const du = p.uvs[v * 2] - E / size;
      const dv = p.uvs[v * 2 + 1] + N / size;
      assert.ok(Math.abs(du - Math.round(du)) < 1e-6, `${p.mesh} u off by ${du}`);
      assert.ok(Math.abs(dv - Math.round(dv)) < 1e-6, `${p.mesh} v off by ${dv}`);
    }
  }
});

test("every triangle faces up", () => {
  for (const p of primitives) {
    for (let t = 0; t < p.indices.length; t += 3) {
      const [a, b, c] = [p.indices[t], p.indices[t + 1], p.indices[t + 2]].map((i) => [p.positions[i * 3], p.positions[i * 3 + 2]]);
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      assert.ok(cross < 0, `${p.mesh} triangle ${t / 3} faces down`);
    }
  }
});

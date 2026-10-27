import assert from "node:assert/strict";
import test from "node:test";
import { CAMERA_PRESETS } from "../camera/cameraPresets.mjs";
import { createVWorldCampusCamera, runtimeNodeName, sceneLookups } from "./campusCamera.mjs";

// Identity model matrix: world = model-local = (scene z, x, y) + centre. The surface normal is world +Z (flat earth).
function fakeCesium() {
  class Cartesian3 { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } }
  const C = Cartesian3;
  C.subtract = (a, b, o) => Object.assign(o, { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  C.dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  C.multiplyByScalar = (a, s, o) => Object.assign(o, { x: a.x * s, y: a.y * s, z: a.z * s });
  C.normalize = (a, o) => { const l = Math.hypot(a.x, a.y, a.z); return Object.assign(o, { x: a.x / l, y: a.y / l, z: a.z / l }); };
  return {
    Cartesian3,
    Matrix4: { multiplyByPoint: (_m, p, o) => Object.assign(o, p) },
    Ellipsoid: { WGS84: { geodeticSurfaceNormal: (_p, o) => Object.assign(o, { x: 0, y: 0, z: 1 }) } },
  };
}

const center = { x: 10, z: -5 };
const boxes = new Map([["BLD_D4", [[0, 0, 0], [20, 30, 40]]]]);

test("runtime node names follow GLTFLoader's sanitizer", () => {
  assert.equal(runtimeNodeName("BLD_C1.001"), "BLD_C1001");
  assert.equal(runtimeNodeName("BLD_Training Lab Building"), "BLD_Training_Lab_Building");
});

test("focus presets resolve from the GLB boxes in the recentred scene frame", () => {
  const { boundsOf } = sceneLookups({ boxes, center });
  assert.deepEqual(boundsOf("BLD_D4"), { min: [-10, 0, 5], max: [10, 30, 45] });
  assert.equal(boundsOf("BLD_NONE"), null);
});

test("flies the Cesium camera to the preset with a level up vector, and jumps under reduced motion", () => {
  const Cesium = fakeCesium();
  const calls = [];
  const scene = { camera: { flyTo: (o) => calls.push(["fly", o]), setView: (o) => calls.push(["set", o]) }, requestRender: () => {} };
  const camera = createVWorldCampusCamera({ Cesium, scene, getModelMatrix: () => "m", boxes, center });
  const overview = CAMERA_PRESETS.find((p) => p.id === "overview");
  assert.equal(camera.flyTo(overview), true);
  const [kind, view] = calls[0];
  assert.equal(kind, "fly");
  // overview: position scene (0, 260, 260) -> model (10, 260, 255) -> local (255, 10, 260).
  assert.deepEqual({ ...view.destination }, { x: 255, y: 10, z: 260 });
  const { direction, up } = view.orientation;
  assert.ok(Math.abs(Cesium.Cartesian3.dot(direction, up)) < 1e-9);
  assert.ok(up.z > 0);
  assert.ok(view.duration > 0);
  let finished = false;
  camera.flyTo(overview, { reducedMotion: true, onFinish: () => { finished = true; } });
  assert.equal(calls[1][0], "set");
  assert.equal(finished, true);
});

test("does nothing before the overlay has a model matrix", () => {
  const scene = { camera: { flyTo: () => assert.fail("flew") } };
  const camera = createVWorldCampusCamera({ Cesium: fakeCesium(), scene, getModelMatrix: () => null, boxes, center });
  assert.equal(camera.flyTo(CAMERA_PRESETS[0]), false);
});

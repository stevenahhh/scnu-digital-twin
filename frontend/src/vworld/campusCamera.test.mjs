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

test("camera buttons zoom toward the ground point at the view centre and orbit it about the local up axis", () => {
  const Cesium = fakeCesium();
  Cesium.Cartesian2 = class { constructor(x, y) { Object.assign(this, { x, y }); } };
  Cesium.Cartesian3.distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const pivot = new Cesium.Cartesian3(0, 0, 0);
  const moves = [];
  const views = [];
  const scene = {
    canvas: { clientWidth: 800, clientHeight: 600 },
    globe: { pick: () => pivot },
    requestRender: () => {},
    camera: {
      getPickRay: () => ({}),
      positionWC: new Cesium.Cartesian3(100, 0, 100),
      directionWC: { x: -Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 },
      upWC: { x: -Math.SQRT1_2, y: 0, z: Math.SQRT1_2 },
      moveForward: (amount) => moves.push(amount),
      setView: (view) => views.push(view),
    },
  };
  const camera = createVWorldCampusCamera({ Cesium, scene, getModelMatrix: () => null, boxes, center });
  // x0.8 = 20% closer to the pivot (141.4 units away), x1.25 = 25% farther.
  assert.equal(camera.zoomBy(0.8), true);
  assert.equal(camera.zoomBy(1.25), true);
  assert.ok(Math.abs(moves[0] - 0.2 * Math.hypot(100, 100)) < 1e-9);
  assert.ok(Math.abs(moves[1] + 0.25 * Math.hypot(100, 100)) < 1e-9);
  // A quarter turn about +Z (the fake surface normal) keeps height and distance and turns the view with it.
  assert.equal(camera.rotateBy(Math.PI / 2), true);
  const { destination, orientation } = views[0];
  assert.ok(Math.abs(destination.x) < 1e-9 && Math.abs(destination.y - 100) < 1e-9 && Math.abs(destination.z - 100) < 1e-9);
  assert.ok(Math.abs(orientation.direction.y + Math.SQRT1_2) < 1e-9 && Math.abs(orientation.direction.z + Math.SQRT1_2) < 1e-9);
  // No ground point under the view centre: the buttons do nothing.
  scene.globe.pick = () => null;
  scene.camera.pickEllipsoid = () => null;
  assert.equal(camera.zoomBy(0.8), false);
});

test("trackpad tilt swings the camera about the view centre within the Legacy polar limits, and pinch zoom respects the zoom range", () => {
  const Cesium = fakeCesium();
  Cesium.Cartesian2 = class { constructor(x, y) { Object.assign(this, { x, y }); } };
  Cesium.Cartesian3.distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const views = [];
  const moves = [];
  const scene = {
    canvas: { clientWidth: 800, clientHeight: 600 },
    globe: { pick: () => new Cesium.Cartesian3(0, 0, 0) },
    screenSpaceCameraController: { minimumZoomDistance: 100, maximumZoomDistance: 1000 },
    requestRender: () => {},
    camera: {
      getPickRay: () => ({}),
      positionWC: new Cesium.Cartesian3(100, 0, 100),
      directionWC: { x: -Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 },
      upWC: { x: -Math.SQRT1_2, y: 0, z: Math.SQRT1_2 },
      moveForward: (amount) => moves.push(amount),
      setView: (view) => views.push(view),
    },
  };
  const camera = createVWorldCampusCamera({ Cesium, scene, getModelMatrix: () => null, boxes, center });
  const polarOf = ({ x, y, z }) => Math.atan2(Math.hypot(x, y), z);
  assert.equal(camera.tiltBy(0.1), true);
  assert.ok(Math.abs(polarOf(views[0].destination) - (Math.PI / 4 + 0.1)) < 1e-9);
  assert.ok(Math.abs(Math.hypot(views[0].destination.x, views[0].destination.y, views[0].destination.z) - Math.hypot(100, 100)) < 1e-9);
  assert.ok(Math.abs(views[0].destination.y) < 1e-9);
  camera.tiltBy(5);
  assert.ok(Math.abs(polarOf(views[1].destination) - Math.PI / 2.2) < 1e-9);
  // 141 m away with a 100 m floor: a 0.1x pinch stops at the floor instead of passing through the ground.
  camera.zoomBy(0.1);
  assert.ok(Math.abs(moves[0] - (Math.hypot(100, 100) - 100)) < 1e-9);
});

test("the shared-link pose is written and read back in the Legacy scene frame", () => {
  const Cesium = fakeCesium();
  Cesium.Cartesian2 = class { constructor(x, y) { Object.assign(this, { x, y }); } };
  // Cesium's Matrix4 is a class with static helpers; the identity model matrix is its own inverse.
  Cesium.Matrix4 = Object.assign(function Matrix4() {}, Cesium.Matrix4, { inverse: (m) => m });
  let placed = null;
  const scene = {
    canvas: { clientWidth: 800, clientHeight: 600 },
    globe: { pick: () => null },
    requestRender: () => {},
    camera: { getPickRay: () => ({}), setView: (view) => { placed = view; } },
  };
  const camera = createVWorldCampusCamera({ Cesium, scene, getModelMatrix: () => "m", boxes, center });
  const pose = { position: [12, 80, 40], target: [2, 0, -6] };
  assert.equal(camera.applyPose(pose), true);
  // The camera now sits where the pose put it; the ground point under the view centre is the pose's target.
  scene.camera.positionWC = placed.destination;
  const [tx, ty, tz] = pose.target;
  scene.globe.pick = () => new Cesium.Cartesian3(tz + center.z, tx + center.x, ty);
  assert.deepEqual(camera.poseOf(), pose);
  // Before the overlay has a model matrix there is no pose to share or place.
  const early = createVWorldCampusCamera({ Cesium, scene, getModelMatrix: () => null, boxes, center });
  assert.equal(early.poseOf(), null);
  assert.equal(early.applyPose(pose), false);
});

test("arrow-key pans move the camera along the ground, keeping its height and view", () => {
  const Cesium = fakeCesium();
  Cesium.Cartesian2 = class { constructor(x, y) { Object.assign(this, { x, y }); } };
  Cesium.Cartesian3.distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const views = [];
  const scene = {
    canvas: { clientWidth: 800, clientHeight: 600 },
    globe: { pick: () => new Cesium.Cartesian3(0, 0, 0) },
    requestRender: () => {},
    camera: {
      getPickRay: () => ({}),
      positionWC: new Cesium.Cartesian3(0, -100, 100),
      directionWC: { x: 0, y: Math.SQRT1_2, z: -Math.SQRT1_2 },
      upWC: { x: 0, y: Math.SQRT1_2, z: Math.SQRT1_2 },
      rightWC: { x: 1, y: 0, z: 0 },
      setView: (view) => views.push(view),
    },
  };
  const camera = createVWorldCampusCamera({ Cesium, scene, getModelMatrix: () => null, boxes, center });
  assert.equal(camera.panBy(0.1, 0), true);
  assert.equal(camera.panBy(0, 0.1), true);
  const d = Math.hypot(100, 100) * 0.1;
  assert.ok(Math.abs(views[0].destination.x - d) < 1e-9 && views[0].destination.z === 100);
  // Forward is the view direction flattened onto the ground (+y here), not into the ground.
  assert.ok(Math.abs(views[1].destination.y - (-100 + d)) < 1e-9 && views[1].destination.z === 100);
  assert.equal(views[1].orientation.direction, scene.camera.directionWC);
});

test("flies with the Legacy easing and no altitude arc, and focus flights come from the camera's side", () => {
  const Cesium = fakeCesium();
  Cesium.EasingFunction = { QUADRATIC_IN_OUT: "quad" };
  Cesium.Cartographic = { fromCartesian: (point) => ({ height: point.z }) };
  Cesium.Cartesian2 = class { constructor(x, y) { Object.assign(this, { x, y }); } };
  Cesium.Matrix4 = Object.assign(class {}, { multiplyByPoint: (_m, point, out) => Object.assign(out, point), inverse: () => "inverse" });
  const calls = [];
  const scene = {
    canvas: { clientWidth: 800, clientHeight: 600 },
    camera: { positionWC: new Cesium.Cartesian3(0, 0, 500), flyTo: (o) => calls.push(o), setView: () => {}, cancelFlight: () => calls.push("cancel"), pickEllipsoid: () => new Cesium.Cartesian3(0, 0, 0) },
    requestRender: () => {},
  };
  const camera = createVWorldCampusCamera({ Cesium, scene, getModelMatrix: () => "m", boxes, center });
  camera.flyTo(CAMERA_PRESETS.find((p) => p.id === "overview"));
  assert.equal(calls[0].easingFunction, "quad");
  // overview destination local z = 260, start height 500: the flight never climbs above the higher end.
  assert.equal(calls[0].maximumHeight, 500);
  const target = camera.focusTarget({ focus: ["BLD_D4"] });
  assert.deepEqual(target, [0, 15, 25]);
  assert.equal(camera.flyToFocus(target), true);
  assert.equal(calls.length, 2);
  camera.cancelFlight();
  assert.equal(calls.at(-1), "cancel");
});

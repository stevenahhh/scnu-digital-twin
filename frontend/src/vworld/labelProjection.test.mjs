import assert from "node:assert/strict";
import test from "node:test";
import { createVWorldLabelProjector, sceneToModelLocal, VWORLD_SCENE_UNITS_PER_METRE } from "./labelProjection.mjs";

// A flat fake Cesium: the model matrix is the identity, so world = model-local = (scene z, x, y); the camera looks down -Z
// from 300 m. wgs84ToWindowCoordinates is an orthographic stub (window x = world x, window y = world y) unless overridden.
function fakeCesium({ toWindow } = {}) {
  class Cartesian3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    static subtract(a, b, out) { out.x = a.x - b.x; out.y = a.y - b.y; out.z = a.z - b.z; return out; }
    static dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
    static distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  }
  return {
    Cartesian3,
    Matrix4: {
      IDENTITY: "identity",
      multiplyByPoint: (_matrix, point, out) => Object.assign(out, point),
      getTranslation: (_matrix, out) => out,
    },
    Cartographic: { fromCartesian: (point) => ({ longitude: point.x, latitude: point.y, height: 0 }) },
    SceneTransforms: { wgs84ToWindowCoordinates: toWindow ?? ((_scene, p) => ({ x: p.x, y: p.y })) },
  };
}

function fakeScene(Cesium, { pitch = -Math.PI / 2, height = 300 } = {}) {
  return {
    camera: {
      positionWC: new Cesium.Cartesian3(0, 0, height),
      directionWC: new Cesium.Cartesian3(0, 0, -1),
      positionCartographic: { height },
      pitch,
    },
  };
}

const AREA = { left: 10, top: 20, right: 410, bottom: 320, width: 400, height: 300 };
// scene (x, y, z) -> model-local (z, x, y): position [x, y, z] lands at world (z, x, y).
const at = (id, worldX, worldY, worldZ = 0) => ({ elementId: id, position: [worldY, worldZ, worldX] });

test("maps glTF scene axes to Cesium model-local axes (z, x, y)", () => {
  assert.deepEqual(sceneToModelLocal([1, 2, 3]), [3, 1, 2]);
});

test("projects anchors into the map area and scales distances to scene units", () => {
  const Cesium = fakeCesium();
  const scene = fakeScene(Cesium);
  const projector = createVWorldLabelProjector({ Cesium, scene, getModelMatrix: () => "m" });
  const { points, distance, pitchDegrees } = projector.project([at("BLD_A", 100, 50)], AREA);
  assert.deepEqual({ x: points.get("BLD_A").x, y: points.get("BLD_A").y }, { x: 110, y: 70 });
  const metres = Math.hypot(100, 50, 300);
  assert.ok(Math.abs(points.get("BLD_A").depth - metres * VWORLD_SCENE_UNITS_PER_METRE) < 1e-9);
  // Looking straight down from 300 m: the band distance is the height in scene units.
  assert.ok(Math.abs(distance - 300 * VWORLD_SCENE_UNITS_PER_METRE) < 1e-9);
  assert.equal(pitchDegrees, 90);
});

test("drops anchors behind the camera, off screen, under the panel or without window coordinates; keeps the selected one", () => {
  const Cesium = fakeCesium({ toWindow: (_scene, p) => (p.x === 7 ? undefined : { x: p.x, y: p.y }) });
  const scene = fakeScene(Cesium);
  const projector = createVWorldLabelProjector({ Cesium, scene, getModelMatrix: () => "m" });
  const entries = [
    at("BEHIND", 100, 50, 400),
    at("OFF", 900, 50),
    at("SELECTED_OFF", 950, 50),
    at("PANEL", 350, 100),
    at("NO_WINDOW", 7, 50),
    at("SHOWN", 100, 100),
  ];
  const occluder = { left: 300, top: 0, right: 410, bottom: 320 };
  const { points } = projector.project(entries, AREA, { keepId: "SELECTED_OFF", occluder });
  assert.deepEqual([...points.keys()].sort(), ["SELECTED_OFF", "SHOWN"]);
  // While the camera moves (clip=false) chips may slide off screen.
  const moving = projector.project(entries, AREA, { occluder, clip: false });
  assert.deepEqual([...moving.points.keys()].sort(), ["OFF", "PANEL", "SELECTED_OFF", "SHOWN"]);
});

test("returns no points before the overlay has a model matrix", () => {
  const Cesium = fakeCesium();
  const projector = createVWorldLabelProjector({ Cesium, scene: fakeScene(Cesium), getModelMatrix: () => null });
  assert.equal(projector.project([at("BLD_A", 1, 1)], AREA).points.size, 0);
  assert.equal(projector.lonLatOf([1, 1, 1]), null);
});

test("lonLatOf converts an anchor to degrees", () => {
  const Cesium = fakeCesium();
  const projector = createVWorldLabelProjector({ Cesium, scene: fakeScene(Cesium), getModelMatrix: () => "m" });
  const { longitude, latitude } = projector.lonLatOf([0, 0, Math.PI]);
  assert.ok(Math.abs(longitude - 180) < 1e-9);
  assert.equal(latitude, 0);
});

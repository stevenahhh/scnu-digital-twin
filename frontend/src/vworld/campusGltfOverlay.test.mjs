import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMPUS_GLTF_OVERLAY_CONFIG,
  createCampusGltfOverlay,
  removeCampusGltfOverlay,
} from "./campusGltfOverlay.mjs";

function fakeCesium() {
  class Matrix4 {
    static fromRotationTranslation(value) { return { rotation: value }; }
    static fromTranslation(value) { return { translation: value }; }
    static fromScale(value) { return { scale: value }; }
    static multiply(left, right) { return { left, right }; }
  }
  return {
    Cartographic: { fromDegrees: (longitude, latitude) => ({ longitude, latitude }) },
    Cartesian3: class Cartesian3 {
      constructor(x, y, z) { Object.assign(this, { x, y, z }); }
      static fromDegrees(longitude, latitude, height) { return { longitude, latitude, height }; }
    },
    Math: { toRadians: (degrees) => degrees * Math.PI / 180 },
    Matrix3: { fromRotationZ: (radians) => ({ radians }) },
    Matrix4,
    Model: { fromGltfAsync: async (options) => ({ options }) },
    ShadowMode: { DISABLED: "disabled" },
    Transforms: { eastNorthUpToFixedFrame: (origin) => ({ origin }) },
  };
}

test("anchors the campus GLB to D4 and registers it as a Cesium primitive", async () => {
  const added = [];
  const staleModel = { id: "SCNU_D4_GLTF_OVERLAY" };
  const primitives = [staleModel];
  const viewer = {
    scene: {
      globe: { getHeight: () => 31.5 },
      primitives: {
        get length() { return primitives.length; },
        get: (index) => primitives[index],
        add: (model) => { added.push(model); primitives.push(model); return model; },
        remove: (model) => {
          const index = primitives.indexOf(model);
          if (index >= 0) primitives.splice(index, 1);
          return index >= 0;
        },
      },
    },
  };
  const model = await createCampusGltfOverlay({ _wsViewer: viewer }, fakeCesium());
  assert.equal(model.options.url, "/campus-buildings.glb");
  assert.equal(model.options.modelMatrix.left.left.left.origin.longitude, CAMPUS_GLTF_OVERLAY_CONFIG.anchor.longitude);
  assert.equal(model.options.modelMatrix.left.left.left.origin.height, 32);
  assert.deepEqual(
    { ...model.options.modelMatrix.left.right.scale },
    { x: 1.602, y: 1.602, z: 1.602 },
  );
  assert.deepEqual(
    { ...model.options.modelMatrix.right.translation },
    {
      x: 266.574,
      y: -46.513,
      z: -36.857,
    },
  );
  assert.deepEqual(CAMPUS_GLTF_OVERLAY_CONFIG.d4LocalAnchorMeters, {
    east: -266.574,
    north: 46.513,
    up: 36.857,
  });
  assert.equal(model.options.modelMatrix.left.left.right.rotation.radians, -Math.PI / 2);
  assert.equal(primitives.includes(staleModel), false);
  assert.equal(model.id, "SCNU_D4_GLTF_OVERLAY");
  assert.equal(added[0], model);
  assert.equal(removeCampusGltfOverlay({ _wsViewer: viewer }, model), true);
});

test("reports anchored when the terrain height stabilizes", async () => {
  const callbacks = [];
  const statuses = [];
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => { callbacks.push(callback); return 0; };
  try {
    const viewer = {
      scene: {
        globe: { tilesLoaded: true, getHeight: () => 31.5 },
        primitives: { add: (model) => model },
      },
    };
    await createCampusGltfOverlay({ _wsViewer: viewer }, fakeCesium(), {
      onStatus: (status) => statuses.push(status),
    });
    while (callbacks.length) callbacks.shift()();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  assert.deepEqual(statuses.map(({ state }) => state), ["loading", "anchored"]);
});

test("reports terrain timeout when terrain never becomes ready", async () => {
  const callbacks = [];
  const statuses = [];
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => { callbacks.push(callback); return 0; };
  try {
    const viewer = {
      scene: {
        globe: { tilesLoaded: false, getHeight: () => undefined },
        primitives: { add: (model) => model },
      },
    };
    await createCampusGltfOverlay({ _wsViewer: viewer }, fakeCesium(), {
      onStatus: (status) => statuses.push(status),
    });
    while (callbacks.length) callbacks.shift()();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  assert.deepEqual(statuses.map(({ state }) => state), ["loading", "terrain-timeout"]);
  assert.equal(statuses[1].message, "지형 높이를 확인하지 못해 건물 높이가 부정확할 수 있습니다");
});

test("reports model load errors and rethrows them", async () => {
  const failure = new Error("model load failed");
  const statuses = [];
  const Cesium = fakeCesium();
  Cesium.Model.fromGltfAsync = async () => { throw failure; };
  await assert.rejects(
    createCampusGltfOverlay(
      { _wsViewer: { scene: { globe: { getHeight: () => 31.5 }, primitives: { length: 0 } } } },
      Cesium,
      { onStatus: (status) => statuses.push(status) },
    ),
    failure,
  );
  assert.deepEqual(statuses.map(({ state }) => state), ["loading", "error"]);
  assert.equal(statuses[1].message, "캠퍼스 3D 모델을 불러오지 못했습니다");
});

test("reports a failed download on Cesium 1.99, where fromGltf returns before the model loads", async () => {
  const statuses = [];
  const callbacks = [];
  const removed = [];
  let destroyed = false;
  let rejectReady;
  const Cesium = fakeCesium();
  delete Cesium.Model.fromGltfAsync;
  Cesium.Model.fromGltf = (options) => ({
    options,
    readyPromise: new Promise((resolve, reject) => { rejectReady = reject; }),
    isDestroyed: () => destroyed,
  });
  const viewer = {
    scene: {
      globe: { tilesLoaded: true, getHeight: () => 31.5 },
      primitives: {
        length: 0,
        add: (model) => model,
        remove: (model) => { removed.push(model); destroyed = true; return true; },
      },
    },
  };
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => { callbacks.push(callback); return 0; };
  let model;
  try {
    model = await createCampusGltfOverlay({ _wsViewer: viewer }, Cesium, {
      onStatus: (status) => statuses.push(status),
    });
    rejectReady(new Error("Failed to load model: /campus-buildings.glb"));
    await new Promise((resolve) => setImmediate(resolve));
    while (callbacks.length) callbacks.shift()();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  assert.deepEqual(statuses.map(({ state }) => state), ["loading", "error"]);
  assert.equal(statuses[1].message, "캠퍼스 3D 모델을 불러오지 못했습니다");
  assert.deepEqual(removed, [model]);
});

test("does not read the deprecated readyPromise when Cesium has fromGltfAsync", async () => {
  const Cesium = fakeCesium();
  Cesium.Model.fromGltfAsync = async (options) => Object.defineProperty({ options }, "readyPromise", {
    get() { throw new Error("readyPromise was read although fromGltfAsync exists"); },
  });
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => 0;
  try {
    const model = await createCampusGltfOverlay(
      { _wsViewer: { scene: { globe: { getHeight: () => 31.5 }, primitives: { length: 0, add: (value) => value } } } },
      Cesium,
    );
    assert.equal(model.id, "SCNU_D4_GLTF_OVERLAY");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

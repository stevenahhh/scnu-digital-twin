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

test("does not anchor to the bare ellipsoid that a failed terrain load leaves behind", async () => {
  const callbacks = [];
  const statuses = [];
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => { callbacks.push(callback); return 0; };
  try {
    const viewer = {
      scene: {
        globe: { tilesLoaded: true, getHeight: () => -0.002 },
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

test("waits past a coarse startup height and anchors once at the real ground height", async () => {
  const callbacks = [];
  const statuses = [];
  const readings = [133, 133, 65.2, 65.2, 65.2];
  let reads = 0;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => { callbacks.push(callback); return 0; };
  let model;
  try {
    const viewer = {
      scene: {
        globe: { tilesLoaded: true, getHeight: () => readings[Math.min(reads++, readings.length - 1)] },
        primitives: { add: (value) => value },
      },
    };
    model = await createCampusGltfOverlay({ _wsViewer: viewer }, fakeCesium(), {
      onStatus: (status) => statuses.push(status),
    });
    while (callbacks.length) callbacks.shift()();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  assert.deepEqual(statuses.map(({ state }) => state), ["loading", "anchored"]);
  assert.equal(model.modelMatrix.left.left.left.origin.height, 65.2 + CAMPUS_GLTF_OVERLAY_CONFIG.terrainOffsetMeters);
});

test("reports the terrain warning after 30 s of wall time even when polls run late", async () => {
  const callbacks = [];
  const statuses = [];
  let clock = 0;
  const originalSetTimeout = globalThis.setTimeout;
  const originalNow = Date.now;
  globalThis.setTimeout = (callback) => { callbacks.push(callback); return 0; };
  Date.now = () => clock;
  let polls = 0;
  try {
    const viewer = {
      scene: {
        globe: { tilesLoaded: true, getHeight: () => -0.002 },
        primitives: { add: (model) => model },
      },
    };
    await createCampusGltfOverlay({ _wsViewer: viewer }, fakeCesium(), {
      onStatus: (status) => statuses.push({ state: status.state, at: clock }),
    });
    while (callbacks.length) {
      clock += 1000;
      polls += 1;
      callbacks.shift()();
    }
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    Date.now = originalNow;
  }
  assert.deepEqual(statuses.map(({ state }) => state), ["loading", "terrain-timeout"]);
  assert.equal(statuses[1].at, 30000);
  assert.equal(polls, 30);
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

test("anchors at the terrain provider's fixed-level height, not a coarse tile the globe holds", async () => {
  const statuses = [];
  const levels = [];
  const cesium = {
    ...fakeCesium(),
    sampleTerrain: async (provider, level, positions) => { levels.push(level); return positions.map((p) => ({ ...p, height: 65.28 })); },
  };
  const viewer = {
    terrainProvider: {},
    // A coarse tile that holds steady inside the plausible band: the poll alone would anchor on it.
    scene: { globe: { tilesLoaded: true, getHeight: () => 85.6 }, primitives: { add: (value) => value } },
  };
  const model = await createCampusGltfOverlay({ _wsViewer: viewer }, cesium, { onStatus: (status) => statuses.push(status) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(levels, [15]);
  assert.deepEqual(statuses.map(({ state }) => state), ["loading", "anchored"]);
  assert.equal(model.modelMatrix.left.left.left.origin.height, 65.28 + CAMPUS_GLTF_OVERLAY_CONFIG.terrainOffsetMeters);
});

test("falls back to the globe poll when the terrain sample fails", async () => {
  const callbacks = [];
  const statuses = [];
  const originalWarn = console.warn;
  console.warn = () => {};
  const cesium = { ...fakeCesium(), sampleTerrain: async () => { throw new Error("tile request failed"); } };
  const viewer = {
    terrainProvider: {},
    scene: { globe: { tilesLoaded: true, getHeight: () => 65.2 }, primitives: { add: (value) => value } },
  };
  let model;
  const originalSetTimeout = globalThis.setTimeout;
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  globalThis.setTimeout = (callback) => { callbacks.push(callback); return 0; };
  try {
    model = await createCampusGltfOverlay({ _wsViewer: viewer }, cesium, { onStatus: (status) => statuses.push(status) });
    // The sample retries until its deadline: step a fake clock past it, then run the fallback polls it schedules.
    for (let i = 0; i < 200 && statuses.length < 2; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      now += 1000;
      while (callbacks.length) callbacks.shift()();
    }
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    Date.now = originalNow;
    console.warn = originalWarn;
  }
  assert.deepEqual(statuses.map(({ state }) => state), ["loading", "anchored"]);
  assert.equal(model.modelMatrix.left.left.left.origin.height, 65.2 + CAMPUS_GLTF_OVERLAY_CONFIG.terrainOffsetMeters);
});

test("waits for a Cesium 1.99 terrain provider to be ready before sampling the anchor", async () => {
  const statuses = [];
  let ready = false;
  let releaseReady;
  const provider = { ready: false, readyPromise: new Promise((resolve) => { releaseReady = () => { ready = true; provider.ready = true; resolve(true); }; }) };
  const cesium = {
    ...fakeCesium(),
    sampleTerrain: async (p, level, positions) => {
      if (!ready) throw new Error("terrainProvider not ready");
      return positions.map((position) => ({ ...position, height: 65.28 }));
    },
  };
  const viewer = { terrainProvider: provider, scene: { globe: { tilesLoaded: true, getHeight: () => 85.6 }, primitives: { add: (value) => value } } };
  const model = await createCampusGltfOverlay({ _wsViewer: viewer }, cesium, { onStatus: (status) => statuses.push(status) });
  releaseReady();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(statuses.map(({ state }) => state), ["loading", "anchored"]);
  assert.equal(model.anchorSource, "terrain-sample");
  assert.equal(model.modelMatrix.left.left.left.origin.height, 65.28 + CAMPUS_GLTF_OVERLAY_CONFIG.terrainOffsetMeters);
});

test("keeps sampling while the viewer still holds the ellipsoid provider and anchors once the terrain provider arrives", async () => {
  const statuses = [];
  const ellipsoid = { name: "ellipsoid" };
  const terrain = { name: "vworld" };
  const viewer = { terrainProvider: ellipsoid, scene: { globe: { tilesLoaded: true, getHeight: () => 85.6 }, primitives: { add: (value) => value } } };
  let calls = 0;
  const cesium = {
    ...fakeCesium(),
    sampleTerrain: async (provider, level, positions) => {
      calls += 1;
      if (calls === 2) viewer.terrainProvider = terrain;
      return positions.map((position) => ({ ...position, height: provider === terrain ? 65.28 : 0 }));
    },
  };
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => { queueMicrotask(callback); return 0; };
  let model;
  try {
    model = await createCampusGltfOverlay({ _wsViewer: viewer }, cesium, { onStatus: (status) => statuses.push(status) });
    for (let i = 0; i < 20 && statuses.length < 2; i += 1) await new Promise((resolve) => setImmediate(resolve));
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  assert.deepEqual(statuses.map(({ state }) => state), ["loading", "anchored"]);
  assert.equal(model.anchorSource, "terrain-sample");
  assert.equal(model.modelMatrix.left.left.left.origin.height, 65.28 + CAMPUS_GLTF_OVERLAY_CONFIG.terrainOffsetMeters);
});

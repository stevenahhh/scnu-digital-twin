export const CAMPUS_GLTF_OVERLAY_CONFIG = Object.freeze({
  url: "/campus-buildings.glb",
  d4SceneNodeIndex: 250,
  anchor: Object.freeze({ longitude: 127.4764043, latitude: 34.9700548 }),
  // BLD_D4 (node 250) base-center in campus-buildings.glb mapped to Cesium model-local (glTF z, x, yMin); glTF Y-up→Z-up then Z-up→X-up axis correction; export node scale 0.62421715 → 1/0.62421715 = 1.602; heading -90 because model +X (glTF z) points south
  d4LocalAnchorMeters: Object.freeze({
    east: -266.574,
    north: 46.513,
    up: 36.857,
  }),
  headingDegrees: -90,
  fallbackGroundHeightMeters: 40,
  terrainOffsetMeters: 0.5,
  // The D4 anchor ground is about 65 m above the ellipsoid. A steady reading outside this band is the bare
  // ellipsoid (about 0 m, what the globe shows when terrain tiles fail) or a coarse startup tile, not terrain.
  groundHeightRangeMeters: Object.freeze({ min: 20, max: 120 }),
  modelScale: Object.freeze({ east: 1.602, north: 1.602, up: 1.602 }),
});

function getViewer(map) {
  return map?._wsViewer ?? null;
}

function terrainHeight(viewer, Cesium, longitude, latitude) {
  const cartographic = Cesium.Cartographic.fromDegrees(longitude, latitude);
  const sampledHeight = viewer.scene?.globe?.getHeight?.(cartographic);
  return Number.isFinite(sampledHeight)
    ? sampledHeight
    : CAMPUS_GLTF_OVERLAY_CONFIG.fallbackGroundHeightMeters;
}

function isPlausibleGroundHeight(height, { min, max } = CAMPUS_GLTF_OVERLAY_CONFIG.groundHeightRangeMeters) {
  return Number.isFinite(height) && height >= min && height <= max;
}

export function createCampusModelMatrix(viewer, Cesium, config = CAMPUS_GLTF_OVERLAY_CONFIG) {
  const groundHeight = terrainHeight(
    viewer,
    Cesium,
    config.anchor.longitude,
    config.anchor.latitude,
  );
  const origin = Cesium.Cartesian3.fromDegrees(
    config.anchor.longitude,
    config.anchor.latitude,
    groundHeight + config.terrainOffsetMeters,
  );
  const eastNorthUp = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  const heading = Cesium.Matrix4.fromRotationTranslation(
    Cesium.Matrix3.fromRotationZ(Cesium.Math.toRadians(config.headingDegrees)),
  );
  const scale = Cesium.Matrix4.fromScale(new Cesium.Cartesian3(
    config.modelScale.east,
    config.modelScale.north,
    config.modelScale.up,
  ));
  const offset = Cesium.Matrix4.fromTranslation(new Cesium.Cartesian3(
    -config.d4LocalAnchorMeters.east,
    -config.d4LocalAnchorMeters.north,
    -config.d4LocalAnchorMeters.up,
  ));
  const orientedScale = Cesium.Matrix4.multiply(
    Cesium.Matrix4.multiply(eastNorthUp, heading, new Cesium.Matrix4()),
    scale,
    new Cesium.Matrix4(),
  );
  return Cesium.Matrix4.multiply(
    orientedScale,
    offset,
    new Cesium.Matrix4(),
  );
}

const LOAD_FAILED_STATUS = Object.freeze({
  state: "error",
  message: "캠퍼스 3D 모델을 불러오지 못했습니다",
});

// Until the globe finishes loading its tiles, getHeight answers from whatever
// coarse tile is already resident and reports the anchor anywhere from -98 m to
// +133 m, which buries the campus under the terrain. `tilesLoaded` alone is not
// enough: it flickers true early in startup while the anchor tile is still
// coarse, and when terrain tiles fail it turns true over the bare ellipsoid
// (about 0 m). Require the loaded flag, a height inside groundHeightRangeMeters
// AND two consecutive identical readings, then re-anchor exactly once.
// Re-anchoring later is unsafe - the coarse readings come back when the camera
// leaves the campus and its tiles are evicted.
const TERRAIN_READY = Object.freeze({
  intervalMs: 250,
  toleranceMeters: 0.1,
  maxWaitMs: 30000,
});

function reanchorWhenTerrainLoaded(viewer, Cesium, model, onStatus, schedule = setTimeout) {
  // Polls run late while Cesium renders, so the limit is wall time; the poll count only keeps
  // tests with a synchronous scheduler finite.
  const startedAt = Date.now();
  let waited = 0;
  let confirming = null;

  const poll = () => {
    if (model.isDestroyed?.()) return;
    const globe = viewer.scene?.globe;
    const height = globe?.getHeight?.(Cesium.Cartographic.fromDegrees(
      CAMPUS_GLTF_OVERLAY_CONFIG.anchor.longitude,
      CAMPUS_GLTF_OVERLAY_CONFIG.anchor.latitude,
    ));

    if (globe?.tilesLoaded === true && isPlausibleGroundHeight(height)) {
      if (confirming !== null && Math.abs(height - confirming) <= TERRAIN_READY.toleranceMeters) {
        model.modelMatrix = createCampusModelMatrix(viewer, Cesium);
        onStatus?.({
          state: "anchored",
          message: "지형 높이를 확인해 캠퍼스 모델 위치를 보정했습니다",
        });
        return;
      }
      confirming = height;
    } else {
      confirming = null;
    }

    waited += TERRAIN_READY.intervalMs;
    if (waited >= TERRAIN_READY.maxWaitMs || Date.now() - startedAt >= TERRAIN_READY.maxWaitMs) {
      onStatus?.({
        state: "terrain-timeout",
        message: "지형 높이를 확인하지 못해 건물 높이가 부정확할 수 있습니다",
      });
      return;
    }
    schedule(poll, TERRAIN_READY.intervalMs)?.unref?.();
  };

  schedule(poll, TERRAIN_READY.intervalMs);
}

export async function createCampusGltfOverlay(
  map,
  Cesium = globalThis.window?.Cesium,
  { onStatus } = {},
) {
  const viewer = getViewer(map);
  const fromGltf = Cesium?.Model?.fromGltfAsync ?? Cesium?.Model?.fromGltf;
  if (!viewer || !fromGltf) return null;

  onStatus?.({ state: "loading", message: "캠퍼스 3D 모델을 불러오는 중입니다" });

  for (let index = viewer.scene.primitives.length - 1; index >= 0; index -= 1) {
    const primitive = viewer.scene.primitives.get(index);
    if (primitive?.id === "SCNU_D4_GLTF_OVERLAY") {
      viewer.scene.primitives.remove(primitive);
    }
  }

  let model;
  try {
    model = await fromGltf.call(Cesium.Model, {
      url: CAMPUS_GLTF_OVERLAY_CONFIG.url,
      modelMatrix: createCampusModelMatrix(viewer, Cesium),
      allowPicking: true,
      minimumPixelSize: 0,
      shadows: Cesium.ShadowMode?.DISABLED,
    });
  } catch (error) {
    onStatus?.(LOAD_FAILED_STATUS);
    throw error;
  }
  model.id = "SCNU_D4_GLTF_OVERLAY";
  viewer.scene.primitives.add(model);
  if (!Cesium.Model.fromGltfAsync) {
    // The VWorld SDK bundles Cesium 1.99: fromGltf returns the model before it downloads, and a failed
    // download only rejects readyPromise. Removing the model also ends the re-anchoring poll.
    model.readyPromise?.catch(() => {
      if (!model.isDestroyed?.()) viewer.scene.primitives.remove(model);
      onStatus?.(LOAD_FAILED_STATUS);
    });
  }
  reanchorWhenTerrainLoaded(viewer, Cesium, model, onStatus);
  return model;
}

export function removeCampusGltfOverlay(map, model) {
  const viewer = getViewer(map);
  if (!viewer || !model) return false;
  return viewer.scene.primitives.remove(model);
}

// Shadow camera of the Legacy sun light, sized from the campus box in scene units (0.6242 units/m).
// The light looks at the recentred origin from LIGHT_DISTANCE, so one fixed orthographic box has to
// hold the whole campus for every sun azimuth: its half-size is the half-diagonal of the box.

// Measured campus-v2.glb extent: about 510 x 383 units, half-diagonal 319 units.
export const CAMPUS_BOX_SIZE = { width: 510, depth: 383 };

// The light must sit farther than the half-diagonal, or buildings behind it fall outside the
// camera; far covers the light distance plus the half-diagonal plus a margin.
export const SHADOW_LIGHT_DISTANCE = 600;
export const SHADOW_CAMERA_NEAR = 1;
export const SHADOW_CAMERA_FAR = 1400;

export function getShadowCameraBounds({ width, depth, margin = 1 } = CAMPUS_BOX_SIZE) {
  const half = Math.ceil(Math.hypot(width, depth) / 2 + margin);
  return {
    left: -half,
    right: half,
    top: half,
    bottom: -half,
    near: SHADOW_CAMERA_NEAR,
    far: SHADOW_CAMERA_FAR,
  };
}

export const SHADOW_CAMERA_BOUNDS = getShadowCameraBounds();

// Lowest elevation of the shadow-casting light (radians). Below the horizon the sun would light the scene
// from underneath the ground: slopes facing it were lit from below and buildings threw box-shaped
// shadows up the hillside behind them. The light keeps the sun's azimuth but never sinks below this.
export const MIN_LIGHT_ALTITUDE = (3 * Math.PI) / 180;

// Position of the sun light for a sun direction vector: same azimuth, elevation clamped to minAltitude.
export function getShadowLightPosition(sunVector, { distance = SHADOW_LIGHT_DISTANCE, minAltitude = MIN_LIGHT_ALTITUDE } = {}) {
  const [x, y, z] = sunVector;
  const horizontal = Math.hypot(x, z);
  const altitude = Math.atan2(y, horizontal);
  if (altitude >= minAltitude) {
    const length = Math.hypot(x, y, z) || 1;
    return [x, y, z].map((v) => (v / length) * distance);
  }
  const [dx, dz] = horizontal > 0 ? [x / horizontal, z / horizontal] : [1, 0];
  const cos = Math.cos(minAltitude);
  return [dx * cos * distance, Math.sin(minAltitude) * distance, dz * cos * distance];
}

// 2048² gives 0.31 units (~0.5 m) per texel at +-320; desktop GPUs that allow 4096² halve that.
export function getShadowMapSize({ maxTextureSize, isMobile }) {
  return maxTextureSize >= 4096 && !isMobile ? 4096 : 2048;
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a) => {
  const length = Math.hypot(a[0], a[1], a[2]);
  return a.map((v) => v / length);
};

// Same basis as Object3D.lookAt for a light at lightPosition aimed at the origin (up = +y).
export function toShadowCameraSpace(point, lightPosition) {
  const forward = normalize(lightPosition.map((v) => -v));
  const up = Math.abs(forward[1]) > 0.9999 ? [0, 0, -1] : [0, 1, 0];
  const right = normalize(cross(forward, up));
  const cameraUp = cross(right, forward);
  const relative = point.map((v, index) => v - lightPosition[index]);
  return { x: dot(relative, right), y: dot(relative, cameraUp), depth: dot(relative, forward) };
}

export function isInsideShadowCamera(point, lightPosition, bounds = SHADOW_CAMERA_BOUNDS) {
  const { x, y, depth } = toShadowCameraSpace(point, lightPosition);
  return (
    x >= bounds.left &&
    x <= bounds.right &&
    y >= bounds.bottom &&
    y <= bounds.top &&
    depth >= bounds.near &&
    depth <= bounds.far
  );
}

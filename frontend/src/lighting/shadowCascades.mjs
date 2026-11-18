// Cascaded sun shadows for the Main campus (medium/high tiers). No ray tracing: ordinary shadow maps from
// several directional lights that share the sun direction. Cascade 0..n-2 hug slices of the camera frustum, the
// last cascade is the fixed campus-wide box of shadowFrustum.mjs, so every point of the campus has a shadow map
// even where the camera-fitted cascades end. The fragment shader picks the first (finest) cascade whose map
// contains the point (cascadeShadowChunk.mjs). Maps are re-rendered only when the sun moves or a fitted
// cascade no longer contains its frustum slice; a still camera renders no shadow pass.
import { SHADOW_CAMERA_BOUNDS, getShadowLightPosition } from "./shadowFrustum.mjs";

// Fitted cascades cover view depth [start, end] in scene units (0.6242 units/m). Both ends follow the orbit
// distance (camera to OrbitControls target): beyond `end` the campus-wide cascade takes over, and in front of
// `start` there is rarely ground in view from the orbit camera's 30-80 deg pitch.
export const CASCADE_START_FACTOR = 0.15;
export const CASCADE_END_FACTOR = 1.6;
export const CASCADE_MIN_END = 60;
export const CASCADE_MAX_END = 700;
// Weight of the logarithmic split against the uniform one (GPU Gems 3, "practical" split scheme).
export const CASCADE_SPLIT_LAMBDA = 0.6;
// A fitted cascade is made this much larger than its slice so small camera moves stay inside it without a re-render,
// and its radius is rounded up to RADIUS_STEP so a refit at a similar distance keeps the same texel size.
export const CASCADE_SLACK = 0.25;
export const CASCADE_RADIUS_STEP = 4;
// Casters between the sun and a fitted cascade can stand this far up-sun of its box (tall buildings and hills
// throwing long evening shadows into the slice): the light sits that much farther out.
export const CASCADE_CASTER_REACH = 400;
// A fitted cascade whose slice shrank below this share of its radius is refitted to get the resolution back.
export const CASCADE_MIN_FILL = 0.55;

// Phones keep every cascade at 1024² (4 MB each, 추정) whatever the tier asks; any GPU keeps under its texture limit.
// The campus-wide map at 1024² is 0.63 units (~1 m) per texel, the low tier's resolution.
export const MOBILE_SHADOW_MAP_CAP = 1024;
export const DESKTOP_SHADOW_MAP_CAP = 4096;

export function capShadowMapSizes(sizes, { maxTextureSize, isMobile }) {
  const cap = Math.min(maxTextureSize, isMobile ? MOBILE_SHADOW_MAP_CAP : DESKTOP_SHADOW_MAP_CAP);
  return sizes.map((size) => Math.min(size, cap));
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a) => scale(a, 1 / (length(a) || 1));

// View-depth range of the fitted cascades for an orbit camera targetDistance away from its target.
export function getCascadeRange({ near, targetDistance }) {
  const end = Math.min(CASCADE_MAX_END, Math.max(CASCADE_MIN_END, targetDistance * CASCADE_END_FACTOR));
  const start = Math.min(end * 0.5, Math.max(near, targetDistance * CASCADE_START_FACTOR));
  return [start, end];
}

// Split depths [d0 = start, ..., dn = end] for `count` fitted cascades (practical split scheme).
export function splitCascadeRange(count, start, end, lambda = CASCADE_SPLIT_LAMBDA) {
  const splits = [start];
  for (let i = 1; i < count; i += 1) {
    const uniform = start + ((end - start) * i) / count;
    const logarithmic = start * (end / start) ** (i / count);
    splits.push(lambda * logarithmic + (1 - lambda) * uniform);
  }
  splits.push(end);
  return splits;
}

// Smallest sphere around the slice of a symmetric perspective frustum between view depths near and far.
// Returns the sphere centre's view depth and radius. fov is vertical, in radians.
export function frustumSliceSphere({ fov, aspect, near, far }) {
  const ty = Math.tan(fov / 2);
  const k = ty * ty * (1 + aspect * aspect);
  const depth = Math.min(far, ((near + far) / 2) * (1 + k));
  const radius = Math.max(Math.hypot(depth - near, near * Math.sqrt(k)), Math.hypot(far - depth, far * Math.sqrt(k)));
  return { depth, radius };
}

// Orthonormal light basis (same as Object3D.lookAt from the sun toward the scene, up = +y).
export function lightBasis(sunDirection) {
  const forward = normalize(scale(sunDirection, -1));
  const up = Math.abs(forward[1]) > 0.9999 ? [0, 0, -1] : [0, 1, 0];
  const right = normalize(cross(forward, up));
  return { forward, right, up: cross(right, forward) };
}

// One fitted cascade: sphere around the slice, radius padded and rounded, centre snapped to whole texels in light
// space so a refit moves the map by whole texels (no shimmering edges). Returns light/target positions and the
// orthographic box for a DirectionalLight whose shadow camera looks from `position` to `target`.
export function fitCascade({ cameraPosition, cameraForward, fov, aspect, near, far, sunDirection, mapSize }) {
  const slice = frustumSliceSphere({ fov, aspect, near, far });
  const radius = Math.ceil((slice.radius * (1 + CASCADE_SLACK)) / CASCADE_RADIUS_STEP) * CASCADE_RADIUS_STEP;
  const centre = add(cameraPosition, scale(normalize(cameraForward), slice.depth));
  const basis = lightBasis(sunDirection);
  const texel = (2 * radius) / mapSize;
  const x = Math.round(dot(centre, basis.right) / texel) * texel;
  const y = Math.round(dot(centre, basis.up) / texel) * texel;
  const z = dot(centre, basis.forward);
  const snapped = add(add(scale(basis.right, x), scale(basis.up, y)), scale(basis.forward, z));
  const back = radius + CASCADE_CASTER_REACH;
  return {
    centre: snapped,
    radius,
    texel,
    position: sub(snapped, scale(basis.forward, back)),
    target: snapped,
    bounds: { left: -radius, right: radius, top: radius, bottom: -radius, near: 1, far: back + radius },
  };
}

// The slice sphere a fitted cascade has to contain right now (world centre and radius, unpadded).
export function currentSlice({ cameraPosition, cameraForward, fov, aspect, near, far }) {
  const slice = frustumSliceSphere({ fov, aspect, near, far });
  return { centre: add(cameraPosition, scale(normalize(cameraForward), slice.depth)), radius: slice.radius };
}

// A fitted cascade must be re-rendered when its slice leaves it or when the slice became much smaller (zoom in).
export function needsRefit(fit, slice) {
  if (!fit) return true;
  const offset = length(sub(slice.centre, fit.centre));
  return offset + slice.radius > fit.radius || slice.radius < fit.radius * CASCADE_MIN_FILL;
}

// Depth bias for a cascade: about two texels of world depth, expressed in the shadow camera's 0..1 depth;
// normal bias of 1.3 texels pushes the lookup off the surface (no acne) without visible peter-panning.
export function cascadeBias(fit) {
  return { bias: -(2 * fit.texel) / (fit.bounds.far - fit.bounds.near), normalBias: 1.3 * fit.texel };
}

// The last cascade: the static campus-wide box (same as the low tier's single map).
export function campusCascade(sunVector) {
  return { position: getShadowLightPosition(sunVector), target: [0, 0, 0], bounds: SHADOW_CAMERA_BOUNDS };
}

export function campusTexel(mapSize) {
  return (SHADOW_CAMERA_BOUNDS.right - SHADOW_CAMERA_BOUNDS.left) / mapSize;
}

// From far away (the overview camera) a slice of the view is as large as the campus, and a fitted map would be
// coarser than the campus-wide one. Such a cascade is parked: a 1-unit box high above the campus that no fragment
// falls into, so the shader moves on to the next map. The box still looks along the sun direction, because cascade 0
// is the sun light itself and its position-to-target direction lights the scene.
export const PARKED_HEIGHT = 5000;
export function parkCascade(fit, sunDirection) {
  const toSun = normalize(sunDirection);
  const target = [0, PARKED_HEIGHT, 0];
  return {
    ...fit,
    parked: true,
    position: add(target, toSun),
    target,
    bounds: { left: -0.5, right: 0.5, top: 0.5, bottom: -0.5, near: 0.5, far: 1.5 },
  };
}

export function isUsefulCascade(fit, campusMapSize) {
  return fit.texel < campusTexel(campusMapSize);
}

// All fitted cascades for a camera. camera: { position, forward, fov (rad), aspect, near, targetDistance }.
export function fitCascades({ camera, sunDirection, mapSizes }) {
  const [start, end] = getCascadeRange(camera);
  const splits = splitCascadeRange(mapSizes.length, start, end);
  return mapSizes.map((mapSize, i) => {
    const sliceInput = { cameraPosition: camera.position, cameraForward: camera.forward, fov: camera.fov, aspect: camera.aspect, near: splits[i], far: splits[i + 1] };
    return { ...fitCascade({ ...sliceInput, sunDirection, mapSize }), slice: sliceInput };
  });
}

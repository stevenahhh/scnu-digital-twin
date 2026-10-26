import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { getSunVector } from "../utils/sunPosition.mjs";
import { SHADOW_CAMERA_BOUNDS } from "./shadowFrustum.mjs";
import {
  CASCADE_RADIUS_STEP,
  campusCascade,
  cascadeBias,
  campusTexel,
  currentSlice,
  isUsefulCascade,
  parkCascade,
  fitCascades,
  frustumSliceSphere,
  getCascadeRange,
  lightBasis,
  needsRefit,
  splitCascadeRange,
} from "./shadowCascades.mjs";
import { CASCADE_CHUNK_MARKER, installCascadeShadowChunk, patchLightsFragmentBegin } from "./cascadeShadowChunk.mjs";

const DEG = Math.PI / 180;

// The orbit camera of AppLegacy (fov 50, near 0.1) looking at `target` from `position`.
function orbitCamera(position, target, aspect = 1440 / 900) {
  const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 2000);
  camera.position.set(...position);
  camera.lookAt(...target);
  camera.updateMatrixWorld();
  const forward = camera.getWorldDirection(new THREE.Vector3()).toArray();
  return {
    camera,
    input: { position, forward, fov: 50 * DEG, aspect, near: 0.1, targetDistance: new THREE.Vector3(...position).distanceTo(new THREE.Vector3(...target)) },
  };
}

// World-space corners of the view frustum slice between depths near and far.
function sliceCorners(camera, near, far) {
  const corners = [];
  const ty = Math.tan((camera.fov * DEG) / 2);
  const tx = ty * camera.aspect;
  for (const d of [near, far]) {
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      corners.push(new THREE.Vector3(sx * tx * d, sy * ty * d, -d).applyMatrix4(camera.matrixWorld));
    }
  }
  return corners;
}

// Same transform as DirectionalLightShadow: orthographic camera at the light, looking at its target.
function shadowCamera(fit) {
  const camera = new THREE.OrthographicCamera(fit.bounds.left, fit.bounds.right, fit.bounds.top, fit.bounds.bottom, fit.bounds.near, fit.bounds.far);
  camera.position.set(...fit.position);
  camera.lookAt(...fit.target);
  camera.updateMatrixWorld();
  return camera;
}

const inside = (camera, point) => {
  const ndc = point.clone().project(camera);
  return Math.abs(ndc.x) <= 1 + 1e-6 && Math.abs(ndc.y) <= 1 + 1e-6 && ndc.z >= -1 && ndc.z <= 1;
};

test("cascade range follows the orbit distance and the splits are increasing", () => {
  assert.deepEqual(getCascadeRange({ near: 0.1, targetDistance: 100 }), [15, 160]);
  assert.deepEqual(getCascadeRange({ near: 0.1, targetDistance: 10 }), [1.5, 60]);
  assert.equal(getCascadeRange({ near: 0.1, targetDistance: 1000 })[1], 700);
  const splits = splitCascadeRange(2, 15, 160);
  assert.equal(splits.length, 3);
  assert.ok(splits[0] < splits[1] && splits[1] < splits[2]);
  // Practical split sits between the logarithmic and the uniform split.
  assert.ok(splits[1] > Math.sqrt(15 * 160) && splits[1] < (15 + 160) / 2);
});

test("the slice sphere contains all eight slice corners", () => {
  const { camera } = orbitCamera([0, 80, 80], [0, 0, 0]);
  for (const [near, far] of [[15, 60], [60, 180], [1, 4]]) {
    const { depth, radius } = frustumSliceSphere({ fov: 50 * DEG, aspect: camera.aspect, near, far });
    const centre = new THREE.Vector3(0, 0, -depth).applyMatrix4(camera.matrixWorld);
    for (const corner of sliceCorners(camera, near, far)) assert.ok(corner.distanceTo(centre) <= radius + 1e-6);
  }
});

test("every fitted cascade's shadow camera contains its whole frustum slice for many suns and cameras", () => {
  const cameras = [[[0, 260, 260], [0, 0, 0]], [[-154.4, 96.4, -33.3], [-214.4, 46.4, -93.3]], [[240, 38, 15], [134, 4, -10]]];
  for (const [position, target] of cameras) {
    const { camera, input } = orbitCamera(position, target);
    for (const altitude of [5, 30, 70]) {
      for (const azimuth of [0, 100, 220]) {
        const sunDirection = getSunVector({ altitude: altitude * DEG, azimuth: azimuth * DEG });
        const fits = fitCascades({ camera: input, sunDirection, mapSizes: [2048, 2048] });
        for (const fit of fits) {
          const shadow = shadowCamera(fit);
          for (const corner of sliceCorners(camera, fit.slice.near, fit.slice.far)) {
            assert.ok(inside(shadow, corner), `corner outside cascade at alt ${altitude} az ${azimuth} cam ${position}`);
          }
          assert.equal(fit.radius % CASCADE_RADIUS_STEP, 0);
        }
        // Finer first: cascade 0 has the smaller texel.
        assert.ok(fits[0].texel < fits[1].texel);
      }
    }
  }
});

test("orbiting stays inside the padded cascade, a pan or a zoom-in asks for a refit", () => {
  const sunDirection = getSunVector({ altitude: 35 * DEG, azimuth: 120 * DEG });
  const base = orbitCamera([0, 80, 80], [0, 0, 0]).input;
  const [fit] = fitCascades({ camera: base, sunDirection, mapSizes: [2048] });
  const sliceOf = (input) => currentSlice({ cameraPosition: input.position, cameraForward: input.forward, fov: input.fov, aspect: input.aspect, near: fit.slice.near, far: fit.slice.far });
  assert.equal(needsRefit(fit, sliceOf(base)), false);
  assert.equal(needsRefit(null, sliceOf(base)), true);
  // Orbiting around the target barely moves a slice that is centred near the target: no re-render while turning.
  const turn = (deg) => { const a = deg * DEG; return [80 * Math.sqrt(2) * Math.sin(a), 80, 80 * Math.sqrt(2) * Math.cos(a)]; };
  assert.equal(needsRefit(fit, sliceOf(orbitCamera(turn(2), [0, 0, 0]).input)), false);
  assert.equal(needsRefit(fit, sliceOf(orbitCamera(turn(20), [0, 0, 0]).input)), false);
  // Panning 60 units (camera and target) leaves the padded sphere.
  assert.equal(needsRefit(fit, sliceOf(orbitCamera([60, 80, 80], [60, 0, 0]).input)), true);
  // Same slice depths but a much narrower field (zoomed in) wastes the map: refit.
  const narrow = { ...base, fov: 15 * DEG };
  assert.equal(needsRefit(fit, sliceOf(narrow)), true);
});

test("refits move a cascade by whole texels in light space", () => {
  const sunDirection = getSunVector({ altitude: 35 * DEG, azimuth: 120 * DEG });
  const { right, up } = lightBasis(sunDirection);
  const [a] = fitCascades({ camera: orbitCamera([0, 80, 80], [0, 0, 0]).input, sunDirection, mapSizes: [2048] });
  const [b] = fitCascades({ camera: orbitCamera([3.3, 80, 79], [3.3, 0, -1]).input, sunDirection, mapSizes: [2048] });
  assert.equal(a.radius, b.radius);
  for (const axis of [right, up]) {
    const shift = (b.centre[0] - a.centre[0]) * axis[0] + (b.centre[1] - a.centre[1]) * axis[1] + (b.centre[2] - a.centre[2]) * axis[2];
    const texels = shift / a.texel;
    assert.ok(Math.abs(texels - Math.round(texels)) < 1e-6, `shift ${texels} texels`);
  }
});

test("biases scale with the texel and the last cascade is the campus-wide box", () => {
  const sunDirection = getSunVector({ altitude: 35 * DEG, azimuth: 120 * DEG });
  const [near, far] = fitCascades({ camera: orbitCamera([-154.4, 96.4, -33.3], [-214.4, 46.4, -93.3]).input, sunDirection, mapSizes: [2048, 2048] });
  assert.ok(cascadeBias(near).normalBias < cascadeBias(far).normalBias);
  assert.ok(cascadeBias(near).bias < 0);
  const campus = campusCascade(sunDirection);
  assert.equal(campus.bounds, SHADOW_CAMERA_BOUNDS);
  assert.deepEqual(campus.target, [0, 0, 0]);
});

test("the cascade chunk wraps three's directional loop once and keeps the stock loop as the fallback", async () => {
  const { ShaderChunk } = await import("three");
  const stock = ShaderChunk.lights_fragment_begin.includes(CASCADE_CHUNK_MARKER) ? null : ShaderChunk.lights_fragment_begin;
  const chunks = { lights_fragment_begin: stock ?? ShaderChunk.lights_fragment_begin };
  const once = installCascadeShadowChunk(chunks);
  const twice = installCascadeShadowChunk(chunks);
  assert.equal(once, twice);
  assert.equal(once.split(CASCADE_CHUNK_MARKER + " = 1.0").length - 1, 1);
  if (stock) {
    // The stock directional loop survives verbatim in the #else branch.
    const loopStart = stock.indexOf("#pragma unroll_loop_start\n\tfor ( int i = 0; i < NUM_DIR_LIGHTS; i ++ )");
    assert.ok(loopStart > 0);
    const loop = stock.slice(loopStart, stock.indexOf("#pragma unroll_loop_end", loopStart));
    assert.ok(once.includes(loop));
    // Balanced preprocessor blocks.
    const count = (s, re) => (s.match(re) ?? []).length;
    assert.equal(count(once, /^\s*#if/gm) - count(stock, /^\s*#if/gm), 1);
    assert.equal(count(once, /^\s*#endif/gm) - count(stock, /^\s*#endif/gm), 1);
  }
  assert.throws(() => patchLightsFragmentBegin("void main() {}"), /not found/);
});

test("a fitted cascade coarser than the campus map is parked where no fragment can reach it", () => {
  const sunDirection = getSunVector({ altitude: 35 * DEG, azimuth: 120 * DEG });
  // Overview camera: the single medium cascade spans more than the campus.
  const [overview] = fitCascades({ camera: orbitCamera([0, 260, 260], [0, 0, 0]).input, sunDirection, mapSizes: [2048] });
  assert.equal(isUsefulCascade(overview, 2048), false);
  // D4 close-up: much finer than the campus map.
  const [close] = fitCascades({ camera: orbitCamera([-154.4, 96.4, -33.3], [-214.4, 46.4, -93.3]).input, sunDirection, mapSizes: [2048] });
  assert.ok(isUsefulCascade(close, 2048));
  const parked = parkCascade(overview, sunDirection);
  const shadow = shadowCamera(parked);
  for (const point of [[0, 0, 0], [300, 60, -200], [-250, 120, 180]]) assert.equal(inside(shadow, new THREE.Vector3(...point)), false);
  // Position-to-target keeps the sun direction (cascade 0 is the light that shades the campus).
  const toSun = new THREE.Vector3(...parked.position).sub(new THREE.Vector3(...parked.target)).normalize();
  assert.ok(toSun.distanceTo(new THREE.Vector3(...sunDirection).normalize()) < 1e-9);
  // Fitted cascades keep it too.
  const fitDirection = new THREE.Vector3(...close.position).sub(new THREE.Vector3(...close.target)).normalize();
  assert.ok(fitDirection.distanceTo(new THREE.Vector3(...sunDirection).normalize()) < 1e-9);
});

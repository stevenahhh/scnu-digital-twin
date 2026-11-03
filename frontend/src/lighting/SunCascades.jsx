import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { installCascadeShadowChunk } from "./cascadeShadowChunk.mjs";
import { campusCascade, cascadeBias, currentSlice, fitCascades, isUsefulCascade, needsRefit, parkCascade } from "./shadowCascades.mjs";
import { getShadowLightPosition } from "./shadowFrustum.mjs";

installCascadeShadowChunk();

// Campus-wide cascade biases: the values the single static map has used since U-series tuning (no acne at 2048).
const CAMPUS_BIAS = { bias: -0.0005, normalBias: 0.4 };
const SHADOW_RADIUS = 2;

const scratchForward = new THREE.Vector3();
const scratchTarget = new THREE.Vector3();

function placeLight(light, { position, target, bounds }, { bias, normalBias }) {
  light.position.set(position[0], position[1], position[2]);
  light.target.position.set(target[0], target[1], target[2]);
  light.updateMatrixWorld();
  light.target.updateMatrixWorld();
  const camera = light.shadow.camera;
  camera.left = bounds.left;
  camera.right = bounds.right;
  camera.top = bounds.top;
  camera.bottom = bounds.bottom;
  camera.near = bounds.near;
  camera.far = bounds.far;
  camera.updateProjectionMatrix();
  light.shadow.bias = bias;
  light.shadow.normalBias = normalBias;
  light.shadow.needsUpdate = true;
}

// Cascaded shadows for the sun light of CampusLighting. sunLightRef's light stays the only one that lights the
// scene and becomes cascade 0; this adds mapSizes.length - 1 intensity-0 shadow lights (fitted cascades, then
// the campus-wide one last). Their maps are re-rendered on demand: all of them when the sun moves, a fitted one
// when the camera leaves it. No cascade is rendered on a frame where neither happened.
export function SunCascades({ sunLightRef, controlsRef, sunVector, mapSizes, enabled = true }) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const fittedSizes = useMemo(() => mapSizes.slice(0, -1), [mapSizes]);
  const campusSize = mapSizes[mapSizes.length - 1];
  const extraLights = useMemo(() => mapSizes.slice(1).map((size, index) => {
    const light = new THREE.DirectionalLight(0xffffff, 0);
    light.name = `SunCascade${index + 1}`;
    light.castShadow = true;
    light.shadow.mapSize.set(size, size);
    light.shadow.radius = SHADOW_RADIUS;
    light.shadow.autoUpdate = false;
    return light;
  }), [mapSizes]);
  useEffect(() => () => extraLights.forEach((light) => light.dispose()), [extraLights]);
  const state = useRef({ sunKey: null, fits: [] });

  const sunKey = sunVector.join(",");
  // Same clamped direction as the static light (never below MIN_LIGHT_ALTITUDE), so lighting matches the low tier.
  const sunDirection = useMemo(() => getShadowLightPosition(sunVector), [sunVector]);
  useLayoutEffect(() => {
    const sun = sunLightRef.current;
    if (!sun) return undefined;
    sun.shadow.autoUpdate = false;
    sun.shadow.radius = SHADOW_RADIUS;
    state.current = { sunKey: null, fits: [] };
    invalidate();
    return () => {
      sun.shadow.autoUpdate = true;
    };
  }, [extraLights, invalidate, sunLightRef]);
  useEffect(() => {
    invalidate();
  }, [invalidate, sunKey, enabled]);

  // Lights of every cascade, finest first: the sun light, the other fitted ones, the campus-wide one.
  useFrame(({ camera }) => {
    const sun = sunLightRef.current;
    if (!sun || !enabled) return;
    const lights = [sun, ...extraLights];
    const current = state.current;
    const sunChanged = current.sunKey !== sunKey;
    camera.getWorldDirection(scratchForward);
    const target = controlsRef?.current?.target ?? scratchTarget.set(0, 0, 0);
    const targetDistance = camera.position.distanceTo(target);
    const cameraInput = {
      position: camera.position.toArray(),
      forward: scratchForward.toArray(),
      fov: THREE.MathUtils.degToRad(camera.fov),
      aspect: camera.aspect,
      near: camera.near,
      targetDistance,
    };
    let changed = false;
    if (sunChanged) {
      current.sunKey = sunKey;
      placeLight(lights[lights.length - 1], campusCascade(sunVector), CAMPUS_BIAS);
      lights[lights.length - 1].shadow.mapSize.set(campusSize, campusSize);
      current.fits = [];
      changed = true;
    }
    const fresh = fitCascades({ camera: cameraInput, sunDirection, mapSizes: fittedSizes });
    fresh.forEach((fit, index) => {
      const old = current.fits[index];
      const slice = old ? currentSlice({ cameraPosition: cameraInput.position, cameraForward: cameraInput.forward, fov: cameraInput.fov, aspect: cameraInput.aspect, near: fit.slice.near, far: fit.slice.far }) : null;
      if (old && !needsRefit(old, slice)) return;
      const useful = isUsefulCascade(fit, campusSize);
      // A parked cascade only needs a new pass when it was in use before (its map must stop covering the view).
      current.fits[index] = useful ? fit : { ...fit, parked: true };
      if (!useful && old?.parked) return;
      placeLight(lights[index], useful ? fit : parkCascade(fit, sunDirection), cascadeBias(fit));
      changed = true;
    });
    if (changed) gl.shadowMap.needsUpdate = true;
  });

  return (
    <group name="SunCascades">
      {extraLights.map((light) => <primitive key={light.uuid} object={light} />)}
    </group>
  );
}

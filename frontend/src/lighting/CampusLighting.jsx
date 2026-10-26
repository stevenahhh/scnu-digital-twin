import { useLayoutEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import * as THREE from "three";
import { CAMPUS_FOG_DENSITY, NIGHT_SKY_SRGB, getFogColor, getSkyNightMix } from "./atmosphere.mjs";
import { SHADOW_CAMERA_BOUNDS, getShadowLightPosition } from "./shadowFrustum.mjs";
import { capShadowMapSizes } from "./shadowCascades.mjs";
import { SunCascades } from "./SunCascades";
import { applySkyNightFade } from "./skyNightFade.mjs";
import { SkyEnvironment } from "./SkyEnvironment";
import { SUN_ALTITUDE_KEY, getDaylightWeight, getSkySunAltitude } from "./season.mjs";

// Neutral keeps saturated facade colours from clipping the way ACES does; output stays sRGB.
export const CAMPUS_CANVAS_GL = { toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0 };

const SKY_TURBIDITY = 8;
const SKY_RAYLEIGH = 0.7;
// Tuned together at 15:00 KST: with the sky environment at 0.9 the sun was too weak against the
// sky's diffuse light and building shadows disappeared; 4.0 / 0.45 keeps the same overall brightness.
// Those were three r163 values. r186 takes the specular share out of direct and ambient diffuse light and
// prefilters the sky environment with GGX instead of a Gaussian blur. Measured on the A8 views (linear
// radiance, r163 vs r186): sun -3.3 %, ambient and hemisphere -2.5 %, environment +3 to +12 % (+8.5 % at
// the default camera). The sun, environment, ambient and night-fill levels below are the r163 ones scaled
// by x1.033, x0.93 and x1.025 so the picture stays the same.
const SUN_INTENSITY = 4.13;
const SKY_ENVIRONMENT_INTENSITY = 0.42;
// Twilight fades the sun out and blends the ambient between the day and night levels with
// getDaylightWeight (full above 6 deg, zero at -6 deg) instead of switching at 0 deg. The sun light never
// goes below MIN_LIGHT_ALTITUDE (getShadowLightPosition) and has no night level: a key that followed the
// sun under the horizon lit slopes from below the ground and threw building shadows up the hillside.
const DAY_AMBIENT = 0.154;
const NIGHT_AMBIENT = 0.051;
// Without the sun, roads, lawns and roofs fall to the night ambient (near-black). A cool sky / dark ground
// hemisphere fill (moon and sky-glow stand-in, not a measured night level) fades in as daylight fades,
// so the road layout still reads at night. Emissive windows and the additive lamp pools are unaffected
// by it and keep their contrast.
const NIGHT_FILL_SKY = "#9fb4d6";
const NIGHT_FILL_GROUND = "#3a342c";
const NIGHT_FILL_INTENSITY = 0.92;

const isMobileDevice = () =>
  typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);

// shadowMapSizes is the render-quality tier's request (QUALITY_RENDERER): one size is the single static campus-wide map,
// two or more are sun cascades (SunCascades), finest first. The device limit and the mobile cap still apply.
export function CampusLighting({ sunVector, sunAltitude, shadowMapSizes: requestedShadowMapSizes = [1024], controlsRef }) {
  const gl = useThree((state) => state.gl);
  const maxTextureSize = gl.capabilities.maxTextureSize;
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const sunLightRef = useRef(null);
  const skyRef = useRef(null);
  const skyNightMix = getSkyNightMix(sunAltitude);
  // The visible dome fades to the sRGB night fog colour (it is drawn to the screen after encoding).
  useLayoutEffect(() => {
    applySkyNightFade(skyRef.current.material, NIGHT_SKY_SRGB).skyNightMix.value = skyNightMix;
    invalidate();
  }, [invalidate, skyNightMix]);
  // CityModel reads the same altitude for its window-glow and night-tint ramps.
  useLayoutEffect(() => {
    scene.userData[SUN_ALTITUDE_KEY] = sunAltitude;
  }, [scene, sunAltitude]);
  useLayoutEffect(() => () => {
    delete scene.userData[SUN_ALTITUDE_KEY];
  }, [scene]);
  const daylight = getDaylightWeight(sunAltitude);
  // Same azimuth, twilight-stretched altitude for the sky dome and the sky environment light.
  const skySunVector = useMemo(() => {
    const skyAltitude = getSkySunAltitude(sunAltitude);
    if (skyAltitude === sunAltitude) return sunVector;
    const [x, , z] = sunVector;
    const horizontal = Math.hypot(x, z) || 1;
    const cos = Math.cos(skyAltitude);
    return [(x / horizontal) * cos, Math.sin(skyAltitude), (z / horizontal) * cos];
  }, [sunAltitude, sunVector]);
  const shadowMapSizes = useMemo(
    () => capShadowMapSizes(requestedShadowMapSizes, { maxTextureSize, isMobile: isMobileDevice() }),
    [maxTextureSize, requestedShadowMapSizes],
  );
  const cascaded = shadowMapSizes.length > 1;
  // three (r163 and r186 alike) allocates a shadow map once and never resizes it. A tier change remounts the sun light
  // (key), which disposes the old map; the next shadow pass allocates the new one.
  const shadowKey = `${cascaded ? "cascades" : "static"}-${shadowMapSizes.join("x")}`;
  useLayoutEffect(() => {
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [gl, invalidate, shadowKey]);
  const lightPosition = useMemo(() => getShadowLightPosition(sunVector), [sunVector]);

  return (
    <>
      <fogExp2 attach="fog" args={[getFogColor(sunAltitude), CAMPUS_FOG_DENSITY]} />
      <ambientLight intensity={NIGHT_AMBIENT + (DAY_AMBIENT - NIGHT_AMBIENT) * daylight} />
      <hemisphereLight args={[NIGHT_FILL_SKY, NIGHT_FILL_GROUND, NIGHT_FILL_INTENSITY * (1 - daylight)]} />
      {cascaded ? (
        <directionalLight
          key={`sun-${shadowKey}`}
          ref={sunLightRef}
          castShadow
          intensity={SUN_INTENSITY * daylight}
          position={lightPosition}
          shadow-mapSize={[shadowMapSizes[0], shadowMapSizes[0]]}
        />
      ) : (
        <directionalLight
          key={`sun-${shadowKey}`}
          ref={sunLightRef}
          castShadow
          intensity={SUN_INTENSITY * daylight}
          position={lightPosition}
          shadow-mapSize={[shadowMapSizes[0], shadowMapSizes[0]]}
          shadow-camera-left={SHADOW_CAMERA_BOUNDS.left}
          shadow-camera-right={SHADOW_CAMERA_BOUNDS.right}
          shadow-camera-top={SHADOW_CAMERA_BOUNDS.top}
          shadow-camera-bottom={SHADOW_CAMERA_BOUNDS.bottom}
          shadow-camera-near={SHADOW_CAMERA_BOUNDS.near}
          shadow-camera-far={SHADOW_CAMERA_BOUNDS.far}
          shadow-bias={-0.0005}
          shadow-normalBias={0.4}
          shadow-radius={2}
        />
      )}
      {cascaded ? (
        <SunCascades
          key={`cascades-${shadowKey}`}
          sunLightRef={sunLightRef}
          controlsRef={controlsRef}
          sunVector={sunVector}
          mapSizes={shadowMapSizes}
          enabled={daylight > 0}
        />
      ) : null}
      <Sky ref={skyRef} distance={450000} sunPosition={skySunVector} turbidity={SKY_TURBIDITY} rayleigh={SKY_RAYLEIGH} />
      <SkyEnvironment
        sunPosition={skySunVector}
        turbidity={SKY_TURBIDITY}
        rayleigh={SKY_RAYLEIGH}
        intensity={SKY_ENVIRONMENT_INTENSITY}
        nightMix={skyNightMix}
      />
    </>
  );
}

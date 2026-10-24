import { useLayoutEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import * as THREE from "three";
import { CAMPUS_FOG_DENSITY, getFogColor } from "./atmosphere.mjs";
import { SHADOW_CAMERA_BOUNDS, SHADOW_LIGHT_DISTANCE, getShadowMapSize } from "./shadowFrustum.mjs";
import { SkyEnvironment } from "./SkyEnvironment";
import { SUN_ALTITUDE_KEY, getDaylightWeight, getSkySunAltitude } from "./season.mjs";

// Neutral keeps saturated facade colours from clipping the way ACES does; output stays sRGB.
export const CAMPUS_CANVAS_GL = { toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0 };

const SKY_TURBIDITY = 8;
const SKY_RAYLEIGH = 0.7;
// Tuned together at 15:00 KST: with the sky environment at 0.9 the sun was too weak against the
// sky's diffuse light and building shadows disappeared; 4.0 / 0.45 keeps the same overall brightness.
const SUN_INTENSITY = 4.0;
const SKY_ENVIRONMENT_INTENSITY = 0.45;
// Night levels (moonlight-ish key, dim ambient). Twilight blends sun and ambient between the day and
// night levels with getDaylightWeight (full above 6 deg, night at -6 deg) instead of switching at 0 deg.
const NIGHT_SUN_INTENSITY = 0.35;
const DAY_AMBIENT = 0.15;
const NIGHT_AMBIENT = 0.05;
// After sunset the directional light follows the sun below the horizon, so it lights the ground from
// underneath and roads, lawns and roofs fall to the 0.05 ambient (near-black). A cool sky / dark ground
// hemisphere fill (moon and sky-glow stand-in, not a measured night level) fades in as daylight fades,
// so the road layout still reads at night. Emissive windows and the additive lamp pools are unaffected
// by it and keep their contrast.
const NIGHT_FILL_SKY = "#9fb4d6";
const NIGHT_FILL_GROUND = "#3a342c";
const NIGHT_FILL_INTENSITY = 0.9;

const isMobileDevice = () =>
  typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);

// shadowMapSize is the render-quality tier's request (QUALITY_RENDERER); the device limit still caps it.
export function CampusLighting({ sunVector, sunAltitude, shadowMapSize: requestedShadowMapSize }) {
  const gl = useThree((state) => state.gl);
  const maxTextureSize = gl.capabilities.maxTextureSize;
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const sunLightRef = useRef(null);
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
  const shadowMapSize = useMemo(() => {
    const deviceLimit = getShadowMapSize({ maxTextureSize, isMobile: isMobileDevice() });
    return Math.min(requestedShadowMapSize ?? deviceLimit, deviceLimit);
  }, [maxTextureSize, requestedShadowMapSize]);
  // three r163 allocates the shadow map once and never resizes it, and ShadowBaker keeps the map frozen.
  // On a tier change drop the old map so the next (re-baked) shadow pass allocates it at the new size.
  useLayoutEffect(() => {
    const shadow = sunLightRef.current?.shadow;
    if (shadow?.map) {
      shadow.map.dispose();
      shadow.map = null;
    }
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [gl, invalidate, shadowMapSize]);
  const lightPosition = useMemo(() => {
    const length = Math.hypot(...sunVector) || 1;
    return sunVector.map((v) => (v / length) * SHADOW_LIGHT_DISTANCE);
  }, [sunVector]);

  return (
    <>
      <fogExp2 attach="fog" args={[getFogColor(sunAltitude), CAMPUS_FOG_DENSITY]} />
      <ambientLight intensity={NIGHT_AMBIENT + (DAY_AMBIENT - NIGHT_AMBIENT) * daylight} />
      <hemisphereLight args={[NIGHT_FILL_SKY, NIGHT_FILL_GROUND, NIGHT_FILL_INTENSITY * (1 - daylight)]} />
      <directionalLight
        ref={sunLightRef}
        castShadow
        intensity={NIGHT_SUN_INTENSITY + (SUN_INTENSITY - NIGHT_SUN_INTENSITY) * daylight}
        position={lightPosition}
        shadow-mapSize={[shadowMapSize, shadowMapSize]}
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
      <Sky distance={450000} sunPosition={skySunVector} turbidity={SKY_TURBIDITY} rayleigh={SKY_RAYLEIGH} />
      <SkyEnvironment sunPosition={skySunVector} turbidity={SKY_TURBIDITY} rayleigh={SKY_RAYLEIGH} intensity={SKY_ENVIRONMENT_INTENSITY} />
    </>
  );
}

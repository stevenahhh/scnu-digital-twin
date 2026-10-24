import { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import * as THREE from "three";
import { CAMPUS_FOG_DENSITY, getFogColor } from "./atmosphere.mjs";
import { SHADOW_CAMERA_BOUNDS, SHADOW_LIGHT_DISTANCE, getShadowMapSize } from "./shadowFrustum.mjs";
import { SkyEnvironment } from "./SkyEnvironment";

// Neutral keeps saturated facade colours from clipping the way ACES does; output stays sRGB.
export const CAMPUS_CANVAS_GL = { toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0 };

const SKY_TURBIDITY = 8;
const SKY_RAYLEIGH = 0.7;
// Tuned together at 15:00 KST: with the sky environment at 0.9 the sun was too weak against the
// sky's diffuse light and building shadows disappeared; 4.0 / 0.45 keeps the same overall brightness.
const SUN_INTENSITY = 4.0;
const SKY_ENVIRONMENT_INTENSITY = 0.45;

const isMobileDevice = () =>
  typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);

export function CampusLighting({ sunVector, sunVisible, sunAltitude }) {
  const maxTextureSize = useThree((state) => state.gl.capabilities.maxTextureSize);
  const shadowMapSize = useMemo(
    () => getShadowMapSize({ maxTextureSize, isMobile: isMobileDevice() }),
    [maxTextureSize],
  );
  const lightPosition = useMemo(() => {
    const length = Math.hypot(...sunVector) || 1;
    return sunVector.map((v) => (v / length) * SHADOW_LIGHT_DISTANCE);
  }, [sunVector]);

  return (
    <>
      <fogExp2 attach="fog" args={[getFogColor(sunAltitude), CAMPUS_FOG_DENSITY]} />
      <ambientLight intensity={sunVisible ? 0.15 : 0.05} />
      <directionalLight
        castShadow
        intensity={sunVisible ? SUN_INTENSITY : 0.35}
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
      <Sky distance={450000} sunPosition={sunVector} turbidity={SKY_TURBIDITY} rayleigh={SKY_RAYLEIGH} />
      <SkyEnvironment sunPosition={sunVector} turbidity={SKY_TURBIDITY} rayleigh={SKY_RAYLEIGH} intensity={SKY_ENVIRONMENT_INTENSITY} />
    </>
  );
}

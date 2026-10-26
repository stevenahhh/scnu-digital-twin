import { useEffect, useLayoutEffect } from "react";
import { useThree } from "@react-three/fiber";

// Freezes the shadow map: it is rendered once when this mounts (place it after the model inside the
// same Suspense, so mounting means the model is in the scene) and again shortly after the sun
// settles, instead of on every frame. Same idea as drei's <BakeShadows>, plus a debounced re-bake.
// Sun cascades (SunCascades) turn their per-light autoUpdate off and re-render themselves when the sun or the camera
// moves, so the mount bake (model just arrived) flags every shadow-casting light; the debounced sun re-bake only
// reaches lights that keep autoUpdate (the low tier's static map).
function markAllShadows(scene) {
  scene.traverse((object) => {
    if (object.isLight && object.castShadow && object.shadow) object.shadow.needsUpdate = true;
  });
}

export function ShadowBaker({ sunKey, delayMs = 200 }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);

  useLayoutEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    markAllShadows(scene);
    invalidate();
    return () => {
      gl.shadowMap.autoUpdate = true;
      gl.shadowMap.needsUpdate = true;
    };
  }, [gl, invalidate, scene]);

  useEffect(() => {
    const timer = setTimeout(() => {
      gl.shadowMap.needsUpdate = true;
      invalidate();
    }, delayMs);
    return () => clearTimeout(timer);
  }, [gl, invalidate, sunKey, delayMs]);

  return null;
}

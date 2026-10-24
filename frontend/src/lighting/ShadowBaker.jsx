import { useEffect, useLayoutEffect } from "react";
import { useThree } from "@react-three/fiber";

// Freezes the shadow map: it is rendered once when this mounts (place it after the model inside the
// same Suspense, so mounting means the model is in the scene) and again shortly after the sun
// settles, instead of on every frame. Same idea as drei's <BakeShadows>, plus a debounced re-bake.
export function ShadowBaker({ sunKey, delayMs = 200 }) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  useLayoutEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    invalidate();
    return () => {
      gl.shadowMap.autoUpdate = true;
      gl.shadowMap.needsUpdate = true;
    };
  }, [gl, invalidate]);

  useEffect(() => {
    const timer = setTimeout(() => {
      gl.shadowMap.needsUpdate = true;
      invalidate();
    }, delayMs);
    return () => clearTimeout(timer);
  }, [gl, invalidate, sunKey, delayMs]);

  return null;
}

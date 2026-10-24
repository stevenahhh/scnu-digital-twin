import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";

// Image-based fill light that follows the sun: an offscreen copy of the visible Sky is prefiltered
// with PMREMGenerator into scene.environment. Re-rendered at most every throttleMs while the sun moves.
// The copy drops the sun disc: the shadow-casting directional light already is the sun, and the
// disc's ~19000x radiance would come back as unshadowed diffuse light and wash out every shadow.
export function SkyEnvironment({ sunPosition, turbidity = 8, rayleigh = 0.7, intensity = 0.9, throttleMs = 250 }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const targetRef = useRef(null);
  const lastRenderRef = useRef(-Infinity);

  const pmrem = useMemo(() => new THREE.PMREMGenerator(gl), [gl]);
  const sky = useMemo(() => {
    const object = new Sky();
    object.scale.setScalar(450000);
    if (object.material.uniforms.showSunDisc) {
      object.material.uniforms.showSunDisc.value = false;
    } else {
      object.material.fragmentShader = object.material.fragmentShader.replace(
        "L0 += ( vSunE * 19000.0 * Fex ) * sundisk;",
        "",
      );
    }
    return object;
  }, []);
  const envScene = useMemo(() => new THREE.Scene().add(sky), [sky]);

  useEffect(() => {
    pmrem.compileCubemapShader();
    return () => {
      if (scene.environment === targetRef.current?.texture) scene.environment = null;
      targetRef.current?.dispose();
      targetRef.current = null;
      pmrem.dispose();
    };
  }, [pmrem, scene]);

  useEffect(() => () => {
    sky.geometry.dispose();
    sky.material.dispose();
  }, [sky]);

  const [sunX, sunY, sunZ] = sunPosition;
  useEffect(() => {
    const render = () => {
      lastRenderRef.current = performance.now();
      const uniforms = sky.material.uniforms;
      uniforms.sunPosition.value.set(sunX, sunY, sunZ);
      uniforms.turbidity.value = turbidity;
      uniforms.rayleigh.value = rayleigh;
      const previous = targetRef.current;
      targetRef.current = pmrem.fromScene(envScene, 0, 0.1, 1e6);
      scene.environment = targetRef.current.texture;
      scene.environmentIntensity = intensity;
      previous?.dispose();
      invalidate();
    };
    const wait = throttleMs - (performance.now() - lastRenderRef.current);
    if (wait <= 0) {
      render();
      return undefined;
    }
    const timer = setTimeout(render, wait);
    return () => clearTimeout(timer);
  }, [envScene, intensity, invalidate, pmrem, rayleigh, scene, sky, sunX, sunY, sunZ, throttleMs, turbidity]);

  return null;
}

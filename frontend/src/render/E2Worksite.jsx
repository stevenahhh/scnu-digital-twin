import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Component, Suspense, useEffect, useRef } from "react";
import { AnimationMixer, Vector3 } from "three";
import { POINTER_EXCLUDED_LAYER } from "./canvasLifecycle.mjs";
import { attachLayerPlayback, layerPaused, pointInView } from "./layerPlayback.mjs";

// A removable layer in the detailed campus frame. Its GLB also contains the
// animation so exporting the full model does not depend on the web renderer.
const LAYER_URL = "/campus-e2-worksite.glb";

export class E2Worksite extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) {
    console.warn("기초교육관 공사장 모형을 불러오지 못했습니다.", error);
    useGLTF.clear(LAYER_URL);
  }
  render() {
    return this.state.failed ? null : <Suspense fallback={null}><WorksiteLayer {...this.props} /></Suspense>;
  }
}

function WorksiteLayer({ obscured, controlsRef }) {
  const { scene, animations, nodes } = useGLTF(LAYER_URL);
  const { gl, invalidate } = useThree();
  const playback = useRef(null);
  useEffect(() => {
    const mixer = new AnimationMixer(scene);
    mixer.clipAction(animations[0]).play();
    mixer.update(0);
    scene.traverse(child => {
      if (!child.isMesh) return;
      child.layers.set(POINTER_EXCLUDED_LAYER);
      child.castShadow = child.receiveShadow = true;
    });
    const state = Object.assign(attachLayerPlayback(gl, invalidate), { mixer, position: new Vector3(), orbit: null, originalMin: 0 });
    playback.current = state;
    invalidate();
    return () => {
      playback.current = null;
      if (state.orbit) state.orbit.minDistance = state.originalMin;
      state.dispose();
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
    };
  }, [scene, animations, gl, invalidate]);
  useFrame(({ camera }, dt) => {
    const s = playback.current;
    if (!s) return;
    nodes.E2_Builder.getWorldPosition(s.position);
    s.position.y += 1;
    const orbit = controlsRef?.current;
    if (orbit && orbit !== s.orbit) {
      s.orbit = orbit;
      s.originalMin = orbit.minDistance;
    }
    // Let visitors orbit down to the workbench without changing campus-wide zoom.
    if (orbit) orbit.minDistance = orbit.target.distanceToSquared(s.position) < 35 ** 2 ? Math.min(6.5, s.originalMin)
      : Math.min(s.originalMin, camera.position.distanceTo(orbit.target));
    if (layerPaused(s, obscured) || !pointInView(s.position, camera, 125)) return;
    s.mixer.update(Math.min(dt, .08));
    invalidate();
  });
  return <primitive object={scene} />;
}

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Component, Suspense, useEffect, useRef } from "react";
import { AnimationMixer, CanvasTexture, MeshBasicMaterial, MeshStandardMaterial, SRGBColorSpace, Vector3 } from "three";
import { POINTER_EXCLUDED_LAYER } from "./canvasLifecycle.mjs";
import { attachLayerPlayback, layerPaused, pointInView } from "./layerPlayback.mjs";
import { POSTER_DESIGNS, PROMO_FONT, drawPoster, drawScreen, screenFrame } from "./medPromo/promoArt.mjs";

// 의대 유치 홍보 층(scripts/campus-model/med-promo.mjs가 만든 GLB): 캠퍼스 현수막 판의 포스터, 정문 SCNU 글자 위
// 전광판, 피켓을 흔들며 정문 광장을 도는 세 사람. 포스터와 전광판 화면은 promoArt.mjs가 캔버스에 그린다.
const LAYER_URL = "/campus-med-promo.glb";
const SCREEN_SIZE = [1664, 512];
const SCREEN_FPS = 30;
const PLAY_DISTANCE = 260;

export class MedPromo extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) {
    console.warn("의대 유치 홍보물 모형을 불러오지 못했습니다.", error);
    useGLTF.clear(LAYER_URL);
  }
  render() {
    return this.state.failed ? null : <Suspense fallback={null}><MedPromoLayer {...this.props} /></Suspense>;
  }
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  const paint = () => {
    draw(canvas.getContext("2d"), width, height);
    texture.needsUpdate = true;
  };
  paint();
  return { texture, paint };
}

function MedPromoLayer({ obscured }) {
  const { scene, animations, nodes } = useGLTF(LAYER_URL);
  const { gl, invalidate } = useThree();
  const playback = useRef(null);
  useEffect(() => {
    const paints = [];
    const owned = [];
    let paintScreen = null;
    scene.traverse((child) => {
      if (!child.isMesh) return;
      child.layers.set(POINTER_EXCLUDED_LAYER);
      child.castShadow = child.receiveShadow = true;
      const name = child.material?.name ?? "";
      if (name.startsWith("MP_Poster_")) {
        const design = POSTER_DESIGNS[Number(name.slice("MP_Poster_".length))];
        const { widthM = 4, panelM = 1.3 } = child.userData;
        const height = Math.max(256, Math.round((1024 * panelM) / widthM));
        const poster = canvasTexture(1024, height, (ctx, w, h) => drawPoster(ctx, design, w, h));
        child.material = new MeshStandardMaterial({ map: poster.texture, roughness: 0.62, metalness: 0 });
        child.castShadow = false;
        paints.push(poster.paint);
        owned.push(child.material, poster.texture);
      } else if (name === "MP_Screen") {
        const led = canvasTexture(...SCREEN_SIZE, (ctx, w, h) => drawScreen(ctx, screenFrame(playback.current?.time ?? 0), w, h));
        child.material = new MeshBasicMaterial({ map: led.texture, toneMapped: false });
        child.castShadow = false;
        paintScreen = led.paint;
        paints.push(led.paint);
        owned.push(child.material, led.texture);
      }
    });
    const mixer = new AnimationMixer(scene);
    for (const clip of animations) mixer.clipAction(clip).play();
    mixer.update(0);
    const face = nodes.MP_GateScreen_Face;
    face.geometry.computeBoundingSphere();
    const state = Object.assign(attachLayerPlayback(gl, invalidate), {
      mixer, time: 0, sinceScreen: 0, anchor: new Vector3(), faceCentre: face.geometry.boundingSphere.center.clone(), paintScreen,
    });
    playback.current = state;
    let live = true;
    document.fonts?.load(`900 64px ${PROMO_FONT}`).then(() => {
      if (!live) return;
      paints.forEach((paint) => paint());
      invalidate();
    });
    invalidate();
    return () => {
      live = false;
      playback.current = null;
      state.dispose();
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      owned.forEach((item) => item.dispose());
    };
  }, [scene, animations, nodes, gl, invalidate]);
  useFrame(({ camera }, dt) => {
    const s = playback.current;
    if (!s) return;
    s.anchor.copy(s.faceCentre).applyMatrix4(nodes.MP_GateScreen_Face.matrixWorld);
    if (layerPaused(s, obscured) || !pointInView(s.anchor, camera, PLAY_DISTANCE)) return;
    const step = Math.min(dt, 0.08);
    s.time += step;
    s.mixer.update(step);
    s.sinceScreen += step;
    if (s.sinceScreen >= 1 / SCREEN_FPS) {
      s.sinceScreen = 0;
      s.paintScreen?.();
    }
    invalidate();
  });
  return <primitive object={scene} />;
}

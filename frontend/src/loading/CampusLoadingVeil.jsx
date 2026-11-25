import { useEffect, useRef, useState } from "react";
import { getClearColor } from "../lighting/atmosphere.mjs";
import { CAMPUS_HEIGHTFIELD_URLS, loadHeightfield } from "../terrain/heightfield.mjs";
import { CAMPUS_LOCATION, getSunState } from "../utils/sunPosition.mjs";
import { approach, campusLoad, overallProgress, revealSeconds } from "./campusLoad.mjs";
import { sceneView } from "./sceneView.mjs";
import { createVeilRenderer } from "./veilRenderer.mjs";
import { initialPose, viewFromCamera, viewFromPose } from "./veilView.mjs";

const PROGRESS_TAU_S = 0.35;
const READY_PROGRESS = 0.985;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

// 로그인 화면 뒤에서 시작해 3D 장면이 뜰 때까지 이어지는 막. 고정 이미지 없이 실제 지형, 받은 바이트, 지금 태양 고도로 매 프레임 계산해 그린다.
// 시점은 장면의 카메라를 매 프레임 그대로 읽는다(캔버스가 생기기 전에는 주소의 시점). 그래서 등고선이 드러나는 지형과 같은 자리에 놓인다.
// finish가 켜지면 파면을 끝까지 보낸 뒤 캠퍼스 중심부터 걷혀 같은 시점의 실제 장면을 드러내고 onDone을 부른다.
export function CampusLoadingVeil({ finish, onDone }) {
  const canvasRef = useRef(null);
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const [plain, setPlain] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const reduced = Boolean(window.matchMedia?.(REDUCED_MOTION).matches);
    const { altitude } = getSunState({ date: new Date(), ...CAMPUS_LOCATION });
    const primary = getComputedStyle(document.documentElement).getPropertyValue("--colors-primary").trim();
    let renderer = null;
    try {
      renderer = createVeilRenderer(canvas, { background: getClearColor(altitude), primary });
    } catch (error) {
      console.warn(`loading veil shader unavailable: ${error.message}`);
    }
    if (!renderer) {
      setPlain(true);
      return undefined;
    }
    let disposed = false;
    let frame = 0;
    let last = performance.now();
    let time = Math.random() * 100;
    let progress = 0;
    let reveal = 0;
    const pose = initialPose(window.location.search);
    loadHeightfield(CAMPUS_HEIGHTFIELD_URLS).then((field) => {
      if (field && !disposed) renderer.setField(field);
    });
    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!reduced) time += dt;
      const target = finishRef.current ? 1 : overallProgress(campusLoad.getState(), Date.now());
      progress = reduced ? target : approach(progress, target, dt, PROGRESS_TAU_S);
      if (finishRef.current && progress >= READY_PROGRESS) reveal = Math.min(1, reveal + dt / revealSeconds(innerWidth, innerHeight, reduced));
      const view = sceneView.camera ? viewFromCamera(sceneView.camera) : viewFromPose(pose, innerWidth / innerHeight);
      renderer.draw({ time, progress, reveal, view });
      if (reveal >= 1) doneRef.current?.();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    if (!plain || !finish) return undefined;
    const timer = window.setTimeout(() => doneRef.current?.(), 300);
    return () => window.clearTimeout(timer);
  }, [finish, plain]);

  if (plain) {
    return <div aria-hidden="true" data-qa="loading-veil" className={`pointer-events-none fixed inset-0 z-[40] bg-canvas transition-opacity duration-surface ${finish ? "opacity-0" : ""}`} />;
  }
  return <canvas ref={canvasRef} aria-hidden="true" data-qa="loading-veil" className="pointer-events-none fixed inset-0 z-[40] h-full w-full" />;
}

import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";

// 의대 예정 부지 모형(scripts/campus-model/med-campus.mjs). 캠퍼스 모형 대신 마운트되고, 처음 뜰 때 병원과 의학관이
// 함께 보이는 남서쪽 위 시점으로 카메라를 옮긴다.
export const MED_SITE_URL = "/campus-med-site.glb";
const VIEW = { position: [-160, 140, 220], target: [-10, 30, 10] };

export function MedSiteScene({ controlsRef }) {
  const { scene } = useGLTF(MED_SITE_URL);
  const { camera, invalidate } = useThree();
  useEffect(() => {
    scene.traverse((child) => {
      if (!child.isMesh) return;
      child.receiveShadow = true;
      child.castShadow = child.name !== "MS_Terrain";
    });
  }, [scene]);
  useEffect(() => {
    camera.position.set(...VIEW.position);
    const controls = controlsRef?.current;
    if (controls) {
      controls.target.set(...VIEW.target);
      controls.update();
    } else camera.lookAt(...VIEW.target);
    invalidate();
  }, [camera, controlsRef, invalidate]);
  return <primitive object={scene} />;
}

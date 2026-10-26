import { Suspense, lazy, memo, useEffect } from "react";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { CityModel } from "../CityModel";
import { CAMPUS_MODEL_URL } from "../campusModelAsset.mjs";
import { CampusLighting } from "../lighting/CampusLighting";
import { ShadowBaker } from "../lighting/ShadowBaker";
import { SUN_DISC_HEX } from "../lighting/sceneBackground.mjs";
import { SceneWeatherBinding } from "../weather/SceneWeatherBinding";
import { CampusTrafficSimulation } from "../simulation";

// 모델 응답이 멈췄을 때 다시 시도: 캐시된 요청을 지우면, attempt로 다시 마운트된 Suspense가 GLB를 새로 받는다(페이지는 새로 읽지 않는다).
export function clearCampusModel() {
  useGLTF.clear(CAMPUS_MODEL_URL);
}

// 보통/높음 품질의 후처리 청크. 낮음에서는 마운트하지 않으므로 내려받지도 않는다.
const HighTierEffects = lazy(() => import("../postfx/HighTierEffects"));

// Canvas 안쪽 Suspense의 fallback으로 마운트되어 있는 동안만 DOM 쪽 로딩 표시를 켠다.
// R3F 트리 안에서는 DOM 요소를 그릴 수 없으므로 상태만 바깥으로 올린다.
function SceneLoadingSignal({ onChange }) {
  useEffect(() => {
    onChange(true);
    return () => onChange(false);
  }, [onChange]);
  return null;
}

// 3D 캠퍼스 장면(R3F Canvas의 자식). 값이 실제로 바뀔 때만 다시 그리도록 memo로 감싼다: 장면 트리가 다시 그려지면
// 인라인 이벤트 핸들러가 바뀐 것으로 보고 R3F가 invalidate해서 demand 루프가 한 장을 더 그린다.
export const CampusScene = memo(function CampusScene({
  background, sunVector, sunVisible, sunAltitude, weatherScene, quality, shadowMapSizes,
  controlsRef, selectedId, labelsHidden, occluderRef, chromeRefs,
  activePresetId, selectedElementId, selectionOutline, onLabelRegistry, onDragStart, headlineById,
  onSelect, onBuildingClick, onBuildingProximity, onD4Enter, onOrbitStart, onOrbitEnd, onLoadingChange, attempt = 0, presentation = false,
}) {
  return (
    <>
      <color attach="background" args={[background]} />
      <CampusLighting
        sunVector={sunVector}
        sunVisible={sunVisible}
        sunAltitude={sunAltitude}
        shadowMapSizes={shadowMapSizes}
        controlsRef={controlsRef}
      />
      <SceneWeatherBinding
        sunIntensityScale={weatherScene.sunIntensityScale}
        fogDensityScale={weatherScene.fogDensityScale}
        turbidityDelta={weatherScene.turbidityDelta}
        ambientScale={weatherScene.ambientScale}
      />
      {sunVisible && (
        <mesh position={sunVector.map((v) => v * 100)}>
          <sphereGeometry args={[10, 32, 32]} />
          <meshBasicMaterial color={SUN_DISC_HEX} />
        </mesh>
      )}
      <Suspense key={attempt} fallback={<SceneLoadingSignal onChange={onLoadingChange} />}>
        <CityModel
          position={[0, 0, 0]}
          controlsRef={controlsRef}
          isNight={!sunVisible}
          selectedId={selectedId}
          onSelect={onSelect}
          onBuildingClick={onBuildingClick}
          onBuildingProximity={onBuildingProximity}
          onD4Enter={onD4Enter}
          labelsHidden={labelsHidden}
          occluderRef={occluderRef}
          chromeRefs={chromeRefs}
          activePresetId={activePresetId}
          selectedElementId={selectedElementId}
          selectionOutline={selectionOutline}
          onLabelRegistry={onLabelRegistry}
          onDragStart={onDragStart}
          headlineById={headlineById}
          presentation={presentation}
        />
        <CampusTrafficSimulation contactShadows={quality === "high"} />
        <ShadowBaker sunKey={sunVector.join(",")} />
      </Suspense>
      <OrbitControls
        ref={controlsRef}
        onStart={onOrbitStart}
        onEnd={onOrbitEnd}
        enableDamping
        dampingFactor={0.05}
        enableZoom
        zoomSpeed={1}
        minDistance={30}
        maxDistance={520}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.2}
        target={[0, 0, 0]}
      />
      {quality !== "low" && (
        <Suspense fallback={null}>
          <HighTierEffects tier={quality} sunAltitude={sunAltitude} selectedElementId={selectedElementId} />
        </Suspense>
      )}
    </>
  );
});

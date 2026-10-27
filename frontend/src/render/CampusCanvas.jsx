import { forwardRef, useMemo } from "react";
import { useCameraKeys } from "../camera/useCameraKeys.mjs";
import { Canvas } from "@react-three/fiber";
import { CAMPUS_CANVAS_GL } from "../lighting/CampusLighting";
import { getClearColor } from "../lighting/atmosphere.mjs";
import { getSunVector } from "../utils/sunPosition.mjs";
import { PanelErrorBoundary } from "../components/PanelErrorBoundary";
import { CampusScene } from "./CampusScene";
import { WaterReflections } from "../lighting/WaterReflections";

// 3D 실패 안내(<div role="alert">)가 장면 배경 위에서도 읽히도록 패널 표면 위에 올린다.
const CANVAS_FALLBACK_SURFACE_CLASS = [
  "[&>[role=alert]]:rounded-card [&>[role=alert]]:border [&>[role=alert]]:border-hairline",
  "[&>[role=alert]]:bg-surface-1 [&>[role=alert]]:px-5 [&>[role=alert]]:py-4 [&>[role=alert]]:text-body",
  "[&>[role=alert]]:shadow-popover [&>[role=alert]>button]:mt-3 [&>[role=alert]>button]:font-semibold",
  "[&>[role=alert]>button]:underline",
].join(" ");

// Legacy 3D 캠퍼스 지도 층. 실패하면 열린 패널을 뺀 지도 영역(insetRight) 가운데에 안내를 띄운다.
// select-none: 캔버스나 라벨에서 시작한 드래그가 라벨·패널 글자를 선택하지 않게 한다.
export const CampusCanvas = forwardRef(function CampusCanvas(
  { insetRight, rendering, sunState, weatherScene, scene, camera, flow },
  mapLayerRef,
) {
  useCameraKeys({ targetRef: mapLayerRef, controlsRef: scene.controlsRef, onHome: camera.goHome });
  const sunVector = useMemo(
    () => getSunVector({ altitude: sunState.altitude, azimuth: sunState.azimuth }),
    [sunState.altitude, sunState.azimuth],
  );
  return (
    <div
      ref={mapLayerRef}
      data-qa="campus-map-layer"
      tabIndex={0}
      aria-label="순천대 캠퍼스 3D 지도"
      aria-describedby="campus-map-keys"
      className={`absolute inset-0 z-0 flex select-none items-center justify-center ${CANVAS_FALLBACK_SURFACE_CLASS}`}
    >
      <p id="campus-map-keys" className="sr-only text-body">화살표로 회전, Shift+화살표로 이동, +와 -로 확대·축소, H로 처음 시점</p>
      <PanelErrorBoundary
        label="3D 캠퍼스"
        message="3D 캠퍼스 모델을 불러오지 못했습니다"
        fallbackClassName="absolute inset-y-0 left-0 flex items-center justify-center px-10 transition-[right] duration-300"
        fallbackStyle={{ right: insetRight }}
      >
        {/* R3F 래퍼의 기본 overflow: hidden은 스크롤 컨테이너라 포커스 이동에 밀린다. clip은 똑같이 자르되 스크롤되지 않는다. */}
        <Canvas
          camera={{ position: [0, 260, 260], fov: 50 }}
          shadows="percentage"
          gl={CAMPUS_CANVAS_GL}
          frameloop={rendering.frameloop}
          dpr={rendering.dpr}
          onCreated={rendering.onCreated}
          style={{ overflow: "clip" }}
        >
          <CampusScene
            background={getClearColor(sunState.altitude)}
            sceneMinute={sunState.minuteOfDay}
            sunVector={sunVector}
            sunVisible={sunState.visible}
            sunAltitude={sunState.altitude}
            weatherScene={weatherScene}
            quality={rendering.quality}
            shadowMapSizes={rendering.renderer.shadowMapSizes}
            controlsRef={scene.controlsRef}
            selectedId={scene.selectedId}
            labelsHidden={scene.labelsHidden}
            occluderRef={scene.occluderRef}
            chromeRefs={scene.chromeRefs}
            onSelect={flow.handleSelect}
            onBuildingClick={flow.handleBuildingClick}
            onBuildingProximity={flow.handleBuildingProximity}
            onD4Enter={flow.handleD4Enter}
            onOrbitStart={camera.handleOrbitStart}
            onOrbitEnd={camera.handleOrbitEnd}
            onLoadingChange={scene.onLoadingChange}
            attempt={scene.attempt}
            presentation={scene.presentation}
            onCompare={scene.onCompare}
            activePresetId={camera.activePresetId}
            selectedElementId={flow.selectedElementId}
            selectionOutline={rendering.quality !== "low"}
            onLabelRegistry={flow.setLabelRegistry}
            onDragStart={flow.releaseOnDrag}
            headlineById={flow.headlineById}
          />
          <WaterReflections quality={rendering.quality} />
        </Canvas>
      </PanelErrorBoundary>
    </div>
  );
});

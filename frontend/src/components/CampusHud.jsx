import { forwardRef } from "react";
import { CloudSun } from "lucide-react";
import { CAMERA_PRESETS } from "../camera/cameraPresets.mjs";
import { CameraPresetBar } from "./CameraPresetBar";
import { TimeSlider } from "./TimeSlider";

// 지도 위 조작: 카메라 시점(왼쪽 위)과 시간 슬라이더(왼쪽 아래). 지도보다 앞에 두어 Tab이 라벨보다 먼저 닿는다.
// 오른쪽 끝은 패널 토글(w-7)과 그 여백만큼 비운다. 좁은 화면에서 열린 패널이 지도를 다 덮으면 보이지 않게 한다.
export const CampusHud = forwardRef(function CampusHud({ hidden, insetRight, camera, clock, playing, onPlayingChange, sceneWeather }, ref) {
  return (
    <div
      ref={ref}
      data-qa="campus-hud"
      data-label-chrome-layer=""
      className={`pointer-events-none absolute inset-y-0 left-0 z-[6] transition-[right] duration-300 ${hidden ? "invisible" : ""}`}
      style={{ right: `calc(${insetRight} + 2.75rem)` }}
    >
      <CameraPresetBar
        presets={CAMERA_PRESETS}
        activeId={camera.activePresetId}
        onSelect={camera.selectPreset}
        touring={camera.touring}
        onToggleTour={camera.toggleTour}
        className="absolute left-4 top-4 max-w-[calc(100%-2rem)]"
      />
      <TimeSlider
        minuteOfDay={clock.sceneMinuteOfDay}
        onMinuteChange={clock.setSceneMinuteOfDay}
        playing={playing}
        onPlayingChange={onPlayingChange}
        live={clock.isLiveMode}
        className="absolute bottom-4 left-4 w-[min(24rem,calc(100%-2rem))]"
        caption={(
          <p
            data-qa="scene-weather"
            data-estimated={sceneWeather.label.estimated ? "true" : "false"}
            className="flex items-start gap-1.5 text-caption text-ink-muted"
          >
            <CloudSun aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="min-w-0 break-keep">{sceneWeather.label.text}</span>
          </p>
        )}
      />
    </div>
  );
});

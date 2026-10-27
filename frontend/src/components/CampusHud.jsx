import { forwardRef } from "react";
import { CloudSun, Presentation } from "lucide-react";
import { Button } from "../ui/Button.jsx";
import { CAMERA_PRESETS } from "../camera/cameraPresets.mjs";
import { Wordmark } from "../panel/Wordmark";
import { SHELL_PEEK_HEIGHT } from "../panel/DashboardShell";
import { CameraControls } from "./CameraControls";
import { HudTimeReadout } from "./HudTimeReadout";
import { HudToolbar } from "./HudToolbar";
import { SearchField } from "./SearchField";
import { TimeSlider } from "./TimeSlider";

// 지도 위 조작. 첫 글자는 장면 시각이고(왼쪽 위), 그 옆에 카메라 도구 모음, 아래에 시간 슬라이더, 오른쪽에 확대·회전 단추.
// 지도보다 앞에 두어 Tab이 라벨보다 먼저 닿는다. 오른쪽은 패널(레일)이 차지한 폭만큼 비킨다(insetRight).
// 폰에서는 바텀 시트의 peek 높이만큼 아래를 비워 슬라이더가 시트에 가리지 않게 하고, 워드마크는 시트 머리에 있다.
export const CampusHud = forwardRef(function CampusHud(
  {
    mode = "desktop", insetRight, camera, clock, playing, onPlayingChange, sceneWeather, statusSlot = null, presenting = false,
    onTogglePresentation, tour = null, compareSlot = null, search = null,
  },
  ref,
) {
  const phone = mode === "phone";
  const toggle = onTogglePresentation && (
    <PresentationToggle presenting={presenting} onToggle={onTogglePresentation} className={presenting ? "ml-auto" : "mt-1"} />
  );
  // 발표 모드: 장면 시각과 나가기 단추만 남기고, 투어 중이면 아래 가운데에 점 표시를 둔다.
  if (presenting) {
    return (
      <div ref={ref} data-qa="campus-hud" data-label-chrome-layer="" data-presenting="true" className="pointer-events-none absolute inset-0 z-[6]">
        <div className="absolute left-4 right-4 top-4 flex items-start gap-2">
          <HudTimeReadout minuteOfDay={clock.sceneMinuteOfDay} />
          {toggle}
        </div>
        {tour && <TourPager current={tour.current} total={tour.total} />}
      </div>
    );
  }
  return (
    <div
      ref={ref}
      data-qa="campus-hud"
      data-label-chrome-layer=""
      className="pointer-events-none absolute left-0 top-0 z-[6]"
      style={{ right: insetRight, bottom: phone ? `${SHELL_PEEK_HEIGHT}px` : "0px" }}
    >
      <div className="absolute left-4 right-4 top-4 flex flex-wrap items-start gap-2">
        <HudTimeReadout minuteOfDay={clock.sceneMinuteOfDay} statusSlot={statusSlot} />
        <HudToolbar
          presets={CAMERA_PRESETS}
          activeId={camera.activePresetId}
          onSelect={camera.selectPreset}
          touring={camera.touring}
          onToggleTour={camera.toggleTour}
        />
        {search && <SearchField registry={search.registry} onPick={search.onPick} />}
        {toggle}
        {compareSlot}
        {!phone && <Wordmark className="ml-auto mt-2.5 text-ink-muted" />}
      </div>
      <TimeSlider
        minuteOfDay={clock.sceneMinuteOfDay}
        onMinuteChange={clock.setSceneMinuteOfDay}
        dateValue={clock.sceneDate}
        onDateChange={clock.setSceneDate}
        onNow={clock.snapToNow}
        playing={playing}
        onPlayingChange={onPlayingChange}
        live={clock.isLiveMode}
        collapsible={phone}
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
      <CameraControls controlsRef={camera.controlsRef} onHome={camera.goHome} className="absolute right-4 top-1/2 -translate-y-1/2 sm:bottom-4 sm:top-auto sm:translate-y-0" />
    </div>
  );
});

export function PresentationToggle({ presenting, onToggle, className }) {
  return (
    <Button
      size="sm"
      data-qa="presentation-toggle"
      aria-pressed={presenting}
      aria-keyshortcuts="P"
      icon={<Presentation aria-hidden="true" className="h-4 w-4" />}
      onClick={onToggle}
      className={`pointer-events-auto ${className ?? ""}`}
    >
      {presenting ? "발표 모드 끝내기" : "발표 모드"}
    </Button>
  );
}

// 투어 중 지금 시점의 위치를 점으로 보인다(발표 모드 전용).
export function TourPager({ current, total }) {
  return (
    <div
      data-qa="tour-pager"
      role="img"
      aria-label={`투어 ${current}/${total}`}
      className="absolute bottom-6 left-1/2 flex -translate-x-1/2 gap-2 rounded-pill bg-surface-1 px-3 py-2"
    >
      {Array.from({ length: total }, (_, index) => (
        <span key={index} aria-hidden="true" className={`h-2 w-2 rounded-pill ${index + 1 === current ? "bg-ink" : "bg-hairline-strong"}`} />
      ))}
    </div>
  );
}

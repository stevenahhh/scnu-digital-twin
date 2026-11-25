import { forwardRef, useCallback, useRef } from "react";
import { CloudSun, Pause, Play, Presentation } from "lucide-react";
import { Button } from "../ui/Button.jsx";
import { cx } from "../ui/cx.mjs";
import { CAMERA_PRESETS } from "../camera/cameraPresets.mjs";
import { formatMinuteOfDay } from "../weather/sceneClock.mjs";
import { Wordmark } from "../panel/Wordmark";
import { SHELL_PEEK_HEIGHT } from "../panel/DashboardShell";
import { CameraControls } from "./CameraControls";
import { HudToolbar } from "./HudToolbar";
import { SearchField } from "./SearchField";
import { TimeSlider } from "./TimeSlider";
import { FOLLOW_MOTION, FOLLOW_ROOT, usePanelFollow } from "./hud/usePanelFollow.mjs";

const PRESSED = "aria-pressed:bg-surface-2 aria-pressed:text-ink";
const sceneTimeReadout = (minuteOfDay) => `장면 ${formatMinuteOfDay(minuteOfDay)}`;
// 폰 검색 칸은 시점·더보기 단추(와 끊긴 피드 칩) 옆에서 80 px 안팎이다. 긴 예시 문구 대신 이 문구를 쓴다.
export const PHONE_SEARCH_PLACEHOLDER = "건물 검색";

// 두 대시보드가 같이 쓰는 지도 위 조작. 위쪽 한 줄(hud-bar)은 검색, 시점 메뉴, 오른쪽 끝의 moreMenu다. 학교 이름은 지도 폭의
// 가운데에 그림자 글자로 놓고, 폭이 좁으면 그 줄 아래로 내린다. 끊긴 피드는 패널 현황 탭 아이콘의 점이 알린다. 시간 카드는 왼쪽 아래, 카메라 묶음은 오른쪽 아래(폰은 토글 하나)에 놓인다.
// 장면 시각은 시간 카드에만 보인다. 오른쪽은 패널(레일)이 차지한 폭만큼 비키고, 패널이 미끄러지는 동안 오른쪽 묶음이
// 패널과 같은 transform으로 따라간다(usePanelFollow). camera는 덕 타이핑이다: Main는 controlsRef, VWorld는
// zoomBy·rotateBy를 준다. 비교는 인스펙터가 맡는다. 지도보다 앞에 두어 Tab이 라벨보다 먼저 닿는다.
export const CampusHud = forwardRef(function CampusHud(
  {
    mode = "desktop", insetRight, camera, clock, playing, onPlayingChange, presenting = false, onTogglePresentation,
    tour = null, search = null, moreMenu = null, sceneWeather = null, sheetDetent = null,
  },
  ref,
) {
  const rootRef = useRef(null);
  const setRoot = useCallback((node) => {
    rootRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }, [ref]);
  const follow = usePanelFollow(rootRef, insetRight);
  const phone = mode === "phone";
  // 폰 바텀 시트가 half면 시간 칩을 시트 밑 대신 위쪽(검색 줄 아래 왼쪽, 카메라 토글과 같은 높이)으로 올린다.
  // 지도 가운데의 선택 칩을 가리지 않고 시트에 깔리지도 않는다.
  // full이면 시트가 HUD를 다 덮으므로 HUD 전체를 보이지도 닿지도 않게 감춘다.
  const sheetHalf = phone && sheetDetent === "half";
  const sheetFull = phone && sheetDetent === "full";
  const cameraReady = camera.ready !== false;
  const toggle = onTogglePresentation && <PresentationToggle presenting={presenting} onToggle={onTogglePresentation} />;

  // 발표 모드: 읽기 전용 장면 시각, 투어 시작/멈춤, 발표 모드 끝내기만 남기고 투어 중이면 아래 가운데에 점 표시를 둔다.
  if (presenting) {
    return (
      <div ref={setRoot} data-qa="campus-hud" data-label-chrome-layer="" data-presenting="true" className="pointer-events-none absolute inset-0 z-[6] transition-none">
        {/* 폰에서는 세 조각이 한 줄에 다 들어가지 않는다. 글자를 두 줄로 꺾는 대신 단추 묶음을 다음 줄로 내린다. */}
        <div data-qa="hud-bar" className={cx("absolute left-4 right-4 top-4 flex items-center gap-2", phone && "flex-wrap")}>
          <p data-qa="hud-time-readout" className="whitespace-nowrap rounded-control border border-hairline bg-surface-1 px-3 py-2 text-body font-semibold tabular-nums text-ink">
            {sceneTimeReadout(clock.sceneMinuteOfDay)}
          </p>
          <div className="ml-auto flex items-center gap-2">
            {camera.toggleTour && <TourToggle touring={camera.touring} onToggle={camera.toggleTour} />}
            {toggle}
          </div>
        </div>
        {tour && <TourPager current={tour.current} total={tour.total} />}
      </div>
    );
  }
  return (
    <div
      ref={setRoot}
      data-qa="campus-hud"
      data-label-chrome-layer=""
      aria-hidden={sheetFull ? "true" : undefined}
      className={cx("pointer-events-none absolute left-0 top-0 z-[6] transition-none [container-type:inline-size]", FOLLOW_ROOT, sheetFull && "invisible")}
      style={{ right: follow.right, bottom: phone ? `${SHELL_PEEK_HEIGHT}px` : "0px" }}
    >
      <Wordmark className="absolute left-1/2 top-4 flex h-10 -translate-x-1/2 items-center whitespace-nowrap text-body font-semibold text-on-primary [text-shadow:var(--shadow-scene-text)] [@container(max-width:760px)]:top-[3.75rem] [@container(max-width:760px)]:h-6 [@container(max-width:760px)]:text-caption" />
      <div data-qa="hud-bar" className="absolute left-4 right-4 top-4 flex min-w-0 flex-nowrap items-center gap-2">
        {search && (
          <SearchField
            registry={search.registry}
            onPick={search.onPick}
            className="min-w-0 shrink"
            {...(phone ? { placeholder: PHONE_SEARCH_PLACEHOLDER } : {})}
          />
        )}
        {cameraReady && (
          <HudToolbar presets={CAMERA_PRESETS} activeId={camera.activePresetId} onSelect={camera.selectPreset} compact={phone} />
        )}
        <div className={cx("ml-auto flex shrink-0 items-center gap-2", FOLLOW_MOTION)} style={follow.style}>
          {moreMenu}
        </div>
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
        className={cx("absolute left-4 w-[min(24rem,calc(100%-2rem))]", sheetHalf ? "top-20" : "bottom-4")}
        caption={sceneWeather && (
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
      {cameraReady && (
        <CameraControls
          controlsRef={camera.controlsRef}
          onZoom={camera.zoomBy}
          onRotate={camera.rotateBy}
          onHome={camera.goHome}
          collapsible={phone}
          className={cx(phone ? "absolute right-4 top-20" : "absolute bottom-4 right-4", FOLLOW_MOTION)}
          style={follow.style}
        />
      )}
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
      className={cx("pointer-events-auto whitespace-nowrap", className)}
    >
      {presenting ? "발표 모드 끝내기" : "발표 모드"}
    </Button>
  );
}

// 투어는 발표 모드 안에서만 켠다. 시점을 6초마다 차례로 보여 준다.
function TourToggle({ touring, onToggle }) {
  return (
    <Button
      size="sm"
      data-qa="camera-tour-toggle"
      aria-pressed={touring}
      title={touring ? "투어를 멈춥니다" : "시점을 6초마다 차례로 보여 줍니다"}
      icon={touring ? <Pause aria-hidden="true" className="h-4 w-4" /> : <Play aria-hidden="true" className="h-4 w-4" />}
      onClick={onToggle}
      className={cx("pointer-events-auto whitespace-nowrap", PRESSED)}
    >
      {touring ? "투어 멈춤" : "투어 시작"}
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

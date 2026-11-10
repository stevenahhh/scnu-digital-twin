import { Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createInstallationPlanClient } from "../features/energy/installations/installationPlanApi.mjs";
import { loadRepresentativePlanOverlays } from "./representativePlanOverlay.mjs";
import { toKoreanEnergyError } from "../features/energy/shared/energyErrorMessages.mjs";
import { Button } from "../ui/Button.jsx";
import { cx } from "../ui/cx.mjs";

// 대표 설치 계획 지도 레이어의 데이터와 토글 하나.
// onOverlayDataChange는 렌더러와 무관한 옥상 로컬 좌표 오버레이를 받는다. []이면 숨김이다.
// 건물별 계획 목록은 에너지 탭의 캠퍼스 비교 표가 맡으므로 여기에는 토글과 불러오기 상태만 있다.
export function RepresentativePlanOverlayController({
  buildingIds,
  client,
  loadOverlays = loadRepresentativePlanOverlays,
  onOverlayDataChange,
  refreshKey,
  defaultVisible = true,
  renderPanel = true,
  className = "",
  widthClassName = "",
  feedDown = false,
}) {
  const api = useMemo(() => client ?? createInstallationPlanClient(), [client]);
  const callbackRef = useRef(onOverlayDataChange);
  const visibleRef = useRef(defaultVisible);
  const [visible, setVisible] = useState(defaultVisible);
  const [overlays, setOverlays] = useState([]);
  const [state, setState] = useState({ status: "loading", message: "" });
  // 다시 시도: 같은 조건으로 불러오기를 한 번 더 돌린다(페이지를 새로 고치지 않는다).
  const [attempt, setAttempt] = useState(0);
  const buildingKey = Array.isArray(buildingIds) ? buildingIds.join("\u0000") : "";
  // 에너지 피드가 돌아오면(끊김 -> 정상) 실패한 목록을 한 번 다시 불러온다.
  const wasDownRef = useRef(feedDown);
  useEffect(() => {
    if (wasDownRef.current && !feedDown) setAttempt((value) => value + 1);
    wasDownRef.current = feedDown;
  }, [feedDown]);

  useEffect(() => { callbackRef.current = onOverlayDataChange; }, [onOverlayDataChange]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setOverlays([]);
    setState({ status: "loading", message: "" });
    callbackRef.current?.([]);
    loadOverlays({ buildingIds, client: api, signal: controller.signal }).then((next) => {
      if (!active) return;
      setOverlays(next);
      setState({ status: "ready", message: "" });
      callbackRef.current?.(visibleRef.current ? next : []);
    }).catch((error) => {
      if (!active || error?.name === "AbortError") return;
      setOverlays([]);
      setState({ status: "error", message: toKoreanEnergyError(error) });
      callbackRef.current?.([]);
    });
    return () => {
      active = false;
      controller.abort();
      callbackRef.current?.([]);
    };
  // buildingKey는 buildingIds의 값 동일성을 나타낸다.
  }, [api, buildingKey, loadOverlays, refreshKey, attempt]);

  const toggle = () => {
    const next = !visibleRef.current;
    visibleRef.current = next;
    setVisible(next);
    callbackRef.current?.(next ? overlays : []);
  };

  if (!renderPanel) return null;

  const label = visible ? "대표 설치 계획 숨기기" : "대표 설치 계획 표시하기";
  return <div
    // 지도 위에 놓여도 글자가 읽히도록 면을 깐다(패널 안에서는 같은 면이라 드러나지 않는다).
    className={cx("pointer-events-auto flex flex-col items-end gap-1 rounded-control bg-surface-1 text-ink", widthClassName, className)}
    role="group"
    aria-label="대표 설치 계획 지도 레이어"
  >
    <Button
      size="sm"
      variant="ghost"
      aria-label={label}
      aria-pressed={visible}
      onClick={toggle}
      // 눌린 모양은 다른 토글과 같다(surface-2 바탕 + ink 글자, V-F-34). 눈 글리프가 상태를 함께 알린다.
      className={cx(visible && "!bg-surface-2 !text-ink")}
      icon={visible ? <Eye aria-hidden="true" className="h-4 w-4" /> : <EyeOff aria-hidden="true" className="h-4 w-4" />}
    >
      대표 설치 계획
    </Button>
    {state.status === "loading" && <span role="status" className="sr-only">대표 설치 계획을 불러오는 중입니다.</span>}
    {/* 에너지 피드가 끊긴 동안 그 알림·다시 시도는 피드 상태 줄 하나뿐이다: 여기는 원인 한 줄만 둔다. */}
    {state.status === "error" && feedDown && (
      <p role="status" data-qa="overlay-feed-deferred" className="break-keep text-caption text-ink-muted">
        에너지 연결을 기다리는 중
      </p>
    )}
    {state.status === "error" && !feedDown && (
      <div className="flex items-center gap-2">
        <p role="alert" data-source="representative-plans" className="break-keep text-caption text-ink-muted">
          {`대표 설치 계획을 불러오지 못했습니다 · ${state.message}`}
        </p>
        <Button size="sm" variant="ghost" onClick={() => setAttempt((value) => value + 1)}>다시 시도</Button>
      </div>
    )}
  </div>;
}

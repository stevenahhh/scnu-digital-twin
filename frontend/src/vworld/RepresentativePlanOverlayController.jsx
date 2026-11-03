import { Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createInstallationPlanClient } from "../features/energy/installations/installationPlanApi.mjs";
import {
  hasVerifiedVWorldRoofTransform,
  loadRepresentativePlanOverlays,
} from "./representativePlanOverlay.mjs";
import { toKoreanEnergyError } from "../features/energy/shared/energyErrorMessages.mjs";
import { Alert } from "../ui/Alert.jsx";
import { Button } from "../ui/Button.jsx";
import { Skeleton } from "../ui/Skeleton.jsx";
import { Spinner } from "../ui/Spinner.jsx";
import { cx } from "../ui/cx.mjs";

/**
 * UI/controller leaf for a VWorld representative-plan layer.
 * onOverlayDataChange receives renderer-neutral roof-local overlays; [] means hidden.
 */
export function RepresentativePlanOverlayController({
  buildingIds,
  client,
  loadOverlays = loadRepresentativePlanOverlays,
  onOverlayDataChange,
  onBuildingSelect,
  refreshKey,
  defaultVisible = true,
  renderPanel = true,
  className = "",
  widthClassName = "",
  feedDown = false,
  // 높이가 정해진 열(폰의 왼쪽 아래 열) 안에서는 카드가 줄어들고 목록만 안에서 스크롤한다(지도 위 HUD를 덮지 않게).
  fitHeight = false,
}) {
  const api = useMemo(() => client ?? createInstallationPlanClient(), [client]);
  const callbackRef = useRef(onOverlayDataChange);
  const visibleRef = useRef(defaultVisible);
  const [visible, setVisible] = useState(defaultVisible);
  const [overlays, setOverlays] = useState([]);
  const [state, setState] = useState({ status: "loading", message: "대표 설치 계획을 불러오는 중입니다." });
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
    setState({ status: "loading", message: "대표 설치 계획을 불러오는 중입니다." });
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
  // buildingKey intentionally represents the value identity of buildingIds.
  }, [api, buildingKey, loadOverlays, refreshKey, attempt]);

  const toggle = () => {
    const next = !visibleRef.current;
    visibleRef.current = next;
    setVisible(next);
    callbackRef.current?.(next ? overlays : []);
  };

  if (!renderPanel) return null;

  const overlayByBuilding = new Map(overlays.map((overlay) => [overlay.buildingId, overlay]));
  const label = visible ? "대표 설치 계획 숨기기" : "대표 설치 계획 표시하기";
  return <aside
    className={cx("pointer-events-auto flex flex-col gap-1 rounded-card border border-hairline bg-surface-1 p-2 text-ink", fitHeight && "min-h-0", widthClassName, className)}
    aria-label="대표 설치 계획 지도 레이어"
  >
    <Button
      size="sm"
      variant="ghost"
      aria-label={label}
      aria-pressed={visible}
      onClick={toggle}
      // 눌린 모양은 다른 토글과 같다(surface-2 바탕 + ink 글자, V-F-34). 눈 글리프가 상태를 함께 알린다.
      className={cx("w-full shrink-0", visible && "!bg-surface-2 !text-ink")}
      icon={visible ? <Eye aria-hidden="true" className="h-4 w-4" /> : <EyeOff aria-hidden="true" className="h-4 w-4" />}
    >
      대표 설치 계획
    </Button>
    {state.status === "loading" && (
      <div className="flex flex-col gap-2 px-2 pb-1">
        <Skeleton lines={2} />
        <Spinner delayMs={0} label={state.message} />
      </div>
    )}
    {/* 에너지 피드가 끊긴 동안 그 알림·다시 시도는 피드 상태 줄(패널 또는 HUD) 하나뿐이다: 여기는 원인 한 줄만 둔다. */}
    {state.status === "error" && feedDown && (
      <p role="status" data-qa="overlay-feed-deferred" className="break-keep px-2 pb-1 text-caption text-ink-muted">
        에너지 연결을 기다리는 중 · 돌아오면 대표 설치 계획을 다시 불러옵니다
      </p>
    )}
    {state.status === "error" && !feedDown && (
      <Alert
        tone="danger"
        source="representative-plans"
        title="대표 설치 계획을 불러오지 못했습니다"
        message={state.message}
        actions={[{ label: "다시 시도", onClick: () => setAttempt((value) => value + 1) }]}
      />
    )}
    {state.status === "ready" && <ul className={cx("flex flex-col border-t border-hairline pt-1", fitHeight && "min-h-0 overflow-y-auto overscroll-contain")} aria-label="건물별 대표 설치 계획 상태">
      {buildingIds.map((buildingId) => {
        const overlay = overlayByBuilding.get(buildingId);
        const hasWorldGeometry = hasVerifiedVWorldRoofTransform(buildingId);
        const panelCount = overlay?.arrays?.length ?? 0;
        const capacity = Number.isFinite(overlay?.installedCapacityKwp)
          ? `${overlay.installedCapacityKwp.toFixed(3)} kWp`
          : "설치 용량 확인 불가";
        const where = hasWorldGeometry ? "지도 표시 가능" : "검증된 지도 좌표 없음";
        return <li
          key={buildingId}
          data-building-id={buildingId}
          data-geometry-status={hasWorldGeometry ? "verified" : "unverified"}
          className="flex items-center justify-between gap-3 rounded-control px-2 py-1.5 text-caption"
        >
          <div className="min-w-0">
            <strong className="font-semibold text-ink">{buildingId}</strong>
            {overlay && <p className="truncate font-medium text-ink">{overlay.name}</p>}
            <p className="break-keep text-ink-muted">{overlay ? `${capacity} · ${panelCount}개 배열 · ${where}` : "대표 설치안 미지정"}</p>
          </div>
          {!hasWorldGeometry && onBuildingSelect && (
            <Button size="sm" variant="ghost" onClick={() => onBuildingSelect(buildingId)} aria-label={`${buildingId} 상세 분석 보기`}>
              상세 분석
            </Button>
          )}
        </li>;
      })}
      <li className="px-2 pt-1 text-caption text-ink-muted">읽기 전용 · 검증된 옥상 좌표가 있는 건물만 지도에 표시됩니다.</li>
    </ul>}
  </aside>;
}

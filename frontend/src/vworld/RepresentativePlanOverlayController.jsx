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
  className = "",
  widthClassName = "",
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

  const overlayByBuilding = new Map(overlays.map((overlay) => [overlay.buildingId, overlay]));
  const label = visible ? "대표 설치 계획 숨기기" : "대표 설치 계획 표시하기";
  return <aside
    className={cx("pointer-events-auto flex flex-col gap-1 rounded-card border border-hairline bg-surface-1 p-2 text-ink", widthClassName, className)}
    aria-label="대표 설치 계획 지도 레이어"
  >
    <Button
      variant="ghost"
      aria-label={label}
      aria-pressed={visible}
      onClick={toggle}
      className="w-full"
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
    {state.status === "error" && (
      <Alert
        tone="danger"
        source="representative-plans"
        title="대표 설치 계획을 불러오지 못했습니다"
        message={state.message}
        actions={[{ label: "다시 시도", onClick: () => setAttempt((value) => value + 1) }]}
      />
    )}
    {state.status === "ready" && <ul className="flex flex-col border-t border-hairline pt-1" aria-label="건물별 대표 설치 계획 상태">
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

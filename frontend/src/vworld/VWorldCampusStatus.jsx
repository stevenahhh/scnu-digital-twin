import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { createCampusComparisonClient } from "../features/energy/campus/CampusComparisonPanel";
import { COARSE_TARGET, FOCUS_RING } from "../ui/Button.jsx";
import { SectionHeader } from "../ui/SectionHeader.jsx";
import { StatusBadge } from "../ui/StatusBadge.jsx";
import { cx } from "../ui/cx.mjs";
import { formatDayLabel } from "../ui/format.mjs";

const LABELS = { simulated: "완료", incomplete: "불완전", no_scenario: "미설정" };
const TONES = { simulated: "success", incomplete: "warning", no_scenario: "neutral" };

// 건물별 태양광 시나리오 상태. 놓일 자리(위치·폭)는 쓰는 쪽이 className으로 정한다.
// selectedBuildingId가 오면 그 건물 칸을 장면 라벨의 선택 모양(surface-2 + ink + 확인 표시)으로 보인다.
// feedDown: 에너지 피드가 끊긴 동안은 그 알림을 피드 상태 줄에 맡기고 여기는 상태(role=status)로만 적고, 돌아오면 다시 불러온다.
export function VWorldCampusStatus({ onSelection, date = "2026-05-18", client, selectedBuildingId, feedDown = false, className = "" }) {
  const api = useMemo(() => client ?? createCampusComparisonClient(), [client]);
  const [state, setState] = useState({ status: "loading", entries: [] });
  const [attempt, setAttempt] = useState(0);
  const wasDownRef = useRef(feedDown);
  useEffect(() => {
    if (wasDownRef.current && !feedDown) setAttempt((value) => value + 1);
    wasDownRef.current = feedDown;
  }, [feedDown]);
  useEffect(() => {
    const controller = new AbortController();
    api.load({ date, weatherPreset: "clear", signal: controller.signal }).then((data) => {
      const byBuilding = new Map();
      for (const item of [...data.excluded, ...data.ranked]) byBuilding.set(item.buildingId, item);
      setState({ status: "success", entries: [...byBuilding.values()].sort((a, b) => a.buildingId.localeCompare(b.buildingId)) });
    }).catch((error) => {
      if (error?.name !== "AbortError") setState({ status: "error", entries: [] });
    });
    return () => controller.abort();
  }, [api, date, attempt]);

  return (
    <aside
      data-qa="vworld-campus-status"
      className={cx("pointer-events-auto flex flex-col gap-2 rounded-card border border-hairline bg-surface-1 p-3 text-ink", className)}
      aria-label="VWorld 건물 태양광 상태"
    >
      <SectionHeader title="건물별 태양광 상태" subtitle={`시뮬레이션 기준일 ${formatDayLabel(date)}`} />
      {state.status === "loading" && <p role="status" className="text-caption text-ink-muted">건물 상태 확인 중</p>}
      {state.status === "error" && (
        <p role={feedDown ? "status" : "alert"} className="text-caption text-ink-muted">상태 API에 연결하지 못했습니다</p>
      )}
      {state.status === "success" && state.entries.length === 0 && (
        <p className="text-caption text-ink-muted">표시할 건물 상태가 없습니다</p>
      )}
      {state.status === "success" && state.entries.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {state.entries.map((item) => {
            const selected = item.buildingId === selectedBuildingId;
            return (
              <li key={item.buildingId}>
                <button
                  type="button"
                  data-status={item.buildingStatus}
                  aria-pressed={selectedBuildingId === undefined ? undefined : selected}
                  title={`${item.buildingName}: ${LABELS[item.buildingStatus]}`}
                  aria-label={`${item.buildingName} ${LABELS[item.buildingStatus]} 시나리오 열기`}
                  onClick={() => onSelection({ elementId: `BLD_${item.buildingId}`, buildingId: item.buildingId, displayName: item.buildingName })}
                  className={cx(
                    "flex min-h-9 items-center gap-1.5 rounded-pill border px-2.5 text-caption",
                    selected ? "border-hairline-strong bg-surface-2 font-semibold text-ink" : "border-hairline bg-surface-1 text-ink-muted",
                    COARSE_TARGET,
                    FOCUS_RING,
                  )}
                >
                  {selected && <Check aria-hidden="true" className="h-3 w-3" />}
                  {item.buildingId}
                  <StatusBadge tone={TONES[item.buildingStatus] ?? "neutral"}>{LABELS[item.buildingStatus]}</StatusBadge>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="break-keep text-caption text-ink-muted">건물을 선택하면 일치하는 에너지 시나리오가 열립니다.</p>
    </aside>
  );
}

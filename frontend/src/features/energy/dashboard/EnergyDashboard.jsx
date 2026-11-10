import { useEffect, useMemo, useRef, useState } from "react";
import { createEnergyDashboardClient } from "./energyDashboardApi.mjs";
import { EnergyChart, KpiDetails, KpiGrid, ProvenancePanel, RoomBreakdown } from "./EnergyDashboardPanels.jsx";
import { useEnergyDashboard } from "./useEnergyDashboard.js";
import { toKoreanEnergyError } from "../shared/energyErrorMessages.mjs";
import { kstToday, weatherPresetLabel } from "../shared/energyContext.mjs";
import { FIELD_INPUT, FIELD_LABEL } from "../shared/fieldStyles.mjs";
import { Alert } from "../../../ui/Alert.jsx";
import { Disclosure } from "../../../ui/Disclosure.jsx";
import { MetricList } from "../../../ui/MetricList.jsx";
import { SectionHeader } from "../../../ui/SectionHeader.jsx";
import { Skeleton } from "../../../ui/Skeleton.jsx";

const DEFAULT_SCENARIO = "D4-scenario-south-2x8";

function ScenarioSummary({ scenario }) {
  const items = [
    { id: "name", label: "시나리오", value: <span className="text-body text-ink">{scenario.name}</span> },
    { id: "arrays", label: "배열", value: <span className="text-body tabular-nums text-ink">{`${scenario.arrayCount}개`}</span> },
    { id: "weather", label: "기상 프리셋", value: <span className="text-body text-ink">{weatherPresetLabel(scenario.weatherPreset)}</span> },
  ];
  return <MetricList items={items} />;
}

// 선택 건물 요약: 핵심 지표 4개와 수요·발전 그래프가 먼저 보이고, 나머지 지표·공간별 수요·가정은 펼침 안에 있다.
// 날짜는 에너지 탭의 기준일(장면 날짜)을 따른다. feedDown이면 실패 알림을 탭 맨 위 하나에 맡기고 여기는 한 줄만 적는다.
// initialDate는 발표 페이지가 쓰는 예전 이름이다(date와 같다).
export function EnergyDashboard({ buildingId = "D4", date: dateProp, initialDate, scenarios, client, feedDown = false }) {
  const date = dateProp ?? initialDate ?? kstToday();
  const apiClient = useMemo(() => client ?? createEnergyDashboardClient(), [client]);
  const [scenarioId, setScenarioId] = useState(scenarios?.[0]?.id ?? DEFAULT_SCENARIO);
  const state = useEnergyDashboard({ buildingId, date, scenarioId, client: apiClient });
  const options = scenarios ?? state.data?.scenarios ?? [{ id: scenarioId, label: "D4 기본 2×8" }];
  const title = state.status === "success" ? state.data.building.displayName : "건물 에너지 시뮬레이션";
  // 끊겼던 에너지 피드가 돌아오면 실패한 요약을 한 번 다시 불러온다.
  const wasDownRef = useRef(feedDown);
  const retryRef = useRef(state.retry);
  retryRef.current = state.retry;
  useEffect(() => {
    if (wasDownRef.current && !feedDown) retryRef.current?.();
    wasDownRef.current = feedDown;
  }, [feedDown]);

  return (
    <section data-qa="energy-dashboard" className="flex flex-col gap-4 pb-4" aria-label="태양광 현황">
      <SectionHeader title={title} />
      <label className={FIELD_LABEL}>
        시나리오
        <select
          data-qa="energy-scenario"
          aria-label="설치 시나리오"
          value={scenarioId}
          onChange={(event) => setScenarioId(event.target.value)}
          className={FIELD_INPUT}
        >
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {state.status === "loading" && (
        <div data-qa="energy-loading" className="flex flex-col gap-3">
          <Skeleton shape="block" />
          <p role="status" className="sr-only">에너지 시뮬레이션을 불러오는 중입니다.</p>
        </div>
      )}
      {state.status === "error" && (feedDown ? (
        <p role="status" className="break-keep text-caption text-ink-muted">에너지 연결을 기다리는 중 · 돌아오면 다시 불러옵니다</p>
      ) : (
        <Alert
          tone="danger"
          source="energy-dashboard"
          title="에너지 API에 연결할 수 없습니다."
          message="편집 중인 옥상 배치는 유지됩니다. 연결 복구 후 다시 시도하세요."
          detail={toKoreanEnergyError(state.error)}
          actions={[{ label: "다시 시도", onClick: state.retry }]}
        />
      ))}
      {state.status === "empty" && (
        <p data-qa="energy-empty" className="py-4 text-center text-body text-ink-muted">표시할 에너지 시나리오가 없습니다.</p>
      )}
      {state.status === "success" && (
        <>
          <ScenarioSummary scenario={state.data.scenario} />
          <KpiGrid data={state.data} />
          <EnergyChart data={state.data} />
          <Disclosure summary="지표 더 보기 · 공간별 수요 · 가정과 출처">
            <div className="flex flex-col gap-4">
              <KpiDetails data={state.data} />
              <RoomBreakdown data={state.data} />
              <ProvenancePanel data={state.data} />
            </div>
          </Disclosure>
        </>
      )}
    </section>
  );
}

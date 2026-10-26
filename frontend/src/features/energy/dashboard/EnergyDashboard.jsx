import { useMemo, useState } from "react";
import { createEnergyDashboardClient } from "./energyDashboardApi.mjs";
import { EnergyChart, KpiGrid, LossBreakdown, ProvenancePanel, RoomBreakdown } from "./EnergyDashboardPanels.jsx";
import { useEnergyDashboard } from "./useEnergyDashboard.js";
import { toKoreanEnergyError } from "../shared/energyErrorMessages.mjs";
import { CARD, FIELD_INPUT, FIELD_LABEL } from "../shared/fieldStyles.mjs";
import { Alert } from "../../../ui/Alert.jsx";
import { MetricList } from "../../../ui/MetricList.jsx";
import { SectionHeader } from "../../../ui/SectionHeader.jsx";
import { Skeleton } from "../../../ui/Skeleton.jsx";
import { Spinner } from "../../../ui/Spinner.jsx";

const DEFAULT_SCENARIO = "D4-scenario-south-2x8";
function localDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function ScenarioSummary({ scenario }) {
  const items = [
    { id: "name", label: "시나리오", value: <span className="text-body text-ink">{scenario.name}</span> },
    {
      id: "arrays",
      label: "배열",
      value: <span className="text-body tabular-nums text-ink">{`${scenario.arrayCount}개`}</span>,
    },
    {
      id: "weather",
      label: "기상 프리셋",
      value: <span className="text-body text-ink">{scenario.weatherPreset}</span>,
    },
  ];
  return <MetricList items={items} />;
}

export function EnergyDashboard({ buildingId = "D4", initialDate = localDate(), scenarios, client }) {
  const apiClient = useMemo(() => client ?? createEnergyDashboardClient(), [client]);
  const [date, setDate] = useState(initialDate);
  const [scenarioId, setScenarioId] = useState(scenarios?.[0]?.id ?? DEFAULT_SCENARIO);
  const state = useEnergyDashboard({ buildingId, date, scenarioId, client: apiClient });
  const options = scenarios ?? state.data?.scenarios ?? [{ id: scenarioId, label: "D4 기본 2×8" }];
  const title = state.status === "success" ? state.data.building.displayName : "건물 에너지 시뮬레이션";

  return (
    <section data-qa="energy-dashboard" className="flex flex-col gap-4 pb-4" aria-label="태양광 현황">
      <SectionHeader title={title} subtitle="태양광 현황" />
      {state.status === "success" && <ScenarioSummary scenario={state.data.scenario} />}
      <div className="grid grid-cols-2 gap-2">
        <label className={FIELD_LABEL}>
          날짜
          <input
            data-qa="energy-date"
            aria-label="시뮬레이션 날짜"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={FIELD_INPUT}
          />
        </label>
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
      </div>
      {state.status === "loading" && (
        <div data-qa="energy-loading" className={`${CARD} flex flex-col gap-3 p-4`}>
          <Skeleton shape="block" />
          <Spinner delayMs={0} label="에너지 시뮬레이션을 불러오는 중입니다." />
        </div>
      )}
      {state.status === "error" && (
        <Alert
          tone="danger"
          source="energy-dashboard"
          title="에너지 API에 연결할 수 없습니다."
          message="편집 중인 옥상 배치는 유지됩니다. 연결 복구 후 다시 시도하세요."
          detail={toKoreanEnergyError(state.error)}
          actions={[{ label: "다시 시도", onClick: state.retry }]}
        />
      )}
      {state.status === "empty" && (
        <div data-qa="energy-empty" className={`${CARD} p-6 text-center`}>
          <p className="text-body text-ink-muted">표시할 에너지 시나리오가 없습니다.</p>
          <p className="mt-2 text-caption text-ink-muted">태양광 설치 모드에서 배열을 저장하면 여기에 표시됩니다.</p>
        </div>
      )}
      {state.status === "success" && (
        <>
          <ProvenancePanel data={state.data} />
          <KpiGrid data={state.data} />
          <EnergyChart data={state.data} />
          <LossBreakdown data={state.data} />
          <RoomBreakdown data={state.data} />
        </>
      )}
    </section>
  );
}

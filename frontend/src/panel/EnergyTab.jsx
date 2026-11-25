import { cloneElement, isValidElement, useState } from "react";
import { isFeedDown } from "../hooks/feedStatusModel.mjs";
import { FeedAlert } from "./FeedStatus.jsx";
import { BuildingAnalysis } from "../features/energy/analysis";
import { CampusComparison } from "../features/energy/campus/CampusComparisonPanel";
import { EnergyDashboard } from "../features/energy/dashboard/EnergyDashboard";
import { FieldSelect } from "../features/energy/shared/FieldSelect.jsx";
import { kstToday, WEATHER_PRESETS } from "../features/energy/shared/energyContext.mjs";

// 에너지 탭: 맨 위 한 줄에 기준일(장면 날짜)과 기상 프리셋 하나, 그 아래 선택 건물 요약, 접힌 건물 분석, 캠퍼스 비교 표.
// 고른 건물이 없으면(hasSelection false) 캠퍼스 비교 표를 맨 앞에 두고 기본 건물(buildingId) 요약과 분석은 그 아래에 둔다.
// 에너지 피드가 끊기면 알림과 다시 시도는 맨 위 하나뿐이고, 아래 묶음은 기다린다는 한 줄만 적는다.
// campusOverview는 대표 설치 계획 지도 레이어 토글이다(부르는 쪽이 넣는다).
export function EnergyTab({ buildingId, hasSelection = true, plans, feedStatus, onRetry, campusOverview, onOpenRecommendation, sceneDate }) {
  const date = sceneDate ?? kstToday();
  const [weatherPreset, setWeatherPreset] = useState("clear");
  const feedDown = isFeedDown(feedStatus);
  // 레이어 토글도 피드가 끊긴 동안은 알림을 맨 위 하나에 맡긴다.
  const layerToggle = isValidElement(campusOverview) ? cloneElement(campusOverview, { feedDown }) : campusOverview;
  const comparison = (
    <CampusComparison
      date={date}
      weatherPreset={weatherPreset}
      feedDown={feedDown}
      onOpenRecommendation={onOpenRecommendation}
      layerToggle={layerToggle}
    />
  );
  return (
    <>
      <div data-qa="energy-context" className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-ink-muted">
          기준일 (장면 날짜) <time dateTime={date} className="font-semibold tabular-nums text-ink">{date}</time>
        </p>
        <FieldSelect
          data-qa="energy-weather-preset"
          label="기상 프리셋"
          value={weatherPreset}
          onValueChange={setWeatherPreset}
          options={WEATHER_PRESETS.map(([value, label]) => ({ value, label }))}
          className="flex-row items-center gap-2"
          triggerClassName="w-32"
        />
      </div>
      {feedDown && <FeedAlert feed="energy" status={feedStatus} onRetry={onRetry} />}
      {!hasSelection && comparison}
      <section role="region" aria-label={`${buildingId} 건물 전력 현황`}>
        <EnergyDashboard key={buildingId} buildingId={buildingId} date={date} feedDown={feedDown} />
      </section>
      <BuildingAnalysis
        key={`${buildingId}:${plans.representativePlanId ?? "none"}`}
        buildingId={buildingId}
        plans={plans.plans}
        plansStatus={plans.status}
        representativePlanId={plans.representativePlanId}
        date={date}
        weatherPreset={weatherPreset}
      />
      {hasSelection && comparison}
    </>
  );
}

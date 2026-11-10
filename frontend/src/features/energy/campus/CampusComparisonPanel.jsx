import { ArrowDown, ArrowUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseCampusComparison, parseRecommendationResponse } from "./campusComparison.mjs";
import { toKoreanEnergyError } from "../shared/energyErrorMessages.mjs";
import { WEATHER_API_URL } from "../../../simulation/utils/apiConfig.js";
import { kstToday } from "../shared/energyContext.mjs";
import { GROUP } from "../shared/fieldStyles.mjs";
import { Alert } from "../../../ui/Alert.jsx";
import { Button, FOCUS_RING } from "../../../ui/Button.jsx";
import { Disclosure } from "../../../ui/Disclosure.jsx";
import { SectionHeader } from "../../../ui/SectionHeader.jsx";
import { Skeleton } from "../../../ui/Skeleton.jsx";
import { StatusBadge } from "../../../ui/StatusBadge.jsx";
import { ExportActions } from "../../../ui/ExportActions.jsx";
import { formatDayLabel } from "../../../ui/format.mjs";

async function json(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail?.message_ko ?? `에너지 API 요청 실패 (HTTP ${response.status})`);
  return body;
}

export function createCampusComparisonClient(apiBase = WEATHER_API_URL, fetchImpl = fetch) {
  return {
    async load({ date, weatherPreset, signal }) {
      const response = await fetchImpl(
        `${apiBase}/energy/rankings?date=${encodeURIComponent(date)}`
          + `&weather_preset=${encodeURIComponent(weatherPreset)}&representative_only=true`,
        { signal, headers: { Accept: "application/json" } },
      );
      return parseCampusComparison(await json(response), { date, weatherPreset });
    },
    async recommend({ sourceScenarioId, date }) {
      const response = await fetchImpl(
        `${apiBase}/energy/scenarios/${encodeURIComponent(sourceScenarioId)}/recommend`,
        {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ date }),
        },
      );
      return parseRecommendationResponse(await json(response), { sourceScenarioId });
    },
  };
}

const STATUS_LABELS = { simulated: "시뮬레이션 완료", incomplete: "정보 불완전", no_scenario: "시나리오 없음" };
// 내보내기에는 점수 구성까지 모두 싣는다(분석가용). 화면 표는 아래 COLUMNS만 보인다.
const COMPONENTS = [
  ["annualizedYield", "연환산 발전량"],
  ["roofUtilization", "옥상 활용"],
  ["selfSufficiency", "자급률"],
  ["gridReduction", "계통전력 절감"],
  ["constraints", "제약 위반"],
];
const percent = (value) => `${(value * 100).toFixed(1)}%`;
// 화면 표의 정렬 가능한 열: [키, 머리글, 정렬값, 표시값].
const COLUMNS = [
  ["rank", "순위", (item) => item.rank, (item) => `${item.rank}위`],
  ["score", "점수", (item) => item.score, (item) => percent(item.score)],
  ["yield", "kWh/kWp", (item) => item.metrics.annualizedKwhPerKwp, (item) => item.metrics.annualizedKwhPerKwp.toFixed(0)],
  ["roof", "옥상 사용률", (item) => item.metrics.roofUtilizationRatio, (item) => percent(item.metrics.roofUtilizationRatio)],
  ["violations", "위반", (item) => item.metrics.constraintViolationCount, (item) => `${item.metrics.constraintViolationCount}건`],
];
const EXPORT_ROWS = [
  ["순위", (item) => `${item.rank}위`],
  ["점수", (item) => percent(item.score)],
  ...COMPONENTS.map(([key, label]) => [label, (item) => percent(item.components[key])]),
  ["kWh/kWp/년", (item) => item.metrics.annualizedKwhPerKwp.toFixed(0)],
  ["옥상 사용률", (item) => percent(item.metrics.roofUtilizationRatio)],
  ["위반 건수", (item) => `${item.metrics.constraintViolationCount}건`],
];
const cell = "border-b border-hairline px-2 py-2 text-right tabular-nums";
const headCell = "border-b border-hairline px-1 py-1 text-right font-medium text-ink-muted";

export function sortRanked(ranked, { key, direction }) {
  const column = COLUMNS.find(([id]) => id === key) ?? COLUMNS[0];
  const sign = direction === "desc" ? -1 : 1;
  return [...ranked].sort((first, second) => sign * (column[2](first) - column[2](second)) || first.rank - second.rank);
}

// 캠퍼스 비교 표 하나: 행은 건물, 열은 순위·점수·kWh/kWp·옥상 사용률·위반·배치 편집. 열 머리글로 정렬한다.
// 결과가 아직 없으면(불러오는 중, 실패, 빈 결과) 표 틀은 그대로 두고 본문 한 줄에 그 상태(status)를 넣는다.
function ComparisonTable({ ranked, status, onOpenRecommendation }) {
  const [sort, setSort] = useState({ key: "rank", direction: "asc" });
  const rows = sortRanked(ranked, sort);
  const toggle = (key) => setSort((current) => (
    current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "rank" || key === "violations" ? "asc" : "desc" }
  ));
  return (
    <div className="overflow-x-auto">
      <table data-qa="campus-comparison-table" className="w-full border-collapse text-caption text-ink">
        <caption className="sr-only">캠퍼스 비교 · 건물별 태양광 추천 (추정)</caption>
        <thead>
          <tr>
            <th scope="col" className="border-b border-hairline px-2 py-1 text-left font-medium text-ink-muted">건물</th>
            {COLUMNS.map(([key, label]) => {
              const active = sort.key === key;
              const Arrow = sort.direction === "asc" ? ArrowUp : ArrowDown;
              return (
                <th key={key} scope="col" aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"} className={headCell}>
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    className={`inline-flex min-h-8 items-center gap-1 rounded-control px-1 hover:text-ink ${active ? "text-ink" : ""} ${FOCUS_RING}`}
                  >
                    {label}
                    {active && <Arrow aria-hidden="true" className="h-3 w-3" />}
                  </button>
                </th>
              );
            })}
            <th scope="col" className={headCell}><span className="sr-only">배치</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length + 2} className="border-b border-hairline px-2 py-3">{status}</td>
            </tr>
          )}
          {rows.map((item) => (
            <tr key={item.scenarioId} data-status="simulated">
              <th scope="row" className="border-b border-hairline px-2 py-2 text-left font-medium break-keep">{item.buildingName}</th>
              {COLUMNS.map(([key, , , show]) => <td key={key} className={cell}>{show(item)}</td>)}
              <td className="border-b border-hairline px-1 py-1 text-right">
                {onOpenRecommendation && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`${item.buildingName} 배치 편집`}
                    onClick={() => onOpenRecommendation({ scenarioId: item.scenarioId, buildingId: item.buildingId })}
                  >
                    배치 편집
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {ranked.length > 0 && <ExportActions
        kind="energy"
        className="mt-2"
        columns={[{ key: "building", label: "건물" }, ...EXPORT_ROWS.map(([label]) => ({ key: label, label, estimated: true }))]}
        rows={ranked.map((item) => ({ building: item.buildingName, ...Object.fromEntries(EXPORT_ROWS.map(([label, read]) => [label, read(item)])) }))}
      />}
    </div>
  );
}

// 같은 기준일(장면 날짜)·기상 프리셋의 대표 설치안을 비교한다. 날짜와 프리셋은 에너지 탭 맨 위 한 줄이 정한다.
// layerToggle은 대표 설치 계획 지도 레이어 토글이다. feedDown이면 실패 알림을 탭 맨 위에 맡기고 한 줄만 적는다.
export function CampusComparison({ client, date = kstToday(), weatherPreset = "clear", onOpenRecommendation, feedDown = false, layerToggle = null }) {
  const api = useMemo(() => client ?? createCampusComparisonClient(), [client]);
  const [state, setState] = useState({ status: "loading", data: null, error: "" });
  const load = useCallback(() => {
    const controller = new AbortController();
    setState({ status: "loading", data: null, error: "" });
    api
      .load({ date, weatherPreset, signal: controller.signal })
      .then((data) => setState({ status: "success", data, error: "" }))
      .catch((error) => {
        if (error?.name !== "AbortError") setState({ status: "error", data: null, error: toKoreanEnergyError(error) });
      });
    return () => controller.abort();
  }, [api, date, weatherPreset]);
  useEffect(load, [load]);
  // 끊겼던 에너지 피드가 돌아오면 한 번 다시 불러온다.
  const wasDownRef = useRef(feedDown);
  useEffect(() => {
    if (wasDownRef.current && !feedDown) load();
    wasDownRef.current = feedDown;
  }, [feedDown, load]);
  const ranked = state.status === "success" ? state.data.ranked : [];
  const excluded = state.status === "success" ? state.data.excluded : [];
  let status = null;
  if (state.status === "loading") {
    status = (
      <div className="flex flex-col gap-2">
        <Skeleton lines={3} />
        <p role="status" className="sr-only">동일 조건 비교 중</p>
      </div>
    );
  } else if (state.status === "error") {
    status = feedDown ? (
      <p role="status" className="break-keep text-caption text-ink-muted">에너지 연결을 기다리는 중 · 돌아오면 다시 불러옵니다</p>
    ) : (
      <Alert
        tone="danger"
        source="campus-comparison"
        title="비교 API를 불러오지 못했습니다."
        message={state.error}
        actions={[{ label: "다시 시도", onClick: load }]}
      />
    );
  } else {
    status = <p className="py-1 text-center text-body text-ink-muted">비교할 대표 설치안이 없습니다</p>;
  }
  return (
    <section data-qa="campus-comparison" className={`${GROUP} flex flex-col gap-3`} aria-labelledby="campus-comparison-title">
      <SectionHeader id="campus-comparison-title" title="캠퍼스 비교" actions={layerToggle} />
      <p className="break-keep text-caption text-[var(--colors-estimate-ink)]">
        {`추정 · 시뮬레이션 기준일 ${formatDayLabel(date)} · 수요는 가상 예측, 일사량은 시나리오, 365일 연환산`}
      </p>
      <ComparisonTable ranked={ranked} status={status} onOpenRecommendation={onOpenRecommendation} />
      {excluded.length > 0 && (
        <Disclosure summary={`비교 제외 건물 ${excluded.length}곳`}>
          <ul className="flex flex-col" aria-label="비교 제외 건물">
            {excluded.map((item) => (
              <li
                key={`${item.buildingId}-${item.scenarioId ?? "none"}`}
                data-status={item.buildingStatus}
                className="border-b border-hairline py-2 text-caption last:border-b-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <strong className="break-keep font-semibold text-ink">{item.buildingName}</strong>
                  <StatusBadge tone="neutral">{STATUS_LABELS[item.buildingStatus]}</StatusBadge>
                </div>
                <p className="mt-1 break-keep text-ink-muted">{item.reasonLabel}</p>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}

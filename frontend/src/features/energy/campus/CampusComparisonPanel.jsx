import { ArrowUpRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseCampusComparison, parseRecommendationResponse } from "./campusComparison.mjs";
import { toKoreanEnergyError } from "../shared/energyErrorMessages.mjs";
import { WEATHER_API_URL } from "../../../simulation/utils/apiConfig.js";
import { CARD, FIELD_INPUT, FIELD_LABEL } from "../shared/fieldStyles.mjs";
import { Alert } from "../../../ui/Alert.jsx";
import { Button } from "../../../ui/Button.jsx";
import { SectionHeader } from "../../../ui/SectionHeader.jsx";
import { Spinner } from "../../../ui/Spinner.jsx";
import { StatusBadge } from "../../../ui/StatusBadge.jsx";
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
const COMPONENTS = [
  ["annualizedYield", "연환산 발전량"],
  ["roofUtilization", "옥상 활용"],
  ["selfSufficiency", "자급률"],
  ["gridReduction", "계통전력 절감"],
  ["constraints", "제약 위반"],
];
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const cell = "border-b border-hairline px-2 py-1.5 text-right tabular-nums";
const rowHeader = "border-b border-hairline px-2 py-1.5 text-left font-medium text-ink-muted";

// 같은 날짜·기상 프리셋의 대표 설치안을 표로 비교한다. 열은 건물(순위 순), 행은 지표.
function ComparisonTable({ ranked, onOpenRecommendation }) {
  const rows = [
    ["점수", (item) => percent(item.score)],
    ...COMPONENTS.map(([key, label]) => [label, (item) => percent(item.components[key])]),
    ["kWh/kWp/년", (item) => item.metrics.annualizedKwhPerKwp.toFixed(0)],
    ["옥상 사용률", (item) => percent(item.metrics.roofUtilizationRatio)],
    ["위반 건수", (item) => `${item.metrics.constraintViolationCount}건`],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-caption text-ink">
        <caption className="sr-only">건물별 태양광 추천 비교</caption>
        <thead>
          <tr>
            <th scope="col" className={rowHeader}>
              지표
            </th>
            {ranked.map((item) => (
              <th
                key={item.scenarioId}
                scope="col"
                data-status="simulated"
                className="border-b border-hairline px-2 py-1.5 text-right align-bottom"
              >
                <span className="block text-micro text-ink-muted">
                  {`${item.rank}위 · ${STATUS_LABELS[item.buildingStatus]}`}
                </span>
                <span className="block break-keep font-semibold">{item.buildingName}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, read]) => (
            <tr key={label}>
              <th scope="row" className={rowHeader}>
                {label}
              </th>
              {ranked.map((item) => (
                <td key={item.scenarioId} className={cell}>
                  {read(item)}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row" className={rowHeader}>
              배치
            </th>
            {ranked.map((item) => (
              <td key={item.scenarioId} className="px-2 py-1.5 text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${item.buildingName} 배치 편집`}
                  onClick={() => onOpenRecommendation({ scenarioId: item.scenarioId, buildingId: item.buildingId })}
                >
                  배치 편집
                </Button>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function CampusComparison({ client, initialDate = "2026-05-18", onOpenRecommendation = () => {} }) {
  const api = useMemo(() => client ?? createCampusComparisonClient(), [client]);
  const [date, setDate] = useState(initialDate);
  const [weatherPreset, setWeatherPreset] = useState("clear");
  const [state, setState] = useState({ status: "loading", data: null, error: "" });
  const [opening, setOpening] = useState(false);
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
  const top = state.data?.ranked?.[0];
  const openTop = async () => {
    if (!top || opening) return;
    setOpening(true);
    try {
      const scenario = await api.recommend({ sourceScenarioId: top.scenarioId, date });
      onOpenRecommendation({ scenarioId: scenario.id, buildingId: scenario.buildingId });
    } catch (error) {
      setState((current) => ({ ...current, status: "error", error: toKoreanEnergyError(error) }));
    } finally {
      setOpening(false);
    }
  };
  return (
    <section
      data-qa="campus-comparison"
      className={`${CARD} flex flex-col gap-3 p-3`}
      aria-labelledby="campus-comparison-title"
    >
      <SectionHeader id="campus-comparison-title" title="캠퍼스 비교" subtitle="건물별 태양광 추천" />
      <div className="grid grid-cols-2 gap-2">
        <label className={FIELD_LABEL}>
          비교 날짜
          <input
            aria-label="캠퍼스 비교 날짜"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={FIELD_INPUT}
          />
        </label>
        <label className={FIELD_LABEL}>
          기상 프리셋
          <select
            aria-label="캠퍼스 비교 기상 프리셋"
            value={weatherPreset}
            onChange={(event) => setWeatherPreset(event.target.value)}
            className={FIELD_INPUT}
          >
            <option value="clear">맑음</option>
            <option value="partly_cloudy">부분 흐림</option>
            <option value="overcast">흐림</option>
          </select>
        </label>
      </div>
      {state.status === "loading" && (
        <Spinner delayMs={0} label="동일 조건 비교 중" className="min-h-16 justify-center" />
      )}
      {state.status === "error" && (
        <Alert
          tone="danger"
          source="campus-comparison"
          title="비교 API를 불러오지 못했습니다."
          message={state.error}
          actions={[{ label: "다시 시도", onClick: load }]}
        />
      )}
      {state.status === "success" && (
        <>
          <p className="break-keep text-caption text-ink-muted">
            같은 날짜·기상 프리셋만 비교합니다. 수요는 가상 예측, 일사량은 시나리오 추정이며 365일로 연환산합니다.
          </p>
          <p className="text-caption text-[var(--colors-estimate-ink)]">{`추정 · 시뮬레이션 기준일 ${formatDayLabel(date)}`}</p>
          {state.data.ranked.length === 0 ? (
            <p className="py-4 text-center text-body text-ink-muted">비교할 대표 설치안이 없습니다</p>
          ) : (
            <ComparisonTable ranked={state.data.ranked} onOpenRecommendation={onOpenRecommendation} />
          )}
          {top && (
            <Button
              aria-label="1위 추천을 새 편집 시나리오로 열기"
              onClick={openTop}
              loading={opening}
              icon={<ArrowUpRight aria-hidden="true" className="h-4 w-4" />}
              className="w-full"
            >
              1위 추천을 새 시나리오로 열기
            </Button>
          )}
          {state.data.excluded.length > 0 && (
            <ul className="flex flex-col gap-1" aria-label="비교 제외 건물">
              {state.data.excluded.map((item) => (
                <li
                  key={`${item.buildingId}-${item.scenarioId ?? "none"}`}
                  data-status={item.buildingStatus}
                  className="rounded-control border border-hairline px-3 py-2 text-caption"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="break-keep font-semibold text-ink">{item.buildingName}</strong>
                    <StatusBadge tone="neutral">{STATUS_LABELS[item.buildingStatus]}</StatusBadge>
                  </div>
                  <p className="mt-1 break-keep text-ink-muted">{item.reasonLabel}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

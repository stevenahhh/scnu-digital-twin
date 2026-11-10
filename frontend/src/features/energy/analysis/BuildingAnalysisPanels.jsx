import { formatEnergy, formatPercent } from "../dashboard/dashboardFormatting.mjs";
import { simulationCaption } from "../dashboard/EnergyDashboardPanels.jsx";
import { buildAnalysisInsights } from "./analysisContracts.mjs";
import { ChartLegend, SERIES_COLORS } from "../shared/ChartLegend.jsx";
import { Disclosure } from "../../../ui/Disclosure.jsx";
import { EstimateValue } from "../../../ui/EstimateValue.jsx";
import { MetricList } from "../../../ui/MetricList.jsx";
import { SectionHeader } from "../../../ui/SectionHeader.jsx";

function line(values, max, width = 640, height = 170) {
  return values
    .map(
      (value, index) =>
        `${index ? "L" : "M"}${(index / (values.length - 1)) * width} ${height - (value / max) * (height - 10)}`,
    )
    .join(" ");
}

// 분석 결과 지표: 헤드라인 4개가 먼저 보이고 나머지는 펼침 안에 있다.
export function AnalysisKpis({ run }) {
  const headline = [
    ["대표 계획 발전", formatEnergy(run.kpis.proposed.generationEnergyKwh)],
    ["계통전력 절감", formatEnergy(run.deltas.gridImportReductionEnergyKwh)],
    ["비용 절감", `${Math.round(run.deltas.costSavingsKrw).toLocaleString("ko-KR")} KRW`],
    ["대표 계획 자급률", formatPercent(run.deltas.selfSufficiencyRatio)],
  ];
  const details = [
    ["무태양광 기준 수요", formatEnergy(run.kpis.baseline.demandEnergyKwh)],
    ...(run.kpis.alternative
      ? [
          ["대안 계획 발전", formatEnergy(run.kpis.alternative.generationEnergyKwh)],
          ["대표 대비 발전 차이", formatEnergy(run.deltas.alternativeGenerationDifferenceEnergyKwh)],
        ]
      : []),
    ["계통전력 절감률", formatPercent(run.deltas.gridImportReductionRatio)],
    ["탄소 감축", `${run.deltas.carbonReductionKgCo2e.toFixed(1)} kgCO2`],
    ["잉여 발전", formatEnergy(run.kpis.proposed.surplusEnergyKwh)],
  ];
  const items = (rows) => rows.map(([label, value]) => ({ id: label, label, value: <EstimateValue value={value} /> }));
  return (
    <section aria-label="단일 건물 분석 KPI" className="flex flex-col gap-2">
      <MetricList columns={2} items={items(headline)} caption={simulationCaption(run.date)} />
      <Disclosure summary="지표 더 보기">
        <MetricList items={items(details)} />
      </Disclosure>
    </section>
  );
}

export function AnalysisSeriesChart({ run }) {
  const demand = run.series.map((item) => item.demandEnergyKwh);
  const proposed = run.series.map((item) => item.proposedGenerationEnergyKwh);
  const alternative = run.series.map((item) => item.alternativeGenerationEnergyKwh ?? 0);
  const gridDraw = run.series.map((item) => item.gridImportEnergyKwh);
  const max = Math.max(...demand, ...proposed, ...alternative, ...gridDraw, 0.001);
  const stroke = { fill: "none", vectorEffect: "non-scaling-stroke" };
  const legend = [
    { label: "수요", color: SERIES_COLORS.demand },
    { label: "계통 인입", color: SERIES_COLORS.grid, dashed: true },
    { label: "대표 계획", color: SERIES_COLORS.generation },
    ...(run.kpis.alternative ? [{ label: "대안 계획", color: SERIES_COLORS.alternative, dashed: true }] : []),
  ];
  return (
    <section className="overflow-hidden" aria-labelledby="analysis-series-title">
      <SectionHeader id="analysis-series-title" title="수요·기준선·설치 계획" />
      <svg
        role="img"
        aria-label="96개 15분 구간의 수요, 계통 인입과 대표 및 대안 설치 계획 발전량"
        viewBox="0 0 640 170"
        preserveAspectRatio="none"
        className="mt-3 h-40 w-full"
      >
        <path d={line(demand, max)} stroke={SERIES_COLORS.demand} strokeWidth="2.5" {...stroke} />
        <path
          data-series="grid-draw"
          d={line(gridDraw, max)}
          stroke={SERIES_COLORS.grid}
          strokeDasharray="3 3"
          strokeWidth="2"
          {...stroke}
        />
        <path d={line(proposed, max)} stroke={SERIES_COLORS.generation} strokeWidth="2.5" {...stroke} />
        {run.kpis.alternative && (
          <path
            d={line(alternative, max)}
            stroke={SERIES_COLORS.alternative}
            strokeDasharray="5 4"
            strokeWidth="2"
            {...stroke}
          />
        )}
      </svg>
      <ChartLegend items={legend} note="무태양광 기준 발전: 0 kWh" />
    </section>
  );
}

// 규칙 기반 해석은 결과의 맨 위에 둔다. 목록 기호는 ul 구조가 맡고 항목마다 아이콘을 달지 않는다.
export function AnalysisInsights({ run }) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby="analysis-insights-title">
      <SectionHeader id="analysis-insights-title" title="규칙 기반 해석" />
      <ul className="flex list-disc flex-col gap-2 pl-5">
        {buildAnalysisInsights(run).map((item) => (
          <li key={item.id} className="break-keep text-body text-ink-muted">
            {item.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

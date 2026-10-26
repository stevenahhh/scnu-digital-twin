import { Lightbulb, TrendingDown } from "lucide-react";
import { formatEnergy, formatPercent } from "../dashboard/dashboardFormatting.mjs";
import { simulationCaption } from "../dashboard/EnergyDashboardPanels.jsx";
import { buildAnalysisInsights } from "./analysisContracts.mjs";
import { CARD } from "../shared/fieldStyles.mjs";
import { ChartLegend, SERIES_COLORS } from "../shared/ChartLegend.jsx";
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

export function AnalysisKpis({ run }) {
  const values = [
    ["무태양광 기준 수요", formatEnergy(run.kpis.baseline.demandEnergyKwh)],
    ["대표 계획 발전", formatEnergy(run.kpis.proposed.generationEnergyKwh)],
    ...(run.kpis.alternative
      ? [
          ["대안 계획 발전", formatEnergy(run.kpis.alternative.generationEnergyKwh)],
          ["대표 대비 발전 차이", formatEnergy(run.deltas.alternativeGenerationDifferenceEnergyKwh)],
        ]
      : []),
    ["계통전력 절감", formatEnergy(run.deltas.gridImportReductionEnergyKwh)],
    ["계통전력 절감률", formatPercent(run.deltas.gridImportReductionRatio)],
    ["비용 절감", `${Math.round(run.deltas.costSavingsKrw).toLocaleString("ko-KR")} KRW`],
    ["탄소 감축", `${run.deltas.carbonReductionKgCo2e.toFixed(1)} kgCO2`],
    ["대표 계획 자급률", formatPercent(run.deltas.selfSufficiencyRatio)],
    ["잉여 발전", formatEnergy(run.kpis.proposed.surplusEnergyKwh)],
  ];
  return (
    <section aria-label="단일 건물 분석 KPI" className={`${CARD} p-4`}>
      <MetricList
        items={values.map(([label, value]) => ({ id: label, label, value: <EstimateValue value={value} /> }))}
        caption={simulationCaption(run.date)}
      />
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
    <section className={`${CARD} overflow-hidden p-4`}>
      <SectionHeader title="수요·기준선·설치 계획" subtitle="96개 15분 구간 · 실행 스냅샷" />
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

export function AnalysisInsights({ run }) {
  return (
    <section className={`${CARD} flex flex-col gap-3 p-4`} aria-labelledby="analysis-insights-title">
      <h3 id="analysis-insights-title" className="flex items-center gap-2 text-body font-semibold text-ink">
        <Lightbulb aria-hidden="true" className="h-4 w-4" />
        규칙 기반 해석
      </h3>
      <ul className="flex flex-col gap-2">
        {buildAnalysisInsights(run).map((item) => (
          <li key={item.id} className="flex gap-2 break-keep text-body text-ink-muted">
            <TrendingDown aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            {item.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

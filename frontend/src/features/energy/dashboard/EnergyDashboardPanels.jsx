import { formatCarbon, formatEnergy, formatKrw, formatPercent } from "./dashboardFormatting.mjs";
import { CARD } from "../shared/fieldStyles.mjs";
import { ChartLegend, SERIES_COLORS } from "../shared/ChartLegend.jsx";
import { EstimateValue } from "../../../ui/EstimateValue.jsx";
import { MetricList } from "../../../ui/MetricList.jsx";
import { SectionHeader } from "../../../ui/SectionHeader.jsx";
import { StatusBadge } from "../../../ui/StatusBadge.jsx";
import { formatDayLabel } from "../../../ui/format.mjs";

// 에너지 값은 모두 시뮬레이션 추정이다. 출처는 묶음마다 한 번, `시뮬레이션 기준일 5월 18일`처럼 적는다.
export const simulationCaption = (date) => `추정 · 시뮬레이션 기준일 ${formatDayLabel(date)}`;
const text = (value) => <span className="text-body font-medium text-ink">{value}</span>;

export function ProvenancePanel({ data }) {
  return (
    <section
      data-qa="energy-provenance"
      className={`${CARD} flex flex-col gap-3 p-4`}
      aria-labelledby="energy-provenance-title"
    >
      <SectionHeader id="energy-provenance-title" title="가정과 데이터 출처" />
      <MetricList
        columns={2}
        items={[
          { id: "demand", label: "소비 전력", value: text("가상 예측") },
          { id: "irradiance", label: "일사량", value: text("시나리오/추정") },
          { id: "model", label: "모델", value: text(data.provenance.model) },
          { id: "interval", label: "간격", value: text("15분 · Asia/Seoul") },
          { id: "price", label: "절감 가정", value: text("160 KRW/kWh") },
          { id: "carbon", label: "탄소계수", value: text("0.45 kgCO₂e/kWh") },
        ]}
        caption="공학 보정 전 시뮬레이션"
      />
    </section>
  );
}

const KPI_DEFS = [
  ["예측 소비", "predictedDemandEnergyKwh", formatEnergy],
  ["태양광 발전", "generationEnergyKwh", formatEnergy],
  ["자급률", "selfSufficiencyRatio", formatPercent],
  ["외부 전력", "gridImportEnergyKwh", formatEnergy],
  ["잉여 발전", "surplusEnergyKwh", formatEnergy],
  ["전기료 절감", "savingsKrw", formatKrw],
  ["탄소 회피", "carbonAvoidedKgCo2e", formatCarbon],
];
export function KpiGrid({ data }) {
  const items = KPI_DEFS.map(([label, key, format]) => ({
    id: key,
    label:
      key === "predictedDemandEnergyKwh" ? (
        <span className="inline-flex items-center gap-1">
          {label}
          <StatusBadge tone="neutral">가상 예측</StatusBadge>
        </span>
      ) : (
        label
      ),
    value: <EstimateValue value={format(data.kpis[key])} />,
  }));
  return (
    <section data-qa="energy-kpi" aria-label="에너지 핵심 지표" className={`${CARD} p-4`}>
      <MetricList items={items} caption={simulationCaption(data.date)} />
    </section>
  );
}

function path(values, max, width = 640, height = 180) {
  return values
    .map((value, index) => `${index ? "L" : "M"}${(index / 95) * width} ${height - (value / max) * (height - 12)}`)
    .join(" ");
}
export function EnergyChart({ data }) {
  const demand = data.chart.map((item) => item.predictedDemandEnergyKwh);
  const generation = data.chart.map((item) => item.generationEnergyKwh);
  const irradiance = data.chart.map((item) => item.irradianceWm2);
  const energyMax = Math.max(...demand, ...generation, 0.001);
  const irradianceMax = Math.max(...irradiance, 1);
  const stroke = { fill: "none", vectorEffect: "non-scaling-stroke" };
  return (
    <section data-qa="energy-chart" className={`${CARD} overflow-hidden p-4`} aria-labelledby="energy-chart-title">
      <SectionHeader id="energy-chart-title" title="수요와 발전" subtitle="같은 15분 시간축 · 에너지 kWh" />
      <svg
        role="img"
        aria-label="96개 15분 구간의 가상 예측 수요와 시나리오 발전 비교"
        viewBox="0 0 640 180"
        className="mt-4 h-[180px] w-full"
        preserveAspectRatio="none"
      >
        {[0, 45, 90, 135, 180].map((y) => (
          <line key={y} x1="0" x2="640" y1={y} y2={y} stroke="var(--colors-hairline)" />
        ))}
        <path
          d={path(irradiance, irradianceMax)}
          stroke={SERIES_COLORS.irradiance}
          strokeDasharray="4 5"
          strokeWidth="1.5"
          {...stroke}
        />
        <path d={path(demand, energyMax)} stroke={SERIES_COLORS.demand} strokeWidth="2.5" {...stroke} />
        <path d={path(generation, energyMax)} stroke={SERIES_COLORS.generation} strokeWidth="2.5" {...stroke} />
      </svg>
      <ChartLegend
        items={[
          { label: "수요 · 가상 예측", color: SERIES_COLORS.demand },
          { label: "발전", color: SERIES_COLORS.generation },
          { label: "일사량 · 시나리오/추정", color: SERIES_COLORS.irradiance, dashed: true },
        ]}
      />
    </section>
  );
}

export function LossBreakdown({ data }) {
  const loss = formatPercent(data.losses.systemLossFraction);
  return (
    <section data-qa="energy-loss" className={`${CARD} flex flex-col gap-2 p-4`} aria-labelledby="energy-loss-title">
      <SectionHeader id="energy-loss-title" title="발전 손실 구조" />
      <div className="flex items-center justify-between text-body text-ink-muted">
        <span>시스템 손실</span>
        <strong className="font-semibold tabular-nums text-ink">{loss}</strong>
      </div>
      <div className="h-2 overflow-hidden rounded-pill bg-surface-3">
        <div className="h-full bg-primary" style={{ width: loss }} />
      </div>
      <p className="break-keep text-caption text-ink-muted">
        배선·인버터 등 모델 일괄 계수입니다. 개별 손실 에너지는 API가 제공하지 않아 표시하지 않습니다.
      </p>
    </section>
  );
}

export function RoomBreakdown({ data }) {
  const max = Math.max(...data.roomTypes.map((item) => item.energyKwh));
  const ranked = [...data.roomTypes].sort((a, b) => b.energyKwh - a.energyKwh);
  return (
    <section
      data-qa="energy-room-breakdown"
      className={`${CARD} flex flex-col gap-3 p-4`}
      aria-labelledby="energy-room-title"
    >
      <SectionHeader id="energy-room-title" title="공간 유형별 수요" subtitle="가상 시간표·설비 부하 가정" />
      {ranked.length === 0 ? (
        <p className="text-body text-ink-muted">이 비교 건물의 공간 유형별 상세 수요는 제공되지 않습니다.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {ranked.map((item) => (
            <li key={item.type}>
              <div className="flex items-center justify-between text-body text-ink-muted">
                <span>{item.label}</span>
                <strong className="font-semibold tabular-nums text-ink">{formatEnergy(item.energyKwh)}</strong>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-surface-3">
                <div className="h-full bg-primary" style={{ width: `${(item.energyKwh / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

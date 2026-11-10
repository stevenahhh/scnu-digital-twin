import { formatCarbon, formatEnergy, formatKrw, formatPercent } from "./dashboardFormatting.mjs";
import { GROUP } from "../shared/fieldStyles.mjs";
import { ChartLegend, SERIES_COLORS } from "../shared/ChartLegend.jsx";
import { Disclosure } from "../../../ui/Disclosure.jsx";
import { EstimateValue } from "../../../ui/EstimateValue.jsx";
import { MetricList } from "../../../ui/MetricList.jsx";
import { SectionHeader } from "../../../ui/SectionHeader.jsx";
import { formatDayLabel } from "../../../ui/format.mjs";

// 에너지 값은 모두 시뮬레이션 추정이다. 출처는 묶음마다 한 번, `시뮬레이션 기준일 5월 18일`처럼 적는다.
export const simulationCaption = (date) => `추정 · 시뮬레이션 기준일 ${formatDayLabel(date)}`;
const text = (value) => <span className="text-body font-medium text-ink">{value}</span>;

// 가정과 데이터 출처. 시스템 손실 계수도 가정의 한 줄이다.
export function ProvenancePanel({ data }) {
  return (
    <section data-qa="energy-provenance" className={`${GROUP} flex flex-col gap-3`} aria-labelledby="energy-provenance-title">
      <SectionHeader id="energy-provenance-title" title="가정과 데이터 출처" />
      <MetricList
        columns={2}
        items={[
          { id: "demand", label: "소비 전력", value: text("가상 예측") },
          { id: "irradiance", label: "일사량", value: text("시나리오/추정") },
          { id: "interval", label: "간격", value: text("15분 · 한국 표준시") },
          { id: "loss", label: "시스템 손실", value: text(formatPercent(data.losses.systemLossFraction)) },
          { id: "price", label: "절감 가정", value: text("160 KRW/kWh") },
          { id: "carbon", label: "탄소계수", value: text("0.45 kgCO₂e/kWh") },
        ]}
        caption="공학 보정 전 시뮬레이션"
      />
    </section>
  );
}

// 맨 위 핵심 지표 4개(수요, 발전, 자급률, 절감)와 펼침 안의 나머지 3개.
const HEADLINE_KPIS = [
  ["수요", "predictedDemandEnergyKwh", formatEnergy],
  ["발전", "generationEnergyKwh", formatEnergy],
  ["자급률", "selfSufficiencyRatio", formatPercent],
  ["절감", "savingsKrw", formatKrw],
];
const DETAIL_KPIS = [
  ["외부 전력", "gridImportEnergyKwh", formatEnergy],
  ["잉여 발전", "surplusEnergyKwh", formatEnergy],
  ["탄소 회피", "carbonAvoidedKgCo2e", formatCarbon],
];
const kpiItems = (defs, data) => defs.map(([label, key, format]) => ({ id: key, label, value: <EstimateValue value={format(data.kpis[key])} /> }));

export function KpiGrid({ data }) {
  return (
    <section data-qa="energy-kpi" aria-label="에너지 핵심 지표">
      <MetricList columns={2} items={kpiItems(HEADLINE_KPIS, data)} caption={simulationCaption(data.date)} />
    </section>
  );
}

export function KpiDetails({ data }) {
  return (
    <section data-qa="energy-kpi-details" aria-label="에너지 세부 지표">
      <MetricList items={kpiItems(DETAIL_KPIS, data)} />
    </section>
  );
}

function path(values, max, width = 640, height = 180) {
  return values
    .map((value, index) => `${index ? "L" : "M"}${(index / 95) * width} ${height - (value / max) * (height - 12)}`)
    .join(" ");
}

// 15분 구간 96개를 시각별 합계 24행으로 묶는다(표 보기).
function hourlyRows(chart) {
  const rows = Array.from({ length: 24 }, (_, hour) => ({ hour, demand: 0, generation: 0 }));
  chart.forEach((item, index) => {
    const row = rows[Math.floor(index / 4)];
    if (!row) return;
    row.demand += item.predictedDemandEnergyKwh;
    row.generation += item.generationEnergyKwh;
  });
  return rows;
}

export function EnergyChart({ data }) {
  const demand = data.chart.map((item) => item.predictedDemandEnergyKwh);
  const generation = data.chart.map((item) => item.generationEnergyKwh);
  const irradiance = data.chart.map((item) => item.irradianceWm2);
  const energyMax = Math.max(...demand, ...generation, 0.001);
  const irradianceMax = Math.max(...irradiance, 1);
  const stroke = { fill: "none", vectorEffect: "non-scaling-stroke" };
  return (
    <section data-qa="energy-chart" className="overflow-hidden" aria-labelledby="energy-chart-title">
      <SectionHeader id="energy-chart-title" title="수요와 발전" />
      <svg
        role="img"
        aria-label="96개 15분 구간의 가상 예측 수요와 시나리오 발전 비교"
        viewBox="0 0 640 180"
        className="mt-3 h-44 w-full"
        preserveAspectRatio="none"
      >
        {[0, 45, 90, 135, 180].map((y) => (
          <line key={y} x1="0" x2="640" y1={y} y2={y} stroke="var(--colors-hairline)" />
        ))}
        <path d={path(irradiance, irradianceMax)} stroke={SERIES_COLORS.irradiance} strokeDasharray="4 5" strokeWidth="1.5" {...stroke} />
        <path d={path(demand, energyMax)} stroke={SERIES_COLORS.demand} strokeWidth="2.5" {...stroke} />
        <path d={path(generation, energyMax)} stroke={SERIES_COLORS.generation} strokeWidth="2.5" {...stroke} />
      </svg>
      <ChartLegend
        items={[
          { label: "수요 · 가상 예측", color: SERIES_COLORS.demand },
          { label: "발전", color: SERIES_COLORS.generation },
          { label: "일사량 · 시나리오/추정", color: SERIES_COLORS.irradiance, dashed: true },
        ]}
        note="15분 간격 · kWh"
      />
      <Disclosure summary="표로 보기" className="mt-2">
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full border-collapse text-caption text-ink">
            <caption className="sr-only">시각별 수요와 발전 (kWh, 추정)</caption>
            <thead>
              <tr>
                <th scope="col" className="border-b border-hairline px-2 py-1 text-left font-medium text-ink-muted">시각</th>
                <th scope="col" className="border-b border-hairline px-2 py-1 text-right font-medium text-ink-muted">수요 kWh</th>
                <th scope="col" className="border-b border-hairline px-2 py-1 text-right font-medium text-ink-muted">발전 kWh</th>
              </tr>
            </thead>
            <tbody>
              {hourlyRows(data.chart).map((row) => (
                <tr key={row.hour}>
                  <th scope="row" className="border-b border-hairline px-2 py-1 text-left font-normal tabular-nums">{`${String(row.hour).padStart(2, "0")}시`}</th>
                  <td className="border-b border-hairline px-2 py-1 text-right tabular-nums">{row.demand.toFixed(1)}</td>
                  <td className="border-b border-hairline px-2 py-1 text-right tabular-nums">{row.generation.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Disclosure>
    </section>
  );
}

export function RoomBreakdown({ data }) {
  const max = Math.max(...data.roomTypes.map((item) => item.energyKwh));
  const ranked = [...data.roomTypes].sort((a, b) => b.energyKwh - a.energyKwh);
  return (
    <section data-qa="energy-room-breakdown" className={`${GROUP} flex flex-col gap-3`} aria-labelledby="energy-room-title">
      <SectionHeader id="energy-room-title" title="공간 유형별 수요" />
      {ranked.length === 0 ? (
        <p className="text-body text-ink-muted">이 비교 건물의 공간 유형별 상세 수요는 제공되지 않습니다.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {ranked.map((item) => (
            <li key={item.type}>
              <div className="flex items-center justify-between text-body text-ink-muted">
                <span>{item.label}</span>
                <strong className="font-semibold tabular-nums text-ink">{formatEnergy(item.energyKwh)}</strong>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-surface-3">
                <div className="h-full bg-ink-muted" style={{ width: `${(item.energyKwh / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

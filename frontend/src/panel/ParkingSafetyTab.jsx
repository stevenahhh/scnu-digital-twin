import { EstimateValue } from "../ui/EstimateValue.jsx";
import { MetricList } from "../ui/MetricList.jsx";
import { SectionHeader } from "../ui/SectionHeader.jsx";
import { StatusBadge } from "../ui/StatusBadge.jsx";
import { formatShortTime } from "../ui/format.mjs";
import { TRAFFIC_STATE_TONES } from "../hooks/feedStatus.mjs";
import { TrafficSafetyPanel } from "../simulation";
import trafficData from "../utils/trafficData.json";

const RISK_REPORTS = trafficData.slice(0, 3);
const AI_PRIORITY_COUNT = trafficData.filter((item) => item.ai_confidence >= 0.45).length;

const count = (value) => <EstimateValue value={value} unit="대" estimated={false} />;
const sampleValue = (text) => (
  <span className="inline-flex flex-wrap items-center justify-end gap-1">
    <span className="text-body font-semibold tabular-nums text-ink">{text}</span>
    <StatusBadge tone="sample" />
  </span>
);

// 주차·안전 탭. 위쪽은 영상 분석이 센 실시간 값, 아래쪽 `샘플 데이터` 묶음은 시연용 접수 자료로 서로 섞지 않는다.
export function ParkingSafetyTab({ trafficFeed }) {
  const live = trafficFeed.state === "live";
  const stats = live ? trafficFeed.stats : null;
  const liveItems = [
    { id: "parked", label: "주차 대수", value: count(stats?.current_cars) },
    { id: "spaces", label: "전체 면수", value: <EstimateValue value={stats?.total_spaces} unit="면" estimated={false} /> },
    { id: "entered", label: "오늘 누적 입차", value: count(stats?.entered) },
    { id: "exited", label: "오늘 누적 출차", value: count(stats?.exited) },
  ];
  const sampleItems = [
    { id: "reports", label: "위험 구역 접수", value: sampleValue(`${trafficData.length}건`) },
    { id: "priority", label: "AI 자동 분류(우선 처리 대상)", value: sampleValue(`${AI_PRIORITY_COUNT}건`) },
    ...RISK_REPORTS.map((item) => ({
      id: item.report_id,
      label: `${item.category} · ${formatShortTime(item.timestamp) ?? "시각 없음"}`,
      value: (
        <span className="inline-flex flex-wrap items-center justify-end gap-1">
          <StatusBadge tone="neutral">{item.status}</StatusBadge>
          <StatusBadge tone="sample" />
        </span>
      ),
    })),
  ];

  return (
    <>
      <section className="flex flex-col gap-3">
        <SectionHeader title="D4 입출차 현황" />
        <div data-qa="traffic-status" className="flex">
          <StatusBadge tone={TRAFFIC_STATE_TONES[trafficFeed.state] ?? "neutral"} className="text-caption">
            {trafficFeed.message}
          </StatusBadge>
        </div>
        <MetricList items={liveItems} columns={2} caption={live ? "D4 출입구 영상 분석 · 실시간" : null} />
      </section>

      <TrafficSafetyPanel />

      <section data-qa="sample-group" className="flex flex-col gap-3">
        <SectionHeader title="안전 모니터링" badge={<StatusBadge tone="sample" />} />
        <MetricList items={sampleItems} caption="시연용 샘플 접수 자료이며 실시간 값이 아닙니다" />
      </section>
    </>
  );
}

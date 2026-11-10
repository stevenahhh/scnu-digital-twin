import { Alert } from "../ui/Alert.jsx";
import { EstimateValue } from "../ui/EstimateValue.jsx";
import { MetricList } from "../ui/MetricList.jsx";
import { SectionHeader } from "../ui/SectionHeader.jsx";
import { StatusBadge } from "../ui/StatusBadge.jsx";
import { formatHHmm } from "../ui/format.mjs";
import { TRAFFIC_STATE_TONES } from "../hooks/feedStatus.mjs";
import { isFeedDown } from "../hooks/feedStatusModel.mjs";
import { FeedAlert, FeedStatusRow } from "./FeedStatus.jsx";

function temperatureValue(summary) {
  const temperature = summary.weather?.temperature;
  if (!summary.isSimulationMode || temperature === undefined || temperature === null) {
    return <EstimateValue value={temperature} unit="°C" estimated={false} />;
  }
  // 시뮬레이션 모드의 기온은 사용자가 고른 입력값이다. 관측도 추정도 아니므로 `시뮬레이션 값` 배지로만 구분한다.
  return (
    <span className="inline-flex flex-wrap items-baseline justify-end gap-1">
      <span className="text-body font-semibold tabular-nums text-ink">{temperature}</span>
      <span className="text-caption text-ink-muted">°C</span>
      <StatusBadge tone="neutral">시뮬레이션 값</StatusBadge>
    </span>
  );
}

function weatherCaption(summary) {
  if (summary.lastGoodLabel) return summary.lastGoodLabel;
  const source = summary.observedClock ? `기상청·에어코리아 관측 · ${summary.observedClock}` : "기상청·에어코리아 관측";
  return summary.isSimulationMode ? `${source} · 기온은 시뮬레이션 값` : source;
}

function WeatherSection({ summary, status, onRetry }) {
  const { weather } = summary;
  const measured = (value, unit) => <EstimateValue value={value} unit={unit} estimated={false} />;
  const items = [
    { id: "temperature", label: "현재 기온", value: temperatureValue(summary) },
    { id: "wind", label: "풍속", value: measured(weather?.wind_speed, "m/s") },
    { id: "humidity", label: "습도", value: measured(weather?.humidity, "%") },
    { id: "sky", label: "하늘 상태", value: measured(summary.skyStatus) },
    { id: "air", label: "대기질", value: measured(summary.airQuality) },
  ];
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="현재 기상" />
      <FeedStatusRow feed="weather" status={status} onRetry={onRetry} liveText={summary.status} liveTone={summary.statusTone} />
      {/* 피드가 끊겨 받은 값이 없어도 다섯 줄은 알림 바로 아래에 `데이터 없음`으로 둔다. 알림이 어느 묶음의 실패인지 보이고, 복구되면 값만 채워진다.
          출처 줄은 값이 있을 때만 단다. */}
      {(weather || isFeedDown(status)) && <MetricList items={items} caption={weather ? weatherCaption(summary) : null} />}
      {summary.alerts.length > 0 && (
        <Alert
          tone="warning"
          source="weather-warning"
          title={summary.alerts.map((alert) => alert.label).join(", ")}
          message="현재 기상값이 경보 기준을 넘었습니다"
        />
      )}
    </section>
  );
}

// 주차 묶음. 영상 분석 피드가 끊기면 값 네 개 대신 묶음 전체에 알림 하나와 다시 시도 하나를 둔다.
function ParkingSection({ trafficFeed, status, onRetry }) {
  const live = trafficFeed.state === "live";
  const stats = live ? trafficFeed.stats : null;
  const count = (value) => <EstimateValue value={value} unit="대" estimated={false} />;
  const items = [
    { id: "parked", label: "주차 대수", value: count(stats?.current_cars) },
    { id: "spaces", label: "전체 면수", value: <EstimateValue value={stats?.total_spaces} unit="면" estimated={false} /> },
    { id: "entered", label: "오늘 누적 입차", value: count(stats?.entered) },
    { id: "exited", label: "오늘 누적 출차", value: count(stats?.exited) },
  ];
  const down = isFeedDown(status);
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="D4 입출차 현황" />
      <div data-qa="traffic-status" data-feed="traffic" className="flex flex-col">
        {down ? (
          <FeedAlert feed="traffic" status={status} onRetry={onRetry} />
        ) : (
          <StatusBadge tone={TRAFFIC_STATE_TONES[trafficFeed.state] ?? "neutral"} className="self-start text-caption">
            {trafficFeed.message}
          </StatusBadge>
        )}
      </div>
      {live && <MetricList items={items} columns={2} caption="D4 출입구 영상 분석 · 실시간" />}
    </section>
  );
}

// 현황 탭: 측정된 현재 기상(경보 포함), D4 주차, 단기 예보 순서. 피드 상태와 다시 시도는 각 묶음 안에 한 번씩 있다.
export function StatusTab({ summary, feeds, retry, trafficFeed }) {
  return (
    <>
      <WeatherSection summary={summary} status={feeds.weather} onRetry={retry.weather} />
      <ParkingSection trafficFeed={trafficFeed} status={feeds.traffic} onRetry={retry.traffic} />
      {summary.timeline.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader title="단기 예보" />
          <MetricList
            caption="기상청 단기예보"
            items={summary.timeline.map((item, index) => {
              const temperature = item.tmp ?? item.temperature;
              return {
                id: `${item.fcstTime ?? item.time ?? index}`,
                label: item.fcstTime ?? formatHHmm(item.time) ?? `${index + 1}차 예보`,
                value: temperature === undefined || temperature === null
                  ? undefined
                  : <span className="text-body font-semibold tabular-nums text-ink">{`${temperature}°C`}</span>,
              };
            })}
          />
        </section>
      )}
    </>
  );
}

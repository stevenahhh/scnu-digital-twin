import { RefreshCw } from "lucide-react";
import { Alert } from "../ui/Alert.jsx";
import { Button } from "../ui/Button.jsx";
import { EstimateValue } from "../ui/EstimateValue.jsx";
import { MetricList } from "../ui/MetricList.jsx";
import { SectionHeader } from "../ui/SectionHeader.jsx";
import { StatusBadge } from "../ui/StatusBadge.jsx";
import { formatHHmm, formatNumber } from "../ui/format.mjs";
import { PanelClock } from "./PanelClock.jsx";
import { FeedStatusRow, FeedStatusRows } from "./FeedStatus.jsx";

const iconClass = "h-4 w-4";

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
  if (!summary.weather) return null;
  return summary.observedClock ? `기상청·에어코리아 관측 · ${summary.observedClock}` : "기상청·에어코리아 관측";
}

// 기본 현황 탭: 시계, 시스템 상태, 현재 기상(관측값), 태양 고도(계산 추정), 경보와 단기 예보.
// feeds/retry는 useFeedStatus 결과다. 피드 상태 줄(기상은 현재 기상 바로 위, 교통·에너지는 시스템 상태)이 끊긴 피드의 유일한 알림이다.
// settings는 `설정` 단추와 그 시트(SettingsSheet)다.
export function BasicStatusTab({ summary, feeds, retry, clock, sunAltitudeDegrees, settings, onRefreshWeather }) {
  const { weather } = summary;
  const measured = (value, unit) => <EstimateValue value={value} unit={unit} estimated={false} />;
  const weatherItems = [
    { id: "temperature", label: "현재 기온", value: temperatureValue(summary) },
    { id: "wind", label: "풍속", value: measured(weather?.wind_speed, "m/s") },
    { id: "humidity", label: "습도", value: measured(weather?.humidity, "%") },
    { id: "sky", label: "하늘 상태", value: measured(summary.skyStatus) },
    { id: "air", label: "대기질", value: measured(summary.airQuality) },
  ];
  const sunItems = [
    { id: "altitude", label: "태양 고도", value: <EstimateValue value={formatNumber(sunAltitudeDegrees, 1)} unit="°" /> },
  ];

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <PanelClock sceneMinuteOfDay={clock.sceneMinuteOfDay} sceneDate={clock.sceneDate} />
        <div className="flex shrink-0 gap-2">
          {settings}
          <Button
            iconOnly
            label="기상 데이터 새로고침"
            icon={<RefreshCw aria-hidden="true" className={iconClass} />}
            loading={summary.isBusy}
            onClick={onRefreshWeather}
          />
        </div>
      </div>

      {/* 기상 상태 줄(끊기면 알림)은 그 값들 바로 위에 둔다: 실패한 묶음과 그 원인이 붙어 있다. */}
      <section className="flex flex-col gap-3">
        <SectionHeader title="현재 기상" />
        <FeedStatusRow feed="weather" status={feeds.weather} onRetry={retry.weather} liveText={summary.status} liveTone={summary.statusTone} />
        <MetricList items={weatherItems} caption={weatherCaption(summary)} />
      </section>

      <FeedStatusRows feeds={feeds} retry={retry} only={["traffic", "energy"]} />

      <section className="flex flex-col gap-3">
        <SectionHeader title="태양" />
        <MetricList items={sunItems} caption="천문 계산 추정 · 장면 시각 기준" />
      </section>

      {summary.alerts.map((alert) => (
        <Alert key={alert.id} tone="warning" source="weather" title={alert.label} message="현재 기상값이 경보 기준을 넘었습니다" />
      ))}

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

import { EstimateValue } from "../ui/EstimateValue.jsx";
import { MetricList } from "../ui/MetricList.jsx";
import { SectionHeader } from "../ui/SectionHeader.jsx";
import { Segmented } from "../ui/Segmented.jsx";
import { SliderRow } from "../ui/SliderRow.jsx";
import { formatNumber } from "../ui/format.mjs";

const MODE_OPTIONS = [
  { value: "live", label: "실측" },
  { value: "simulation", label: "시뮬레이션" },
];

const COMPASS = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
const compassDirection = (degrees) => COMPASS[Math.round(degrees / 45) % COMPASS.length];

// 환경 시뮬 탭: 실측/시뮬레이션 전환, 가상 기온, 해 위치를 정하는 월·일·시·분(시간 슬라이더와 같은 상태).
export function EnvironmentTab({ clock }) {
  const sliders = [
    { label: "월", unit: "월", min: 1, max: 12, value: clock.sunMonth, set: clock.setSunMonth },
    { label: "일", unit: "일", min: 1, max: 31, value: clock.sunDay, set: clock.setSunDay },
    { label: "시", unit: "시", min: 0, max: 23, value: clock.sunHour, set: clock.setSunHour },
    { label: "분", unit: "분", min: 0, max: 59, value: clock.sunMinute, set: clock.setSunMinute },
  ];
  const bearing = clock.sunBearingDegrees;
  const sunItems = [
    {
      id: "bearing",
      label: "태양 방위",
      value: <EstimateValue value={`${compassDirection(bearing)} ${formatNumber(bearing, 0)}`} unit="°" />,
    },
    { id: "altitude", label: "태양 고도", value: <EstimateValue value={formatNumber(clock.sunAltitudeDegrees, 1)} unit="°" /> },
  ];

  return (
    <>
      <SectionHeader level={2} title="환경 시뮬레이션" />
      <Segmented kind="radio" label="기상 값 출처" options={MODE_OPTIONS} value={clock.mode} onChange={clock.setMode} />
      <section className="flex flex-col gap-4">
        <SectionHeader title="가상 환경 입력" />
        <SliderRow
          label="온도 조절"
          valueLabel={`${clock.simTemp}°C`}
          min={-10}
          max={40}
          value={clock.simTemp}
          onValueChange={clock.setSimTemp}
        />
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {sliders.map((slider) => (
            <SliderRow
              key={slider.label}
              label={slider.label}
              valueLabel={`${slider.value}${slider.unit}`}
              min={slider.min}
              max={slider.max}
              value={slider.value}
              onValueChange={slider.set}
            />
          ))}
        </div>
      </section>
      <MetricList items={sunItems} caption="천문 계산 추정 · 위 입력 시각 기준" />
    </>
  );
}

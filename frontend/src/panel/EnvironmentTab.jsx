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

// 환경 시뮬 탭: 실측/시뮬레이션 전환과 가상 기온. 날짜·시각은 지도 위 시간 조작 하나가 정한다(이 탭에 두 번째 슬라이더는 없다).
export function EnvironmentTab({ clock }) {
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
        <SectionHeader title="시뮬레이션" />
        {/* 감싸는 칸: 위 제목(시뮬레이션)이 이 슬라이더의 라벨로 읽히지 않게 슬라이더와 라벨만 한 묶음으로 둔다. */}
        <div>
          <SliderRow
            label="온도 조절"
            valueLabel={`${clock.simTemp}°C`}
            min={-10}
            max={40}
            value={clock.simTemp}
            onValueChange={clock.setSimTemp}
          />
        </div>
      </section>
      <MetricList items={sunItems} caption={`천문 계산 추정 · 장면 ${clock.sceneDate} 기준`} />
    </>
  );
}

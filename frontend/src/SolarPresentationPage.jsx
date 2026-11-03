import { CalendarDays, CloudSun, Compass, SunMedium } from "lucide-react";
import { useMemo, useState } from "react";
import { EnergyDashboard } from "./features/energy/dashboard/EnergyDashboard.jsx";
import VWorldRenderer from "./vworld/VWorldRenderer.jsx";
import {
  CAMPUS_LOCATION,
  SIMULATION_TIME_ZONE,
  clampDateParts,
  createSimulationDate,
  getSunState,
} from "./utils/sunPosition.mjs";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SIMULATION_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function initialParts(date) {
  const values = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function defaultPresentationDate() {
  const now = initialParts(new Date());
  return createSimulationDate({ ...now, hour: 12, minute: 0 }, now.year);
}

function compassDirection(degrees) {
  const labels = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
  return labels[Math.round(degrees / 45) % labels.length];
}

function dateKey(year, parts) {
  return `${year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function RangeControl({ label, value, min, max, onChange, suffix }) {
  return <label className="min-w-0 rounded-lg border border-[var(--colors-hairline)] bg-[var(--colors-surface-2)] p-3">
    <span className="flex items-center justify-between gap-3 text-xs font-bold text-[var(--colors-ink-subtle)]">
      <span>{label}</span><strong className="whitespace-nowrap text-sm text-[var(--colors-ink)]">{value}{suffix}</strong>
    </span>
    <input
      type="range"
      aria-label={`태양 시뮬레이션 ${label}`}
      min={min}
      max={max}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="mt-3 h-1.5 w-full cursor-pointer accent-[var(--colors-primary)]"
    />
  </label>;
}

export default function SolarPresentationPage({ initialDate = defaultPresentationDate() }) {
  const initial = useMemo(() => initialParts(initialDate), [initialDate]);
  const [month, setMonth] = useState(initial.month);
  const [day, setDay] = useState(initial.day);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const safe = clampDateParts({ month, day, hour, minute }, initial.year);
  const simulationDate = createSimulationDate(safe, initial.year);
  const sun = getSunState({ date: simulationDate, ...CAMPUS_LOCATION });
  const altitude = sun.altitude * 180 / Math.PI;
  const bearing = (sun.azimuth * 180 / Math.PI + 540) % 360;
  const energyDate = dateKey(initial.year, safe);
  const updateMonth = (value) => {
    const next = clampDateParts({ month: value, day, hour, minute }, initial.year);
    setMonth(next.month);
    setDay(next.day);
  };

  return <main className="grid min-h-[100dvh] bg-[var(--colors-canvas)] text-[var(--colors-ink)] xl:h-[100dvh] xl:grid-cols-[minmax(0,1fr)_460px] xl:overflow-hidden">
    <section id="vworld-available-area" className="relative min-h-[96dvh] overflow-hidden border-b border-[var(--colors-hairline)] xl:min-h-0 xl:border-b-0 xl:border-r" aria-labelledby="solar-title">
      <div className="absolute inset-0">
        <VWorldRenderer onSelection={() => {}} simulationDate={simulationDate} presentationMode />
      </div>
      <header className="absolute inset-x-4 top-4 z-10 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] p-4 md:inset-x-6 md:top-6 md:p-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--colors-primary)]"><SunMedium size={16} />SCNU Solar Digital Twin</div>
          <h1 id="solar-title" className="mt-2 break-keep text-xl font-bold leading-7 md:text-2xl">태양 경로 기반 태양광 시뮬레이션</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] px-3 py-2 text-xs font-bold">
          <span className={`h-2 w-2 rounded-full ${sun.visible ? "bg-[var(--colors-semantic-success)]" : "bg-[var(--colors-ink-subtle)]"}`} />
          {sun.visible ? "태양 가시" : "야간"}
        </div>
      </header>

      <div className="absolute inset-x-4 bottom-4 z-10 rounded-xl border border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] p-3 md:inset-x-6 md:bottom-6 md:p-4">
        <div className="mb-3 grid grid-cols-3 divide-x divide-[var(--colors-hairline)] rounded-lg border border-[var(--colors-hairline)] bg-[var(--colors-surface-1)] py-2 text-center">
          <div className="px-2"><span className="block text-[10px] text-[var(--colors-ink-subtle)]">기준 일자</span><strong className="mt-1 block whitespace-nowrap text-xs md:text-sm">{safe.month}월 {safe.day}일</strong></div>
          <div className="px-2"><span className="block text-[10px] text-[var(--colors-ink-subtle)]">태양 고도</span><strong className="mt-1 block text-xs md:text-sm">{altitude.toFixed(1)}°</strong></div>
          <div className="px-2"><span className="block text-[10px] text-[var(--colors-ink-subtle)]">방위각</span><strong className="mt-1 block text-xs md:text-sm">{compassDirection(bearing)} {bearing.toFixed(0)}°</strong></div>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <RangeControl label="월" value={month} min={1} max={12} suffix="월" onChange={updateMonth} />
          <RangeControl label="일" value={day} min={1} max={31} suffix="일" onChange={setDay} />
          <RangeControl label="시" value={hour} min={0} max={23} suffix="시" onChange={setHour} />
          <RangeControl label="분" value={minute} min={0} max={59} suffix="분" onChange={setMinute} />
        </div>
      </div>
    </section>

    <aside className="min-h-0 overflow-y-auto bg-[var(--colors-surface-1)] p-4 md:p-6" aria-label="태양광 발전 시뮬레이션 정보">
      <div className="mb-5 border-b border-[var(--colors-hairline)] pb-5">
        <div className="flex items-center gap-2 text-sm font-extrabold"><CloudSun size={17} className="text-[var(--colors-primary)]" />시뮬레이션 조건</div>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-[var(--colors-surface-2)] p-3"><dt className="text-[var(--colors-ink-subtle)]">위치</dt><dd className="mt-1 font-bold">SCNU 34.97° N</dd></div>
          <div className="rounded-lg bg-[var(--colors-surface-2)] p-3"><dt className="text-[var(--colors-ink-subtle)]">시간 간격</dt><dd className="mt-1 font-bold">15분 · 96구간</dd></div>
          <div className="rounded-lg bg-[var(--colors-surface-2)] p-3"><dt className="flex items-center gap-1 text-[var(--colors-ink-subtle)]"><Compass size={12} />태양 위치</dt><dd className="mt-1 font-bold">SunCalc 1.9.0</dd></div>
          <div className="rounded-lg bg-[var(--colors-surface-2)] p-3"><dt className="flex items-center gap-1 text-[var(--colors-ink-subtle)]"><CalendarDays size={12} />분석 날짜</dt><dd className="mt-1 font-bold">{energyDate}</dd></div>
        </dl>
      </div>
      <EnergyDashboard key={energyDate} buildingId="D4" initialDate={energyDate} />
    </aside>
  </main>;
}

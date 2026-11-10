import { useMemo, useState } from "react";
import data from "./paperDashboardData.json";
import { GenerationChart, LoadProfileChart, ShareBar } from "./paperDashboardCharts.jsx";
import "./paperDashboard.css";

const PRESETS = [
  { id: "clear", label: "맑음", cloudCover: 0.08 },
  { id: "partly_cloudy", label: "부분 흐림", cloudCover: 0.48 },
  { id: "overcast", label: "흐림", cloudCover: 0.88 },
];

const BUILDING_NAME = "D4 / 공대 3호관";
const SLOTS_PER_HOUR = 4;

const number = (value, digits = 2) =>
  value.toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

function Card({ title, description, action, children, className = "" }) {
  return (
    <section
      className={`rounded-xl border border-[var(--pd-border)] bg-[var(--pd-card)] shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] ${className}`}
    >
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--pd-border)] px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-none tracking-tight">{title}</h3>
            {description ? (
              <p className="mt-1.5 text-xs text-[var(--pd-muted-foreground)]">{description}</p>
            ) : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function Badge({ children, tone = "muted" }) {
  const tones = {
    muted: "border-[var(--pd-border)] bg-[var(--pd-muted)] text-[var(--pd-muted-foreground)]",
    solid: "border-transparent bg-[var(--pd-foreground)] text-white",
    success: "border-transparent bg-[var(--pd-success-soft)] text-[var(--pd-success)]",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function Metric({ label, value, unit, hint, accent }) {
  return (
    <div className="rounded-lg border border-[var(--pd-border)] bg-[var(--pd-card)] px-4 py-3">
      <p className="text-[11px] font-medium text-[var(--pd-muted-foreground)]">{label}</p>
      <p className="pd-num mt-1 flex flex-wrap items-baseline gap-1">
        <span className="text-2xl font-semibold tracking-tight" style={accent ? { color: accent } : undefined}>
          {value}
        </span>
        <span className="text-xs font-medium text-[var(--pd-muted-foreground)]">{unit}</span>
      </p>
      {hint ? <p className="pd-num mt-1 text-[11px] text-[var(--pd-muted-foreground)]">{hint}</p> : null}
    </div>
  );
}

function Tabs({ value, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--pd-border)] bg-[var(--pd-muted)] p-0.5">
      {PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          onClick={() => onChange(preset.id)}
          className={`rounded-[6px] px-3 py-1 text-xs font-medium transition-[color,border-color] ${
            value === preset.id
              ? "bg-[var(--pd-card)] text-[var(--pd-foreground)] shadow-[0_1px_2px_0_rgb(0_0_0/0.06)]"
              : "text-[var(--pd-muted-foreground)]"
          }`}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}

function bandAverages(demandKw) {
  const bands = [
    { label: "심야 00–06", from: 0, to: 24 },
    { label: "오전 06–12", from: 24, to: 48 },
    { label: "오후 12–18", from: 48, to: 72 },
    { label: "야간 18–24", from: 72, to: 96 },
  ];
  return bands.map((band) => {
    const slice = demandKw.slice(band.from, band.to);
    const mean = slice.reduce((sum, value) => sum + value, 0) / slice.length;
    return { label: band.label, meanKw: mean, peakKw: Math.max(...slice) };
  });
}

export default function PaperDashboardPage() {
  const [presetId, setPresetId] = useState("clear");
  const preset = PRESETS.find((item) => item.id === presetId);
  const scenario = data.presets[presetId];

  const derived = useMemo(() => {
    const generationKw = scenario.generationKwh.map((value) => value * SLOTS_PER_HOUR);
    const totals = scenario.totals;
    return {
      generationKw,
      peakGenerationKw: Math.max(...generationKw),
      peakIrradiance: Math.max(...scenario.irradianceWm2),
      totals,
      selfSufficiency: (totals.self_consumption_energy_kwh / totals.demand_energy_kwh) * 100,
      savingsKrw: totals.self_consumption_energy_kwh * data.electricityPriceKrwPerKwh,
      carbonKg: totals.self_consumption_energy_kwh * data.carbonIntensityKgCo2ePerKwh,
    };
  }, [scenario]);

  const demandPeakKw = Math.max(...data.demandKw);
  const demandBaseKw = Math.min(...data.demandKw);
  const bands = useMemo(() => bandAverages(data.demandKw), []);
  const profileMax = Math.ceil(demandPeakKw / 20) * 20;

  return (
    <div className="pd-root">
      <div className="mx-auto max-w-[1400px] px-8 py-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              캠퍼스 전력수요 · 태양광 설치 시뮬레이션 대시보드
            </h1>
            <p className="mt-1.5 text-sm text-[var(--pd-muted-foreground)]">
              디지털 트윈 기반 15분 단위 통합 분석 · {BUILDING_NAME} · {data.date} (KST)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>96구간 · 15분 간격</Badge>
            <Badge>Asia/Seoul</Badge>
            <Badge tone="solid">deterministic-python-v1</Badge>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {/* ── A. 기존 건물 전력 사용량 ───────────────────────────── */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="pd-num flex h-6 w-6 items-center justify-center rounded-md bg-[var(--pd-foreground)] text-xs font-semibold text-white">
                A
              </span>
              <h2 className="text-sm font-semibold tracking-tight">건물 전력 사용량</h2>
              <Badge>예측값 · 실측 검교정 전</Badge>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Metric
                label="일 총 전력수요"
                value={number(data.demandTotalKwh)}
                unit="kWh"
                hint={`${data.date} 합계`}
                accent="var(--pd-demand)"
              />
              <Metric
                label="최대 부하"
                value={number(demandPeakKw)}
                unit="kW"
                hint="강의 점유 피크"
              />
              <Metric
                label="기저 부하"
                value={number(demandBaseKw)}
                unit="kW"
                hint="상시 대기 + 서버 공조"
              />
            </div>

            <Card
              title="15분 단위 전력수요 프로파일"
              description="강의시간표 · 실별 부하 프로파일 기반 상향식(bottom-up) 산출"
              action={
                <span className="pd-num text-[11px] text-[var(--pd-muted-foreground)]">
                  n = 96 구간
                </span>
              }
            >
              <LoadProfileChart demandKw={data.demandKw} yMax={profileMax} />
            </Card>

            <Card title="시간대별 부하 요약">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--pd-border)] text-left text-[11px] font-medium text-[var(--pd-muted-foreground)]">
                    <th className="pb-2 font-medium">시간대</th>
                    <th className="pb-2 text-right font-medium">평균 부하(kW)</th>
                    <th className="pb-2 text-right font-medium">피크(kW)</th>
                    <th className="pb-2 text-right font-medium">비중</th>
                  </tr>
                </thead>
                <tbody className="pd-num">
                  {bands.map((band) => {
                    const share = (band.meanKw * 6) / data.demandTotalKwh;
                    return (
                      <tr key={band.label} className="border-b border-[var(--pd-border)] last:border-0">
                        <td className="py-2 text-[var(--pd-foreground)]">{band.label}</td>
                        <td className="py-2 text-right">{number(band.meanKw)}</td>
                        <td className="py-2 text-right">{number(band.peakKw)}</td>
                        <td className="py-2 text-right text-[var(--pd-muted-foreground)]">
                          {number(share * 100, 1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </div>

          {/* ── B. 태양광 설치 시뮬레이션 · 절감효과 ─────────────────── */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="pd-num flex h-6 w-6 items-center justify-center rounded-md bg-[var(--pd-solar)] text-xs font-semibold text-white">
                B
              </span>
              <h2 className="text-sm font-semibold tracking-tight">태양광 설치 계획안 · 절감효과</h2>
              <Badge>시뮬레이션 가정치 · 계측값 아님</Badge>
            </div>

            <Card
              title="설치 계획안"
              description={`${data.moduleWp} Wp 모듈 ${data.moduleCount}장 · 방위각 ${data.azimuthDeg}° · 경사각 ${data.tiltDeg}°`}
              action={<Tabs value={presetId} onChange={setPresetId} />}
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="정격 용량" value={number(data.capacityKwp, 3)} unit="kWp" />
                <Metric
                  label="일 발전량"
                  value={number(derived.totals.generation_energy_kwh)}
                  unit="kWh"
                  hint={preset.label}
                  accent="var(--pd-solar)"
                />
                <Metric
                  label="자립률"
                  value={number(derived.selfSufficiency)}
                  unit="%"
                  hint="일 수요 대비 자가소비"
                  accent="var(--pd-success)"
                />
                <Metric
                  label="최대 순시 출력"
                  value={number(derived.peakGenerationKw)}
                  unit="kW"
                  hint={`최대 일사 ${number(derived.peakIrradiance, 0)} W/m²`}
                />
              </div>
            </Card>

            <Card
              title="수요 대비 태양광 충당"
              description={`운량 C = ${preset.cloudCover} 시나리오 · 잉여전력 ${number(derived.totals.surplus_energy_kwh)} kWh (전량 즉시 소비)`}
            >
              <ShareBar
                selfKwh={derived.totals.self_consumption_energy_kwh}
                gridKwh={derived.totals.grid_draw_energy_kwh}
              />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Metric
                  label="전기요금 절감"
                  value={derived.savingsKrw.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}
                  unit="원/일"
                  hint={`단가 ${number(data.electricityPriceKrwPerKwh, 0)} 원/kWh 적용`}
                  accent="var(--pd-success)"
                />
                <Metric
                  label="탄소 저감"
                  value={number(derived.carbonKg)}
                  unit="kgCO₂e/일"
                  hint={`배출계수 ${data.carbonIntensityKgCo2ePerKwh} kgCO₂e/kWh 적용`}
                  accent="var(--pd-success)"
                />
              </div>
            </Card>

            <Card
              title="수요 · 발전 동일 시간축 비교"
              description="상단: 공통 축(kW) · 하단: 발전 전용 확대 축"
              action={
                <span className="flex items-center gap-3 text-[11px] text-[var(--pd-muted-foreground)]">
                  <span>
                    <span className="mr-1 inline-block h-2 w-2 rounded-[2px] bg-[var(--pd-demand)] align-middle" />
                    수요
                  </span>
                  <span>
                    <span className="mr-1 inline-block h-2 w-2 rounded-[2px] bg-[var(--pd-solar)] align-middle" />
                    발전
                  </span>
                </span>
              }
            >
              <LoadProfileChart
                demandKw={data.demandKw}
                generationKw={derived.generationKw}
                yMax={profileMax}
              />
              <p className="pd-num mt-4 mb-1 text-[11px] font-medium text-[var(--pd-muted-foreground)]">
                발전 확대 축 (0 – {number(Math.ceil(derived.peakGenerationKw), 0)} kW)
              </p>
              <GenerationChart
                generationKw={derived.generationKw}
                yMax={Math.max(Math.ceil(derived.peakGenerationKw), 1)}
              />
            </Card>

            <Card title="기상 시나리오별 결과" description="동일 날짜 · 동일 배치안 기준 비교">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--pd-border)] text-left text-[11px] font-medium text-[var(--pd-muted-foreground)]">
                    <th className="pb-2 font-medium">기상 시나리오</th>
                    <th className="pb-2 text-right font-medium">발전량(kWh)</th>
                    <th className="pb-2 text-right font-medium">계통수전(kWh)</th>
                    <th className="pb-2 text-right font-medium">자립률(%)</th>
                  </tr>
                </thead>
                <tbody className="pd-num">
                  {PRESETS.map((item) => {
                    const totals = data.presets[item.id].totals;
                    const rate = (totals.self_consumption_energy_kwh / totals.demand_energy_kwh) * 100;
                    const active = item.id === presetId;
                    return (
                      <tr
                        key={item.id}
                        className={`border-b border-[var(--pd-border)] last:border-0 ${
                          active ? "bg-[var(--pd-muted)]" : ""
                        }`}
                      >
                        <td className="py-2">
                          {item.label}
                          {active ? <span className="ml-2"><Badge tone="success">선택</Badge></span> : null}
                        </td>
                        <td className="py-2 text-right">{number(totals.generation_energy_kwh)}</td>
                        <td className="py-2 text-right">{number(totals.grid_draw_energy_kwh)}</td>
                        <td className="py-2 text-right">{number(rate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </div>
        </div>

        <footer className="mt-6 rounded-xl border border-[var(--pd-border)] bg-[var(--pd-card)] px-5 py-4">
          <p className="text-[11px] leading-relaxed text-[var(--pd-muted-foreground)]">
            <strong className="font-semibold text-[var(--pd-foreground)]">산출 근거 및 고지.</strong>{" "}
            수요는 강의시간표·실별 부하 프로파일 기반 예측값(quality: predicted)이며 실측 검교정 전 상태이다.
            발전량은 NOAA 태양위치 근사, 운량 2차 감쇠(f_c = 1 − 0.75C²), NOCT 셀 온도 보정
            (T_NOCT = 45 °C, −0.004/°C), 시스템 손실 10 %를 적용한 결정론적 시뮬레이션 가정치로
            계측값이 아니다. 3차원 음영 계수는 미적용이다. 전기요금·탄소 저감량은 각각 단가
            {" "}{number(data.electricityPriceKrwPerKwh, 0)} 원/kWh, 배출계수 {data.carbonIntensityKgCo2ePerKwh}{" "}
            kgCO₂e/kWh를 자가소비량에 곱한 값이다. 표시된 모든 수치는 백엔드
            (deterministic-python-v1) 산출값이다.
          </p>
        </footer>
      </div>
    </div>
  );
}

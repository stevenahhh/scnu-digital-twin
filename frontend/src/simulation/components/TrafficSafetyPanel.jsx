import React, { useState } from "react";
import { ArrowLeftRight, Circle, Pause, Play, RotateCcw, SkipForward, TriangleAlert } from "lucide-react";
import { simulationStore, useSimulationStore } from "../stores/simulationStore";
import { describeSimulationError, postJson, SimulationHttpError } from "../api/simulationHttp.mjs";
import { Alert } from "../../ui/Alert.jsx";
import { Button } from "../../ui/Button.jsx";
import { Disclosure } from "../../ui/Disclosure.jsx";
import { MetricList } from "../../ui/MetricList.jsx";
import { SectionHeader } from "../../ui/SectionHeader.jsx";
import { StatusBadge } from "../../ui/StatusBadge.jsx";
import { RouteEditorPanel } from "./RouteEditorPanel";

const SCENARIOS = [
  ["normal", "일반"], ["morning_rush", "오전 등교"], ["rush_hour", "혼잡 시간"], ["class_change", "수업 교체"],
  ["lunch_time", "점심 시간"], ["leaving_campus", "하교 시간"], ["jaywalking", "무단횡단"],
  ["scooter_speeding", "킥보드 과속"], ["scooter_wrong_way", "킥보드 역주행"],
  ["crosswalk_conflict", "횡단보도 상충"], ["rain", "우천"], ["night", "야간"],
  ["high_pedestrian_density", "보행자 밀집"], ["high_scooter_density", "킥보드 밀집"],
  ["vehicle_congestion", "차량 정체"], ["emergency_vehicle", "긴급차량"],
];

const STATUS_LABEL = { running: "실행 중", paused: "일시정지", stopped: "정지" };
const RISK_LABEL = { normal: "정상", caution: "주의", warning: "경고", danger: "위험" };
const TRIP_STATUS_LABEL = { moving: "이동 중", completed: "완료", waiting: "대기 중", stopped: "정지" };
const INTERACTION_STATE_LABEL = { NONE: "없음", CONFLICT: "상충", NEAR_MISS: "아차사고", HARD_BRAKE: "급제동" };

const AGENT_TYPE_LABEL = { car: "자동차", person: "보행자", scooter: "킥보드" };
const ROUTE_DEBUG_ENABLED = import.meta.env.DEV || String(import.meta.env.VITE_SIMULATION_DEBUG).toLowerCase() === "true";

const RISK_TONES = { danger: "danger", warning: "warning", caution: "warning", normal: "success" };
const SHOWN_TIMELINE = 5;
const SHOWN_RISKS = 3;
const FIELD = "mt-1 min-h-8 w-full rounded-control border border-hairline-strong bg-surface-1 px-2 text-body text-ink";
const LABEL = "flex flex-col text-caption text-ink-muted";

function formatDuration(seconds = 0) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const remainder = Math.round(value % 60);
  return minutes ? `${minutes}분 ${remainder}초` : `${remainder}초`;
}

const seconds = (value) => (value == null ? "없음" : `${value}초`);
const text = (value, title) => <span title={title} className="text-body tabular-nums text-ink">{value}</span>;
const toned = (value, tone) => <StatusBadge tone={tone} className="text-caption tabular-nums">{String(value)}</StatusBadge>;
// 영어 약어는 이름표의 title로만 남긴다.
const term = (korean, english) => <span title={english}>{korean}</span>;

// 객체 id 묶음: 글자 기호 대신 화살표 아이콘으로 잇는다.
function ObjectPair({ ids = [] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {ids.map((id, index) => (
        <React.Fragment key={id}>
          {index > 0 && <><ArrowLeftRight aria-hidden="true" className="h-3 w-3 shrink-0" /><span className="sr-only">와</span></>}
          <span>{id}</span>
        </React.Fragment>
      ))}
    </span>
  );
}

// 연결 상태 배지. 훅의 어휘(연결됨, 재연결 중, 오류, 연결 끊김)를 그대로 쓰고 아이콘을 곁들인다.
function ConnectionBadge({ status }) {
  const connected = status === "연결됨";
  return (
    <StatusBadge tone={connected ? "success" : "warning"} icon={connected ? Circle : TriangleAlert} className="text-caption">
      {status}
    </StatusBadge>
  );
}

// 앞의 shown개는 바로 보이고 나머지는 `더 보기`로 펼친다. 목록 안에 따로 스크롤 상자를 두지 않는다.
function ShortList({ items, shown, empty, render }) {
  if (items.length === 0) return <p className="py-2 text-center text-caption text-ink-muted">{empty}</p>;
  const rest = items.slice(shown);
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1">{items.slice(0, shown).map(render)}</ul>
      {rest.length > 0 && (
        <Disclosure summary={`더 보기 (${rest.length}건)`}>
          <ul className="flex flex-col gap-1">{rest.map(render)}</ul>
        </Disclosure>
      )}
    </div>
  );
}

function AgentDetails({ agent }) {
  const metrics = agent.metrics || {};
  const route = [
    { id: "origin", label: "출발", value: text(agent.origin_name) },
    { id: "destination", label: "도착", value: text(agent.destination_name) },
    { id: "speed", label: "속도", value: text(`${(Number(agent.speed || 0) * 3.6).toFixed(1)} km/h`) },
    {
      id: "state",
      label: "상태",
      value: text(`${TRIP_STATUS_LABEL[agent.trip_status] || "알 수 없음"} · `
        + `${INTERACTION_STATE_LABEL[agent.interaction_state || "NONE"] || "알 수 없음"}`),
    },
    { id: "route", label: "경로", value: text(agent.current_route, agent.current_route) },
    { id: "behavior", label: "행동 유형", value: text(agent.behavior_profile?.name || "알 수 없음") },
  ];
  const safety = [
    {
      id: "risk",
      label: term("위험도", "Risk"),
      value: toned(RISK_LABEL[agent.risk_level] || agent.risk_level, RISK_TONES[agent.risk_level] ?? "neutral"),
    },
    { id: "ttc", label: term("충돌 예상 시간", "TTC"), value: text(seconds(agent.current_ttc)) },
    { id: "pet", label: term("통과 시간차", "PET"), value: text(seconds(metrics.minimum_pet)) },
    { id: "conflicts", label: term("상충 건수", "Conflicts"), value: text(`${metrics.conflict_count || 0}건`) },
    { id: "near-miss", label: "아차사고", value: text(`${metrics.near_miss_count || 0}건`) },
    { id: "hard-brake", label: "급제동", value: text(`${metrics.hard_brake_count || 0}건`) },
  ];
  const trip = [
    { id: "distance", label: "거리", value: text(`${Math.round(metrics.trip_distance || 0)}m`) },
    { id: "time", label: "시간", value: text(formatDuration(metrics.travel_time)) },
    { id: "average", label: "평균 속도", value: text(`${((metrics.average_speed || 0) * 3.6).toFixed(1)} km/h`) },
    { id: "waiting", label: "대기", value: text(formatDuration(metrics.waiting_time)) },
  ];
  return (
    <div className="flex flex-col gap-3 rounded-card bg-surface-2 p-3">
      <SectionHeader level={4} title={agent.id} badge={<StatusBadge tone="neutral">{AGENT_TYPE_LABEL[agent.type] || agent.type}</StatusBadge>} />
      <MetricList items={route} />
      <SectionHeader level={4} title="안전" />
      <MetricList items={safety} columns={2} />
      <SectionHeader level={4} title="이동" />
      <MetricList items={trip} columns={2} />
    </div>
  );
}

function RiskEventRow(event) {
  const tone = event.risk_level === "danger" ? "danger" : "warning";
  return (
    <li key={event.event_id} className="flex flex-col gap-1 rounded-control bg-surface-2 px-3 py-2 text-caption text-ink-muted">
      <div className="flex items-center justify-between gap-2 text-ink">
        <span className="inline-flex items-center gap-2">
          <StatusBadge tone={tone}>{RISK_LABEL[event.risk_level] || event.risk_level}</StatusBadge>
          {event.location_id || "위치 미상"}
        </span>
        <strong className="font-semibold tabular-nums">{`${event.risk_score}점`}</strong>
      </div>
      <ObjectPair ids={event.object_ids} />
      <span>
        {term("충돌 예상 시간", "TTC")} {seconds(event.ttc)} · {term("통과 시간차", "PET")} {seconds(event.pet)}
        {` · 최소 거리 ${event.minimum_distance ?? event.distance}m`}
      </span>
      <span>
        {`외곽 간격 ${event.minimum_clearance == null ? "없음" : `${event.minimum_clearance}m`} · ${event.prediction_model || "linear"}`}
      </span>
      <span>{`${event.interaction_state || "CONFLICT"} · ${event.safety_event || "TRAFFIC_CONFLICT"}`}</span>
    </li>
  );
}

function TimelineRow(item, index) {
  return (
    <li
      key={`${item.type}-${item.event_id || item.trip_id || item.agent_id}-${index}`}
      className="flex items-center justify-between gap-2 border-b border-hairline py-1 text-caption text-ink-muted"
    >
      <span className="inline-flex flex-wrap items-center gap-1">
        {item.type}
        {item.agent_id ? ` · ${item.agent_id}` : <ObjectPair ids={item.object_ids} />}
      </span>
      <span className="tabular-nums">{`${Number(item.simulation_time || 0).toFixed(1)}초`}</span>
    </li>
  );
}

export function TrafficSafetyPanel() {
  const snapshot = useSimulationStore((state) => state);
  const [scenario, setScenario] = useState("normal");
  const [counts, setCounts] = useState({ car: 30, person: 100, scooter: 30 });
  const [speed, setSpeed] = useState(1);
  const [eventsEnabled, setEventsEnabled] = useState(true);
  const [requestError, setRequestError] = useState(null);

  const call = async (path, body) => {
    setRequestError(null);
    try {
      return await postJson(path, body);
    } catch (error) {
      const message = describeSimulationError(error);
      if (message === null) throw error;
      setRequestError({ message, detail: error instanceof SimulationHttpError ? error.detail : null });
      return null;
    }
  };

  const start = async () => {
    const scenarioResult = await call("/api/simulation/scenario", { scenario, counts, risk_events_enabled: eventsEnabled });
    if (!scenarioResult) return;
    await call("/api/simulation/start", { scenario, counts });
  };
  const updateCount = (type, value) => setCounts((current) => ({ ...current, [type]: Math.max(0, Number(value) || 0) }));
  const setSimulationSpeed = (value) => {
    const multiplier = Number(value);
    setSpeed(multiplier);
    call("/api/simulation/speed", { multiplier });
  };

  const stats = snapshot.statistics;
  const completed = Object.values(stats.completed_trips || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const metrics = [
    { id: "car", label: "자동차", value: text(`${stats.car_count}대`) },
    { id: "person", label: "보행자", value: text(`${stats.person_count}명`) },
    { id: "scooter", label: "킥보드", value: text(`${stats.scooter_count}대`) },
    { id: "normal", label: "정상 / 주의", value: text(`${stats.normal_count} / ${stats.caution_count}`) },
    { id: "warning", label: "경고", value: toned(stats.warning_count, "warning") },
    { id: "danger", label: "위험", value: toned(stats.danger_count, "danger") },
    { id: "completed", label: "완료된 이동", value: text(completed) },
    { id: "current", label: "현재 위험", value: toned(stats.current_risks || 0, "warning") },
    { id: "near-miss", label: "아차사고", value: toned(stats.near_miss_count || 0, "danger") },
    { id: "clock", label: "시뮬레이션 시각", value: text(`${snapshot.simulationTime.toFixed(1)}초 · ${snapshot.demandProfile}`) },
    { id: "speed", label: "속도", value: text(`×${speed}`) },
  ];
  const coverage = stats.network_coverage;

  return (
    <section className="flex flex-col gap-5" aria-label="캠퍼스 교통 시뮬레이션">
      <SectionHeader
        title="캠퍼스 교통 시뮬레이션"
        subtitle={STATUS_LABEL[snapshot.status]}
        actions={<ConnectionBadge status={snapshot.connectionStatus} />}
      />
      <MetricList items={metrics} columns={2} />
      {coverage && (
        <section className="flex flex-col gap-2 rounded-card bg-surface-2 p-3">
          <SectionHeader level={4} title="캠퍼스 네트워크 범위" badge={<StatusBadge tone="neutral">{stats.network_runtime?.mode || "모드 없음"}</StatusBadge>} />
          <MetricList
            items={["car", "person", "scooter"].map((type) => ({
              id: type,
              label: AGENT_TYPE_LABEL[type],
              value: text(`실주행 ${coverage[type]?.visited_percent || 0}% · 계획 ${coverage[type]?.planned_percent || 0}%`),
            }))}
          />
          {stats.network_runtime?.derived_allowed && (
            <StatusBadge tone="warning" className="self-start text-caption">파생 경로 개발 모드 · 실측 승인 데이터 아님</StatusBadge>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3 border-t border-hairline pt-4">
        <label className={LABEL}>
          시나리오
          <select value={scenario} onChange={(event) => setScenario(event.target.value)} className={FIELD}>
            {SCENARIOS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-2">
          {[["car", "자동차"], ["person", "보행자"], ["scooter", "킥보드"]].map(([type, label]) => (
            <label key={type} className={LABEL}>{label}
              <input type="number" min="0" max="500" value={counts[type]} onChange={(event) => updateCount(type, event.target.value)} className={FIELD} />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex flex-1 items-center gap-2 text-caption text-ink-muted">
            <input type="checkbox" checked={eventsEnabled} onChange={(event) => setEventsEnabled(event.target.checked)} /> 위험 이벤트
          </label>
          <select aria-label="시뮬레이션 속도" value={speed} onChange={(event) => setSimulationSpeed(event.target.value)} className={`${FIELD} mt-0 w-auto`}>
            {[0.5, 1, 2, 4].map((value) => <option key={value} value={value}>×{value}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-4 gap-1">
          <Button size="sm" variant="primary" onClick={start} icon={<Play aria-hidden="true" className="h-4 w-4" />}>시작</Button>
          <Button size="sm" onClick={() => call("/api/simulation/pause")} icon={<Pause aria-hidden="true" className="h-4 w-4" />}>정지</Button>
          <Button size="sm" onClick={() => call("/api/simulation/resume")} icon={<SkipForward aria-hidden="true" className="h-4 w-4" />}>재개</Button>
          <Button
            size="sm"
            onClick={async () => { await call("/api/simulation/reset"); simulationStore.reset(); }}
            icon={<RotateCcw aria-hidden="true" className="h-4 w-4" />}
          >
            초기화
          </Button>
        </div>
        {requestError && (
          <Alert tone="danger" source="simulation" title={`오류: ${requestError.message}`} detail={requestError.detail ?? undefined} />
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-hairline pt-4">
        <SectionHeader
          title="선택 객체"
          actions={snapshot.selectedAgentId && (
            <Button size="sm" variant="ghost" onClick={() => simulationStore.selectAgent(null)}>선택 해제</Button>
          )}
        />
        {!snapshot.selectedAgentId && <p className="py-2 text-center text-caption text-ink-muted">3D 화면의 자동차·보행자·킥보드를 선택하세요.</p>}
        {snapshot.selectedAgentId && !snapshot.selectedAgentDetails && !snapshot.selectionError && (
          <p role="status" className="py-2 text-center text-caption text-ink-muted">선택한 객체 정보를 불러오는 중입니다.</p>
        )}
        {snapshot.selectionError && <Alert tone="warning" source="simulation-agent" title={snapshot.selectionError} />}
        {snapshot.selectedAgentDetails && <AgentDetails agent={snapshot.selectedAgentDetails} />}
      </section>

      <section className="flex flex-col gap-2 border-t border-hairline pt-4">
        <SectionHeader title="시뮬레이션 타임라인" />
        <ShortList items={(snapshot.timeline || []).slice(0, 30)} shown={SHOWN_TIMELINE} empty="기록된 이벤트가 없습니다." render={TimelineRow} />
      </section>

      {ROUTE_DEBUG_ENABLED && <RouteEditorPanel />}

      <section className="flex flex-col gap-2 border-t border-hairline pt-4">
        <SectionHeader title="실시간 위험 이벤트" />
        <ShortList items={snapshot.riskEvents.slice(0, 20)} shown={SHOWN_RISKS} empty="감지된 이벤트가 없습니다." render={RiskEventRow} />
      </section>
    </section>
  );
}

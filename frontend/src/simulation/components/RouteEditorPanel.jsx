import React, { useEffect, useRef, useState } from "react";
import { routeEditorStore, useRouteEditorStore } from "../stores/routeEditorStore";
import { fetchNetworkQuality, readGeoJsonFeatures } from "../api/routeEditorApi.mjs";
import { describeSimulationError } from "../api/simulationHttp.mjs";
import { Button } from "../../ui/Button.jsx";
import { MetricList } from "../../ui/MetricList.jsx";
import { SectionHeader } from "../../ui/SectionHeader.jsx";
import { StatusBadge } from "../../ui/StatusBadge.jsx";

const KINDS = ["vehicle_lane", "sidewalk", "scooter_lane", "shared_path", "crosswalk", "building_entrance", "parking_connection", "scooter_parking_connection"];

function downloadGeoJSON(feature) {
  const payload = { type: "FeatureCollection", metadata: { status: "draft_requires_validation", coordinate_system: "simulation local meters" }, features: [feature] };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${feature.properties.id}.geojson`;
  anchor.click();
  URL.revokeObjectURL(url);
}

const KIND_LABELS = {
  vehicle_lane: "차로", sidewalk: "보도", scooter_lane: "킥보드 길", shared_path: "공유 길", crosswalk: "횡단보도",
  building_entrance: "건물 출입구", parking_connection: "주차 연결", scooter_parking_connection: "킥보드 주차 연결",
};
const MODE_LABELS = { idle: "대기", drawing: "그리는 중", editing: "편집 중", moving: "점 이동 중" };
const FIELD = "mt-1 min-h-8 w-full rounded-control border border-hairline-strong bg-surface-1 px-2 text-caption text-ink";
const LABEL = "flex flex-col text-caption text-ink-muted";

function QualitySummary({ quality }) {
  const summary = quality.summary ?? {};
  const items = [
    ["edges", "간선", summary.edges], ["derived", "파생 간선", summary.derived_edges],
    ["authoritative", "승인 간선", summary.authoritative_edges], ["crosswalk", "횡단보도 간선", summary.crosswalk_edges],
  ].map(([id, label, value]) => ({ id, label, value: <span className="text-caption tabular-nums text-ink">{value ?? 0}</span> }));
  return (
    <section className="flex flex-col gap-2 border-t border-hairline pt-2">
      <SectionHeader
        level={4}
        title="데이터 품질"
        badge={<StatusBadge tone={quality.valid ? "success" : "danger"}>{quality.valid ? "검증 통과" : "검증 실패"}</StatusBadge>}
      />
      <MetricList items={items} columns={2} />
    </section>
  );
}

// 개발용 경로 편집기: 교통망 간선을 그려 초안 GeoJSON으로 내려받는다. 승인 전에는 실제 교통망에 들어가지 않는다.
export function RouteEditorPanel() {
  const state = useRouteEditorStore((value) => value);
  const input = useRef(null);
  const [message, setMessage] = useState("");
  const [quality, setQuality] = useState(null);
  useEffect(() => {
    if (!state.enabled) return undefined;
    const controller = new AbortController();
    fetchNetworkQuality({ signal: controller.signal }).then(setQuality).catch((error) => {
      if (error?.name === "AbortError") return;
      const description = describeSimulationError(error);
      if (description === null) throw error;
      setQuality(null);
      setMessage(`데이터 품질을 받지 못했습니다: ${description}`);
    });
    return () => controller.abort();
  }, [state.enabled]);
  // 내보내기 전에 점 수를 먼저 본다(저장소의 toFeature와 같은 하한). 모자라면 내려받지 않고 이유를 보여 준다.
  const polygon = state.kind === "crosswalk" && state.geometryMode === "polygon";
  const save = () => {
    const minimum = polygon ? 3 : 2;
    if (state.points.length < minimum) {
      setMessage(`${polygon ? "횡단보도 다각형" : "경로"}에는 점이 ${minimum}개 이상 필요합니다.`);
      return;
    }
    downloadGeoJSON(routeEditorStore.toFeature());
    setMessage("초안 GeoJSON을 내려받았습니다. 검증·승인 전에는 실제 교통망에 포함되지 않습니다.");
  };
  const load = async (event) => {
    try {
      const features = await readGeoJsonFeatures(event.target.files[0]);
      routeEditorStore.loadFeatures(features);
      const editable = features.find((feature) => ["LineString", "Polygon"].includes(feature.geometry?.type));
      if (editable) routeEditorStore.loadFeature(editable);
      setMessage(`${features.length}개 Feature를 불러왔습니다.`);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      setMessage(`불러오기 실패: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  };
  const setMetadata = (key, parse = (value) => value) => (event) => routeEditorStore.setMetadata({ [key]: parse(event.target.value) });
  const action = (label, onClick) => <Button key={label} size="sm" onClick={onClick}>{label}</Button>;

  return (
    <section className="flex flex-col gap-3 rounded-card border border-hairline bg-surface-2 p-3 text-caption text-ink">
      <SectionHeader
        level={4}
        title="경로 편집 모드"
        actions={<Button size="sm" variant="ghost" onClick={() => routeEditorStore.setEnabled(!state.enabled)}>{state.enabled ? "끄기" : "켜기"}</Button>}
      />
      {state.enabled && <>
        <label className={LABEL}>종류
          <select value={state.kind} onChange={setMetadata("kind")} className={FIELD}>
            {KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
          </select>
        </label>
        {state.kind === "crosswalk" && <div className="grid grid-cols-2 gap-2">
          <label className={LABEL}>형상
            <select value={state.geometryMode} onChange={setMetadata("geometryMode")} className={FIELD}>
              <option value="centerline">중심선+폭</option><option value="polygon">다각형</option>
            </select>
          </label>
          <label className={LABEL}>폭(m)
            <input type="number" min="0.5" step="0.5" value={state.width} onChange={setMetadata("width", Number)} className={FIELD} />
          </label>
        </div>}
        <div className="grid grid-cols-2 gap-2">
          <label className={LABEL}>방향
            <select value={state.direction} onChange={setMetadata("direction")} className={FIELD}>
              <option value="bidirectional">양방향</option><option value="forward">단방향</option>
            </select>
          </label>
          <label className={LABEL}>신뢰도
            <input type="number" min="0" max="1" step="0.05" value={state.confidence} onChange={setMetadata("confidence", Number)} className={FIELD} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-ink-muted">
          <input type="checkbox" checked={state.showNetwork} onChange={(event) => routeEditorStore.setShowNetwork(event.target.checked)} />
          기존 교통망 표시
        </label>
        <p className="text-ink-muted">
          {`상태 ${MODE_LABELS[state.mode] ?? state.mode} · 점 ${state.points.length}개`}
          {state.mode === "moving" && <span className="block">지도에서 새 위치를 누르세요</span>}
        </p>
        <div className="grid grid-cols-4 gap-1">
          {[["생성", "create"], ["편집", "edit"], ["완료", "finish"], ["취소", "cancel"]].map(([label, method]) => action(label, () => routeEditorStore[method]()))}
        </div>
        <div className="grid grid-cols-3 gap-1">
          {action("점 이동", () => routeEditorStore.moveSelected())}
          {action("점 삭제", () => routeEditorStore.deleteSelected())}
          {action("GeoJSON 저장", save)}
        </div>
        <Button size="sm" onClick={() => input.current?.click()} className="w-full">기존 GeoJSON 불러오기</Button>
        <input ref={input} type="file" accept=".json,.geojson,application/json" className="hidden" onChange={load} />
        {quality && <QualitySummary quality={quality} />}
        {message && <p role="status" className="break-keep text-ink-muted">{message}</p>}
      </>}
    </section>
  );
}

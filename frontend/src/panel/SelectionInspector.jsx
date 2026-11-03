import { Clock, CircleAlert, Droplets, Gauge, GitCompare, MapPin, Sun, Thermometer, TreePine, Wind, X } from "lucide-react";
import { Alert } from "../ui/Alert.jsx";
import { Button } from "../ui/Button.jsx";
import { Disclosure } from "../ui/Disclosure.jsx";
import { EstimateValue } from "../ui/EstimateValue.jsx";
import { MetricList } from "../ui/MetricList.jsx";
import { SectionHeader } from "../ui/SectionHeader.jsx";
import { Skeleton } from "../ui/Skeleton.jsx";
import { Spinner } from "../ui/Spinner.jsx";
import { StatusBadge } from "../ui/StatusBadge.jsx";
import { formatHHmm } from "../ui/format.mjs";
import { ExportActions } from "../ui/ExportActions.jsx";
import { COMPARISON_METRICS } from "./ComparisonPane.jsx";
import { LinkCopyButton } from "./LinkCopyButton.jsx";

// 고른 건물 하나의 인스펙터(두 대시보드 공용). 데이터는 `/microclimate/elements/{id}/popup` 한 번의 응답(usePopupData)이다.
// 머리: 레지스트리 이름(title) + 코드 배지 + 닫기(Esc도 같다). 대표값: 국지 기온 추정 하나와 위험도.
// 본문: 열환경 / 일사 / 바람 / 재질 펼침. 로딩은 바로 뼈대, 1초 뒤 이름 붙은 스피너 하나. 실패는 알림 하나(다시 시도·자세히)이고
// 마지막으로 받은 값은 `저장된 값` 배지와 함께 그대로 둔다. 404는 빈 상태와 `전체 보기`.

export const INSPECTOR_STRINGS = Object.freeze({
  estimate: "추정",
  sampleNote: "실측이 아닌 샘플 기상 데이터로 계산된 값입니다.",
  missingThermal: "기상 데이터 없음",
  stale: "저장된 기상 데이터 표시 중",
  staleValues: "저장된 값",
  observed: "관측",
  loading: "미기후 추정 가져오는 중",
  notFound: "미기후 추정을 불러오지 못했습니다",
  empty: "이 건물의 미기후 추정 데이터가 없습니다",
  showAll: "전체 보기",
  close: "닫기",
  risk: "위험도",
  reasons: "원인 분석",
  source: "미기후 모델",
  baseWeather: "기준 기상",
  heightFormEstimate: "높이·형태 추정",
  formEstimate: "높이 GIS, 형태 추정",
});

const SECTIONS = Object.freeze([
  { id: "thermal", title: "열환경" },
  { id: "solar", title: "일사" },
  { id: "wind", title: "바람" },
  { id: "material", title: "재질" },
]);
const FACTOR_META = {
  shade: { Icon: Sun, label: "그늘", section: "solar" },
  radiation: { Icon: Thermometer, label: "복사", section: "solar" },
  wind: { Icon: Wind, label: "통풍", section: "wind" },
  vegetation: { Icon: TreePine, label: "녹지", section: "material" },
  material_heat: { Icon: Gauge, label: "재질열", section: "material" },
};
// 서버의 risk_level 문구를 배지 톤으로. 모르는 값은 중립이다.
const RISK_TONES = { 낮음: "success", 보통: "warning", 높음: "danger", "매우 높음": "danger" };

const isObject = (value) => value !== null && typeof value === "object";
const isText = (value) => typeof value === "string" && value.length > 0;
const iconLabel = (Icon, label) => (
  <span className="inline-flex items-center gap-1">
    <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
    {label}
  </span>
);
const plain = (text) => <span className="text-body text-ink">{text}</span>;

/** GLB extras → the building's 추정 caption, or null when nothing is flagged. */
export function describeEstimate(estimate) {
  if (!isObject(estimate)) return null;
  const heightEstimated = isText(estimate.heightLineage) && estimate.heightLineage !== "gis-height";
  if (heightEstimated) return INSPECTOR_STRINGS.heightFormEstimate;
  if (estimate.formEstimated === true || estimate.footprintEstimated === true) return INSPECTOR_STRINGS.formEstimate;
  return null;
}

/** `data.freshness.weather` → `{ text, stale }` (`관측 HH:mm` | `저장된 기상 데이터 표시 중 · N분 전`) or null. */
export function describeFreshness(weather) {
  if (!isObject(weather)) return null;
  if (weather.stale === true) {
    const minutes = Number.isFinite(weather.age_seconds) ? Math.max(0, Math.round(weather.age_seconds / 60)) : null;
    return { stale: true, text: minutes === null ? INSPECTOR_STRINGS.stale : `${INSPECTOR_STRINGS.stale} · ${minutes}분 전` };
  }
  const clock = formatHHmm(weather.observed_at) ?? formatHHmm(weather.fetched_at);
  return clock ? { stale: false, text: `${INSPECTOR_STRINGS.observed} ${clock}` } : null;
}

function factorItems(payload, section) {
  const factors = isObject(payload.factors) ? payload.factors : {};
  return Object.entries(factors)
    .filter(([key, value]) => isObject(value) && (FACTOR_META[key]?.section ?? "material") === section)
    .map(([key, value]) => {
      const meta = FACTOR_META[key] ?? { label: key };
      return {
        id: key,
        label: meta.Icon ? iconLabel(meta.Icon, meta.label) : meta.label,
        value: <span className="text-body font-medium text-ink">{isText(value.level) ? value.level : "알 수 없음"}</span>,
      };
    });
}

function Sections({ payload, estimate }) {
  const thermal = isObject(payload.thermal) ? payload.thermal : null;
  const delta = isObject(payload.delta) ? payload.delta : null;
  const reasons = Array.isArray(payload.reasons) ? payload.reasons.filter(isText) : [];
  const base = isObject(payload.base_weather) ? payload.base_weather : null;
  const material = isObject(payload.material) ? payload.material : null;
  const meta = [
    isText(payload.zone_id) && { id: "zone", label: "구역", value: plain(payload.zone_id) },
    isText(thermal?.stress_category) && { id: "stress", label: "열 스트레스", value: plain(thermal.stress_category) },
  ].filter(Boolean);
  const content = {
    thermal: (
      <div className="flex flex-col gap-3">
        {meta.length > 0 && <MetricList items={meta} />}
        {thermal ? (
          <MetricList
            columns={2}
            items={[
              { id: "feels", label: "체감", value: estimate(thermal.feels_like, "°C") },
              { id: "utci", label: "UTCI", value: estimate(thermal.utci, "°C") },
              { id: "wbgt", label: "WBGT", value: estimate(thermal.wbgt, "°C") },
            ]}
          />
        ) : (
          <p className="rounded-card bg-surface-2 px-3 py-4 text-center text-caption text-ink-muted">{INSPECTOR_STRINGS.missingThermal}</p>
        )}
        {isText(delta?.label) && (
          <p className={`flex items-center gap-2 text-body font-medium ${delta.temp > 0 ? "text-danger" : "text-primary"}`}>
            <MapPin aria-hidden="true" className="h-4 w-4 shrink-0" />
            {delta.label}
          </p>
        )}
        {reasons.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionHeader level={4} title={INSPECTOR_STRINGS.reasons} />
            <ul className="flex flex-col gap-1">
              {reasons.map((reason) => <li key={reason} className="break-keep text-caption text-ink-muted">{reason}</li>)}
            </ul>
          </section>
        )}
      </div>
    ),
    solar: <MetricList columns={2} items={factorItems(payload, "solar")} />,
    wind: (
      <div className="flex flex-col gap-3">
        <MetricList columns={2} items={factorItems(payload, "wind")} />
        {base && (
          <MetricList
            caption={INSPECTOR_STRINGS.baseWeather}
            items={[
              { id: "temperature", label: iconLabel(Thermometer, "기온"), value: <EstimateValue value={base.temperature} unit="°C" estimated={false} /> },
              { id: "humidity", label: iconLabel(Droplets, "습도"), value: <EstimateValue value={base.humidity} unit="%" estimated={false} /> },
              { id: "wind", label: iconLabel(Wind, "풍속"), value: <EstimateValue value={base.wind_speed} unit="m/s" estimated={false} /> },
            ]}
          />
        )}
      </div>
    ),
    material: (
      <MetricList
        columns={2}
        caption={material ? "재질은 추정 표면 자료" : null}
        items={[
          ...factorItems(payload, "material"),
          ...(isText(material?.surface_type) ? [{ id: "surface", label: "표면", value: plain(material.surface_type) }] : []),
        ]}
      />
    ),
  };
  return (
    <div className="flex flex-col gap-2">
      {SECTIONS.map((section) => (
        <Disclosure key={section.id} summary={section.title} defaultOpen={section.id === "thermal"} data-qa={`inspector-${section.id}`}>
          {content[section.id]}
        </Disclosure>
      ))}
    </div>
  );
}

export function SelectionInspector({
  title, popup, estimate: glbEstimate = null, gateText = null, onClose, onShowAll, onCompare = null, className,
}) {
  const { data, loading = false, error = null, errorStatus = null, errorDetail, retry, lastData } = popup;
  const payload = isObject(data) ? data : null;
  const shown = payload ?? (isObject(lastData) ? lastData : null);
  const notFound = errorStatus === 404;
  const staleValues = Boolean(error) && !payload && Boolean(shown);
  const heading = title || shown?.name || shown?.element_id || "";
  const code = isText(shown?.element_id) && shown.element_id.startsWith("BLD_") ? shown.element_id.slice(4) : null;
  const noteMessage = isText(shown?.data_note?.message) ? shown.data_note.message : "";
  const estimateCaption = describeEstimate(glbEstimate);
  const weather = shown?.freshness?.weather;
  const at = isObject(weather) ? weather.observed_at ?? weather.fetched_at : null;
  const stale = weather?.stale === true || staleValues;
  const estimate = (value, unit) => <EstimateValue value={value} unit={unit} source={INSPECTOR_STRINGS.source} at={at} stale={stale} />;
  const thermal = isObject(shown?.thermal) ? shown.thermal : null;
  const freshness = describeFreshness(weather);

  const handleKeyDown = (event) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onClose();
  };

  const badges = (
    <>
      {code && <StatusBadge tone="neutral">{code}</StatusBadge>}
      {shown && (
        <StatusBadge tone="estimate" title={noteMessage || undefined} data-testid="microclimate-estimate-badge">
          {INSPECTOR_STRINGS.estimate}
          {noteMessage && <span className="sr-only"> · {noteMessage}</span>}
        </StatusBadge>
      )}
      {shown?.sample_data === true && <StatusBadge tone="sample" title={INSPECTOR_STRINGS.sampleNote} data-testid="microclimate-sample-badge" />}
      {staleValues && <StatusBadge tone="warning" data-qa="inspector-stale">{INSPECTOR_STRINGS.staleValues}</StatusBadge>}
    </>
  );

  return (
    <section
      data-qa="selection-inspector"
      data-testid="microclimate-panel"
      aria-label={`선택한 건물 ${heading}`}
      onKeyDown={handleKeyDown}
      className={`flex flex-col gap-3 rounded-card border border-hairline bg-surface-1 p-4 ${className ?? ""}`}
    >
      <div className="flex items-start justify-between gap-3 rounded-card bg-surface-2 px-3 py-2">
        <div className="flex min-w-0 flex-col gap-1">
          <SectionHeader level={3} title={heading} badge={badges} />
          {estimateCaption && <p data-qa="estimate-caption" className="text-caption text-ink-muted">{estimateCaption}</p>}
          {gateText && (
            <p data-qa="gate-distance" className="flex flex-wrap items-center gap-1 text-caption text-ink-muted">
              <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              {gateText}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-start gap-1">
          <LinkCopyButton />
          <Button variant="ghost" iconOnly label={INSPECTOR_STRINGS.close} icon={<X aria-hidden="true" className="h-4 w-4" />} onClick={onClose} />
        </div>
      </div>

      {shown && !loading && (
        <div data-qa="inspector-headline" className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-caption text-ink-muted">국지 기온</span>
          {thermal ? estimate(thermal.local_temp, "°C") : <span className="text-caption text-ink-muted">{INSPECTOR_STRINGS.missingThermal}</span>}
          {thermal && (
            <span className="flex items-center gap-1">
              <span className="text-caption text-ink-muted">{INSPECTOR_STRINGS.risk}</span>
              <StatusBadge tone={RISK_TONES[thermal.risk_level] ?? "neutral"} className="text-caption">{thermal.risk_level ?? "알 수 없음"}</StatusBadge>
            </span>
          )}
        </div>
      )}

      {loading && (
        <div className="flex flex-col gap-3" data-qa="microclimate-loading">
          <Skeleton lines={4} />
          <Spinner label={INSPECTOR_STRINGS.loading} />
        </div>
      )}

      {notFound && !loading && (
        // 404: 무엇이 안 됐는지 한 줄, 바로 아래에 왜(데이터 없음)와 다음 행동(전체 보기)을 담은 빈 상태.
        <div className="flex flex-col gap-2">
          <p data-qa="inspector-not-found" className="break-keep text-body font-medium text-ink">{INSPECTOR_STRINGS.notFound}</p>
          <div data-qa="inspector-empty" className="flex flex-col items-start gap-2 rounded-card bg-surface-2 px-3 py-3">
            <p className="break-keep text-body text-ink-muted">{INSPECTOR_STRINGS.empty}</p>
            {onShowAll && <Button size="sm" onClick={onShowAll}>{INSPECTOR_STRINGS.showAll}</Button>}
          </div>
        </div>
      )}

      {error && !notFound && !loading && (
        <Alert
          tone="danger"
          source="selection-popup"
          title={error}
          message={shown ? "아래는 마지막으로 받은 값입니다" : undefined}
          actions={retry ? [{ label: "다시 시도", onClick: retry }] : []}
          detail={errorDetail}
        />
      )}

      {shown && !loading && <Sections payload={shown} estimate={estimate} />}
      {freshness && !loading && (
        <p className="flex items-center gap-1 text-caption text-ink-muted" data-testid="microclimate-freshness" data-stale={freshness.stale ? "true" : "false"}>
          {freshness.stale ? <CircleAlert aria-hidden="true" className="h-4 w-4" /> : <Clock aria-hidden="true" className="h-4 w-4" />}
          <span>{freshness.text}</span>
        </p>
      )}
      {(onCompare || (shown && !loading)) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
          {onCompare && (
            <Button size="sm" variant="secondary" data-qa="compare-add" icon={<GitCompare aria-hidden="true" className="h-4 w-4" />} onClick={onCompare}>
              비교에 추가
            </Button>
          )}
          {shown && !loading && (
            <ExportActions
              kind="inspector"
              columns={[{ key: "name", label: "건물" }, ...COMPARISON_METRICS.map((metric) => ({ key: metric.key, label: metric.unit ? `${metric.label}(${metric.unit})` : metric.label, estimated: true }))]}
              rows={[{ name: heading, ...Object.fromEntries(COMPARISON_METRICS.map((metric) => [metric.key, metric.read(shown) ?? null])) }]}
            />
          )}
        </div>
      )}
    </section>
  );
}

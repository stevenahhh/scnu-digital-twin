import {
  CircleAlert, Clock, Droplets, Gauge, MapPin, Sun, Thermometer, TreePine, Wind, X,
} from "lucide-react";
import { Alert } from "../ui/Alert.jsx";
import { Button } from "../ui/Button.jsx";
import { EstimateValue } from "../ui/EstimateValue.jsx";
import { MetricList } from "../ui/MetricList.jsx";
import { SectionHeader } from "../ui/SectionHeader.jsx";
import { Skeleton } from "../ui/Skeleton.jsx";
import { Spinner } from "../ui/Spinner.jsx";
import { StatusBadge } from "../ui/StatusBadge.jsx";
import { formatHHmm } from "../ui/format.mjs";

/**
 * Shared microclimate popup panel for AppLegacy and AppVWorld.
 * Props: `{ data, loading, error, errorDetail, onRetry, lastData, onClose, title? }` - `data` is the
 * `/microclimate/elements/{id}/popup` payload with every nested field optional; `title` is the heading shown before
 * `data` arrives; `lastData` is the last good payload of the same building, kept visible under an error;
 * `estimate` is `{ heightLineage, footprintEstimated, formEstimated }` from the campus GLB extras (Legacy only)
 * and drives the 추정 caption under the heading.
 */

const FACTOR_META = {
  shade: { Icon: Sun, label: "그늘" },
  vegetation: { Icon: TreePine, label: "녹지" },
  wind: { Icon: Wind, label: "통풍" },
  radiation: { Icon: Thermometer, label: "복사" },
  material_heat: { Icon: Gauge, label: "재질열" },
};

// 서버의 risk_level 문구를 배지 톤으로. 모르는 값은 중립이다.
const RISK_TONES = { 낮음: "success", 보통: "warning", 높음: "danger", "매우 높음": "danger" };

export const PANEL_STRINGS = Object.freeze({
  estimate: "추정",
  sample: "샘플 데이터",
  sampleNote: "실측이 아닌 샘플 기상 데이터로 계산된 값입니다.",
  missingThermal: "기상 데이터 없음",
  stale: "저장된 기상 데이터 표시 중",
  observed: "관측",
  loading: "미기후 추정 가져오는 중",
  empty: "이 건물의 상세 미기후 데이터를 선택해 확인하세요.",
  close: "닫기",
  risk: "위험도",
  reasons: "원인 분석",
  source: "미기후 모델",
  baseWeather: "기준 기상",
  heightFormEstimate: "높이·형태 추정",
  formEstimate: "높이 GIS, 형태 추정",
});

const isObject = (value) => value !== null && typeof value === "object";
const isText = (value) => typeof value === "string" && value.length > 0;
const iconLabel = (Icon, label) => (
  <span className="inline-flex items-center gap-1">
    <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
    {label}
  </span>
);

/** GLB extras → the building's 추정 caption, or null when nothing is flagged. */
export function describeEstimate(estimate) {
  if (!isObject(estimate)) return null;
  const heightEstimated = isText(estimate.heightLineage) && estimate.heightLineage !== "gis-height";
  if (heightEstimated) return PANEL_STRINGS.heightFormEstimate;
  if (estimate.formEstimated === true || estimate.footprintEstimated === true) return PANEL_STRINGS.formEstimate;
  return null;
}

/** `data.freshness.weather` → `{ text, stale }` (`관측 HH:mm` | `저장된 기상 데이터 표시 중 · N분 전`) or null. */
export function describeFreshness(weather) {
  if (!isObject(weather)) return null;
  if (weather.stale === true) {
    const minutes = Number.isFinite(weather.age_seconds) ? Math.max(0, Math.round(weather.age_seconds / 60)) : null;
    return {
      stale: true,
      text: minutes === null ? PANEL_STRINGS.stale : `${PANEL_STRINGS.stale} · ${minutes}분 전`,
    };
  }
  const clock = formatHHmm(weather.observed_at) ?? formatHHmm(weather.fetched_at);
  return clock ? { stale: false, text: `${PANEL_STRINGS.observed} ${clock}` } : null;
}

function errorText(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (isText(error.message)) return error.message;
  return String(error);
}

function PopupBody({ payload }) {
  const thermal = isObject(payload.thermal) ? payload.thermal : null;
  const weather = payload.freshness?.weather;
  const at = isObject(weather) ? weather.observed_at ?? weather.fetched_at : null;
  const stale = weather?.stale === true;
  const estimate = (value, unit) => (
    <EstimateValue value={value} unit={unit} source={PANEL_STRINGS.source} at={at} stale={stale} />
  );
  const factors = Object.entries(isObject(payload.factors) ? payload.factors : {}).filter(([, value]) => isObject(value)).slice(0, 4);
  const delta = isObject(payload.delta) ? payload.delta : null;
  const reasons = Array.isArray(payload.reasons) ? payload.reasons.filter(isText) : [];
  const base = isObject(payload.base_weather) ? payload.base_weather : null;
  const freshness = describeFreshness(weather);
  const meta = [
    isText(payload.zone_id) && { id: "zone", label: "구역", value: <span className="text-body text-ink">{payload.zone_id}</span> },
    isText(thermal?.stress_category) && {
      id: "stress", label: "열 스트레스", value: <span className="text-body text-ink">{thermal.stress_category}</span>,
    },
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      {meta.length > 0 && <MetricList items={meta} />}
      {thermal ? (
        <>
          <MetricList
            columns={2}
            items={[
              { id: "local", label: "기온", value: estimate(thermal.local_temp, "°C") },
              { id: "feels", label: "체감", value: estimate(thermal.feels_like, "°C") },
              { id: "utci", label: "UTCI", value: estimate(thermal.utci, "°C") },
              { id: "wbgt", label: "WBGT", value: estimate(thermal.wbgt, "°C") },
            ]}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-caption text-ink-muted">{PANEL_STRINGS.risk}</span>
            <StatusBadge tone={RISK_TONES[thermal.risk_level] ?? "neutral"} className="text-caption">
              {thermal.risk_level ?? "알 수 없음"}
            </StatusBadge>
          </div>
        </>
      ) : (
        <p className="rounded-card bg-surface-2 px-3 py-4 text-center text-caption text-ink-muted">{PANEL_STRINGS.missingThermal}</p>
      )}

      {factors.length > 0 && (
        <MetricList
          columns={2}
          items={factors.map(([key, value]) => {
            const factor = FACTOR_META[key] ?? { label: key };
            return {
              id: key,
              label: factor.Icon ? iconLabel(factor.Icon, factor.label) : factor.label,
              value: <span className="text-body font-medium text-ink">{isText(value.level) ? value.level : "알 수 없음"}</span>,
            };
          })}
        />
      )}

      {isText(delta?.label) && (
        <p className={`flex items-center gap-1.5 text-body font-medium ${delta.temp > 0 ? "text-danger" : "text-primary"}`}>
          <MapPin aria-hidden="true" className="h-4 w-4 shrink-0" />
          {delta.label}
        </p>
      )}

      {reasons.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionHeader level={4} title={PANEL_STRINGS.reasons} />
          <ul className="flex flex-col gap-1">
            {reasons.map((reason) => <li key={reason} className="break-keep text-caption text-ink-muted">{reason}</li>)}
          </ul>
        </section>
      )}

      {base && (
        <MetricList
          caption={PANEL_STRINGS.baseWeather}
          items={[
            { id: "temperature", label: iconLabel(Thermometer, "기온"), value: <EstimateValue value={base.temperature} unit="°C" estimated={false} /> },
            { id: "humidity", label: iconLabel(Droplets, "습도"), value: <EstimateValue value={base.humidity} unit="%" estimated={false} /> },
            { id: "wind", label: iconLabel(Wind, "풍속"), value: <EstimateValue value={base.wind_speed} unit="m/s" estimated={false} /> },
          ]}
        />
      )}
      {freshness && (
        <p
          className="flex items-center gap-1 text-caption text-ink-muted"
          data-testid="microclimate-freshness"
          data-stale={freshness.stale ? "true" : "false"}
        >
          {freshness.stale ? <CircleAlert aria-hidden="true" className="h-4 w-4" /> : <Clock aria-hidden="true" className="h-4 w-4" />}
          <span>{freshness.text}</span>
        </p>
      )}
    </div>
  );
}

export function MicroclimatePanel({
  data, loading = false, error = null, errorDetail, onRetry, lastData, onClose, title, estimate = null,
}) {
  const payload = isObject(data) ? data : null;
  const shown = payload ?? (isObject(lastData) ? lastData : null);
  const message = errorText(error);
  const estimateCaption = describeEstimate(estimate);
  const heading = shown?.name ?? title ?? shown?.element_id ?? "";
  const code = isText(shown?.element_id) && shown.element_id.startsWith("BLD_") ? shown.element_id.slice(4) : null;
  const noteMessage = isText(shown?.data_note?.message) ? shown.data_note.message : "";

  const badges = shown && (
    <>
      {code && <StatusBadge tone="neutral">{code}</StatusBadge>}
      <StatusBadge tone="estimate" title={noteMessage || undefined} data-testid="microclimate-estimate-badge">
        {PANEL_STRINGS.estimate}
        {noteMessage && <span className="sr-only"> · {noteMessage}</span>}
      </StatusBadge>
      {shown.sample_data === true && (
        <StatusBadge tone="sample" title={PANEL_STRINGS.sampleNote} data-testid="microclimate-sample-badge" />
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-4" data-testid="microclimate-panel">
      <div className="flex items-start justify-between gap-3 rounded-card bg-surface-2 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <SectionHeader title={heading} badge={badges} />
          {estimateCaption && <p data-qa="estimate-caption" className="text-caption text-ink-muted">{estimateCaption}</p>}
        </div>
        <Button
          variant="ghost"
          iconOnly
          label={PANEL_STRINGS.close}
          icon={<X aria-hidden="true" className="h-4 w-4" />}
          onClick={onClose}
        />
      </div>

      {loading && (
        <div className="flex flex-col gap-3" data-qa="microclimate-loading">
          <Skeleton lines={4} />
          <Spinner label={PANEL_STRINGS.loading} />
        </div>
      )}

      {message && !loading && (
        <Alert
          tone="danger"
          source="microclimate"
          title={message}
          message={shown ? "아래는 마지막으로 받은 값입니다" : undefined}
          actions={onRetry ? [{ label: "다시 시도", onClick: onRetry }] : []}
          detail={errorDetail}
        />
      )}

      {shown && !loading && <PopupBody payload={shown} />}

      {!shown && !loading && !message && (
        <p className="break-keep px-2 text-body text-ink-muted">{PANEL_STRINGS.empty}</p>
      )}
    </div>
  );
}

export default MicroclimatePanel;

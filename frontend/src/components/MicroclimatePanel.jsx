import { AlertTriangle, Clock, Gauge, Sun, Thermometer, TreePine, Wind, X } from "lucide-react";

/**
 * Shared microclimate popup panel for AppLegacy and AppVWorld.
 * Props: `{ data, loading, error, onClose, title? }` — `data` is the
 * `/microclimate/elements/{id}/popup` payload with every nested field optional;
 * `title` is the fallback heading shown before `data` arrives (the selected id).
 */

const FACTOR_META = {
  shade:         { Icon: Sun,         label: "그늘" },
  vegetation:    { Icon: TreePine,    label: "녹지" },
  wind:          { Icon: Wind,        label: "통풍" },
  radiation:     { Icon: Thermometer, label: "복사" },
  material_heat: { Icon: Gauge,       label: "재질열" },
};

export const MICROCLIMATE_STRINGS = Object.freeze({
  kicker: "MICROCLIMATE",
  estimate: "추정",
  sample: "샘플 데이터",
  sampleNote: "실측이 아닌 샘플 기상 데이터로 계산된 값입니다.",
  missingThermal: "기상 데이터 없음",
  stale: "저장된 기상 데이터 표시 중",
  observed: "관측",
  loading: "미기후 데이터 불러오는 중…",
  empty: "이 건물의 상세 미기후 데이터를 선택해 확인하세요.",
  close: "닫기",
  risk: "위험도",
  reasons: "원인 분석",
});

const isObject = (value) => value !== null && typeof value === "object";
const isText = (value) => typeof value === "string" && value.length > 0;

function formatUnit(value, unit) {
  return Number.isFinite(value) ? `${value}${unit}` : "-";
}

function formatClock(iso) {
  if (!isText(iso)) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** `data.freshness.weather` → `{ text, stale }` (`관측 HH:mm` | `저장된 기상 데이터 표시 중 · N분 전`) or null. */
export function describeFreshness(weather) {
  if (!isObject(weather)) return null;
  if (weather.stale === true) {
    const minutes = Number.isFinite(weather.age_seconds) ? Math.max(0, Math.round(weather.age_seconds / 60)) : null;
    return {
      stale: true,
      text: minutes === null ? MICROCLIMATE_STRINGS.stale : `${MICROCLIMATE_STRINGS.stale} · ${minutes}분 전`,
    };
  }
  const clock = formatClock(weather.observed_at) ?? formatClock(weather.fetched_at);
  return clock ? { stale: false, text: `${MICROCLIMATE_STRINGS.observed} ${clock}` } : null;
}

function errorText(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (isText(error.message)) return error.message;
  return String(error);
}

export function MicroclimatePanel({ data, loading = false, error = null, onClose, title }) {
  const payload = isObject(data) ? data : null;
  const thermal = isObject(payload?.thermal) ? payload.thermal : null;
  const riskColor = isText(thermal?.risk_color) ? thermal.risk_color : null;
  const onRisk = Boolean(payload) && Boolean(riskColor);
  const riskBg = riskColor ? `${riskColor}18` : "var(--colors-surface-2)";
  const badgeStyle = onRisk ? { background: "rgba(255,255,255,0.18)", color: "white" } : undefined;

  const heading = payload?.name ?? title ?? payload?.element_id ?? "";
  const subtitle = payload ? [payload.zone_id, thermal?.stress_category].filter(isText).join(" · ") : "";
  const noteMessage = isText(payload?.data_note?.message) ? payload.data_note.message : "";
  const isSample = payload?.sample_data === true;

  const factorEntries = Object.entries(isObject(payload?.factors) ? payload.factors : {})
    .filter(([, value]) => isObject(value))
    .slice(0, 4);
  const delta = isObject(payload?.delta) ? payload.delta : null;
  const reasons = Array.isArray(payload?.reasons) ? payload.reasons.filter(isText) : [];
  const baseWeather = isObject(payload?.base_weather) ? payload.base_weather : null;
  const freshness = describeFreshness(payload?.freshness?.weather);
  const riskScore = Number.isFinite(thermal?.risk_score) ? Math.min(Math.max(thermal.risk_score, 0), 4) : 0;
  const message = errorText(error);

  return (
    <div className="space-y-4" data-testid="microclimate-panel">
      <div
        className="flex items-start justify-between rounded-lg px-4 py-3"
        style={{ background: riskColor ?? "var(--colors-surface-2)" }}
      >
        <div className="min-w-0">
          <div
            className="text-[11px] font-extrabold uppercase tracking-[0.08em]"
            style={{ color: onRisk ? "rgba(255,255,255,0.85)" : "var(--colors-primary)" }}
          >
            {MICROCLIMATE_STRINGS.kicker}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3
              className="font-[700] text-[16px] tracking-[-0.1px]"
              style={{ color: onRisk ? "white" : "var(--colors-ink)" }}
            >
              {heading}
            </h3>
            {payload && (
              <span
                className="dashboard-status-badge inline-flex items-center font-[700] leading-4"
                style={badgeStyle}
                title={noteMessage || undefined}
                data-testid="microclimate-estimate-badge"
              >
                {MICROCLIMATE_STRINGS.estimate}
                {noteMessage && <span className="sr-only"> · {noteMessage}</span>}
              </span>
            )}
            {isSample && (
              <span
                className="dashboard-status-badge inline-flex items-center font-[700] leading-4"
                style={badgeStyle}
                title={MICROCLIMATE_STRINGS.sampleNote}
                data-testid="microclimate-sample-badge"
              >
                {MICROCLIMATE_STRINGS.sample}
              </span>
            )}
          </div>
          {subtitle && (
            <div className="mt-0.5 text-sm" style={{ color: onRisk ? "rgba(255,255,255,0.85)" : "var(--colors-ink-subtle)" }}>
              {subtitle}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="transition-opacity hover:opacity-70"
          style={{ color: onRisk ? "white" : "var(--colors-ink-muted)" }}
          aria-label={MICROCLIMATE_STRINGS.close}
          title={MICROCLIMATE_STRINGS.close}
        >
          <X size={18} />
        </button>
      </div>

      {loading && (
        <div role="status" className="flex items-center justify-center gap-3 px-2 py-8 text-sm text-[var(--colors-ink-muted)]">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--colors-hairline)] border-t-[var(--colors-primary)]" />
          {MICROCLIMATE_STRINGS.loading}
        </div>
      )}

      {message && !loading && (
        <div role="alert" className="flex items-center gap-2 px-2 py-6 text-sm text-[var(--colors-semantic-danger,#D32F2F)]">
          <AlertTriangle size={16} /> {message}
        </div>
      )}

      {payload && !loading && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {thermal ? (
              [
                { label: "기온", value: thermal.local_temp },
                { label: "체감", value: thermal.feels_like },
                { label: "UTCI", value: thermal.utci },
                { label: "WBGT", value: thermal.wbgt },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg p-2 text-center" style={{ background: riskBg }}>
                  <div className="text-[10px] font-medium text-[var(--colors-ink-subtle)]">{label}</div>
                  <div className="mt-1 text-[13px] font-[900] text-[var(--colors-ink)]">{formatUnit(value, "°C")}</div>
                </div>
              ))
            ) : (
              <div className="col-span-4 rounded-lg bg-[var(--colors-surface-2)] px-3 py-4 text-center">
                <div className="text-[12px] font-[700] text-[var(--colors-ink-subtle)]">{MICROCLIMATE_STRINGS.missingThermal}</div>
              </div>
            )}
          </div>

          {thermal && (
            <div>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="text-[var(--colors-ink-subtle)]">{MICROCLIMATE_STRINGS.risk}</span>
                <span className="font-[700]" style={{ color: riskColor ?? "var(--colors-ink)" }}>{thermal.risk_level ?? "-"}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--colors-surface-2)]">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(riskScore / 4) * 100}%`, background: riskColor ?? "var(--colors-hairline-strong)" }}
                />
              </div>
            </div>
          )}

          {factorEntries.length > 0 && (
            <div className="grid grid-cols-4 gap-1.5">
              {factorEntries.map(([key, val]) => {
                const meta = FACTOR_META[key] ?? { label: key };
                const Icon = meta.Icon;
                return (
                  <div key={key} className="rounded-lg p-2 text-center bg-[var(--colors-surface-2)]">
                    {Icon && <Icon size={12} className="mx-auto mb-1 text-[var(--colors-ink-muted)]" />}
                    <div className="text-[10px] font-medium text-[var(--colors-ink-subtle)]">{meta.label}</div>
                    <div className="mt-0.5 text-[10px] font-[800] text-[var(--colors-ink)]">{isText(val.level) ? val.level : "-"}</div>
                  </div>
                );
              })}
            </div>
          )}

          {isText(delta?.label) && (
            <div
              className="rounded-lg px-3 py-2 text-[12px] font-[700]"
              style={{ background: riskBg, color: delta.temp > 0 ? "#D32F2F" : "#1976D2" }}
            >
              📍 {delta.label}
            </div>
          )}

          {reasons.length > 0 && (
            <div>
              <div className="mb-1.5 text-sm font-medium text-[var(--colors-ink-subtle)]">{MICROCLIMATE_STRINGS.reasons}</div>
              <ul className="space-y-1">
                {reasons.map((reason) => (
                  <li key={reason} className="flex items-start gap-1.5 text-[12px] text-[var(--colors-ink-muted)]">
                    <span className="mt-0.5 shrink-0 font-[900]" style={{ color: riskColor ?? "var(--colors-ink-subtle)" }}>·</span>
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(baseWeather || freshness) && (
            <div className="border-t border-[var(--colors-hairline)] pt-3 text-[12px] font-[700] text-[var(--colors-ink-subtle)]">
              {baseWeather && (
                <div className="flex gap-3">
                  <span>🌡 {formatUnit(baseWeather.temperature, "°C")}</span>
                  <span>💧 {formatUnit(baseWeather.humidity, "%")}</span>
                  <span>💨 {formatUnit(baseWeather.wind_speed, "m/s")}</span>
                </div>
              )}
              {freshness && (
                <div
                  className={`${baseWeather ? "mt-1.5 " : ""}flex items-center gap-1 text-[11px] font-medium text-[var(--colors-ink-subtle)]`}
                  data-testid="microclimate-freshness"
                  data-stale={freshness.stale ? "true" : "false"}
                >
                  {freshness.stale ? <AlertTriangle size={11} /> : <Clock size={11} />}
                  <span>{freshness.text}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!payload && !loading && !message && (
        <div className="px-2 text-sm leading-6 text-[var(--colors-ink-muted)]">
          {MICROCLIMATE_STRINGS.empty}
        </div>
      )}
    </div>
  );
}

export default MicroclimatePanel;

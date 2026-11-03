// 두 대시보드(Legacy·VWorld)의 상태 표시줄이 같은 색 토큰과 시각 표기를 쓰도록 모은 공용 도우미.
export const FEED_TONE_COLORS = Object.freeze({
  success: "var(--colors-semantic-success)",
  warning: "var(--colors-semantic-warning)",
  danger: "var(--colors-semantic-danger)",
  neutral: "var(--colors-ink-subtle)",
});

export const WEATHER_STATE_TONES = Object.freeze({ live: "success", stale: "warning", error: "danger", loading: "neutral" });
export const TRAFFIC_STATE_TONES = Object.freeze({ live: "success", "camera-off": "warning", offline: "danger" });

export function formatClockTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

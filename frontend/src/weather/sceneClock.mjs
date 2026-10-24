// 장면 시각: 하루를 0..1439분(KST)으로 다루는 순수 함수들. 시간 슬라이더와 태양 위치 상태(sunHour/sunMinute)가 같이 쓴다.
export const MINUTES_PER_DAY = 1440;
export const KST_OFFSET_MINUTES = 9 * 60;
// 재생: 250 ms마다 10분씩 앞으로 간다(하루 36초).
export const PLAY_STEP_MINUTES = 10;
export const PLAY_INTERVAL_MS = 250;

export function wrapMinuteOfDay(minute) {
  const rounded = Math.round(Number(minute));
  if (!Number.isFinite(rounded)) return 0;
  return ((rounded % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export function stepMinuteOfDay(minute, delta = PLAY_STEP_MINUTES) {
  return wrapMinuteOfDay(minute + delta);
}

// 브라우저 시간대와 무관하게 KST 기준 하루 중 분.
export function kstMinuteOfDay(date) {
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return wrapMinuteOfDay(utcMinutes + KST_OFFSET_MINUTES);
}

export function minuteOfDayFromParts({ hour, minute }) {
  return wrapMinuteOfDay(hour * 60 + minute);
}

export function splitMinuteOfDay(minute) {
  const wrapped = wrapMinuteOfDay(minute);
  return { hour: Math.floor(wrapped / 60), minute: wrapped % 60 };
}

export function formatMinuteOfDay(minute) {
  const { hour, minute: minutes } = splitMinuteOfDay(minute);
  return `${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

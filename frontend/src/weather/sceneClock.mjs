// 장면 시각: 하루를 0..1439분(KST)으로 다루는 순수 함수들. 시간 슬라이더와 태양 위치 상태(sunHour/sunMinute)가 같이 쓴다.
export const MINUTES_PER_DAY = 1440;
export const KST_OFFSET_MINUTES = 9 * 60;
// 재생: 100 ms마다 1분씩 앞으로 간다(1시간 6초, 하루 144초). 태양·그림자는 분 단위로 매끄럽게 움직인다.
export const PLAY_STEP_MINUTES = 1;
export const PLAY_INTERVAL_MS = 100;
// 키보드: 화살표 ±1분, Shift+화살표 ±10분, PageUp/PageDown ±60분, Home/End 00:00/23:59. 자정에서 감기지 않고 멈춘다.
export const KEY_STEP_MINUTES = 1;
export const KEY_STEP_LARGE_MINUTES = 10;
export const PAGE_STEP_MINUTES = 60;

const KEY_DIRECTIONS = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };

// 키 입력에 대한 다음 분. 슬라이더가 다루지 않는 키는 null.
export function minuteForKey(minute, { key, shiftKey = false }) {
  let next;
  if (key === "Home") next = 0;
  else if (key === "End") next = MINUTES_PER_DAY - 1;
  else if (key === "PageUp") next = minute + PAGE_STEP_MINUTES;
  else if (key === "PageDown") next = minute - PAGE_STEP_MINUTES;
  else if (key in KEY_DIRECTIONS) {
    next = minute + KEY_DIRECTIONS[key] * (shiftKey ? KEY_STEP_LARGE_MINUTES : KEY_STEP_MINUTES);
  } else return null;
  return Math.min(MINUTES_PER_DAY - 1, Math.max(0, Math.round(next)));
}

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

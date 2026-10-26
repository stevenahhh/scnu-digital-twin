// 화면에 쓰는 시각은 캠퍼스 기준인 한국 표준시(KST)의 24시간 HH:mm이다.
const CLOCK = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const CLOCK_SECONDS = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
const DATE_LONG = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" });

function toDate(at) {
  if (at === null || at === undefined || at === "") return null;
  const date = at instanceof Date ? at : new Date(at);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parts(formatter, date) {
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

export function formatHHmm(at) {
  const date = toDate(at);
  if (!date) return null;
  const { hour, minute } = parts(CLOCK, date);
  return `${hour}:${minute}`;
}

// 기록 시각(신고 접수 등)을 HH:mm으로. 읽을 수 없는 값은 null이다.
export const formatShortTime = formatHHmm;

// 패널 시계: KST HH:mm:ss.
export function formatClock(at) {
  const date = toDate(at);
  if (!date) return null;
  const { hour, minute, second } = parts(CLOCK_SECONDS, date);
  return `${hour}:${minute}:${second}`;
}

// 패널 날짜: `10월 26일 (월)`처럼 KST 기준 월·일·요일.
export function formatLongDate(at) {
  const date = toDate(at);
  return date ? DATE_LONG.format(date) : null;
}

// 숫자를 소수 digits자리로. 숫자가 아니면 null(자리 표시 기호는 쓰는 쪽이 정하지 않고 `데이터 없음`으로 보인다).
export function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : null;
}

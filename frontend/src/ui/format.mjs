// 화면에 쓰는 시각은 캠퍼스 기준인 한국 표준시(KST)의 24시간 HH:mm이다.
const CLOCK = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function formatHHmm(at) {
  if (at === null || at === undefined || at === "") return null;
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(CLOCK.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute}`;
}

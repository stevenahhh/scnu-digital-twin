// 시간 조작의 순수 도우미. 날짜는 `YYYY-MM-DD`(input[type=date] 값), 시각은 하루 0..1439분(KST)이다.
const DAY_MS = 86400000;
const pad = (value) => String(value).padStart(2, "0");

export function parseSceneDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

export const formatSceneDate = ({ year, month, day }) => `${year}-${pad(month)}-${pad(day)}`;

// 1월 1일이 1이다. 윤년의 12월 31일은 366.
export function dateToDayOfYear(value) {
  const parts = typeof value === "string" ? parseSceneDate(value) : value;
  if (!parts) return null;
  return Math.round((Date.UTC(parts.year, parts.month - 1, parts.day) - Date.UTC(parts.year, 0, 1)) / DAY_MS) + 1;
}

export function dayOfYearToDate(year, dayOfYear) {
  const date = new Date(Date.UTC(year, 0, 1) + (dayOfYear - 1) * DAY_MS);
  return formatSceneDate({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}

// 직접 입력한 `HH:mm`(00:00..23:59) -> 분. 그 밖의 값은 null(슬라이더는 그대로 둔다).
export function parseTypedTime(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

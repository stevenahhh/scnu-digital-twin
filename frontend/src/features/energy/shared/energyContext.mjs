// 에너지 탭이 함께 쓰는 기준일과 기상 프리셋.
// 기준일은 장면 날짜를 따른다. 장면 날짜를 받지 못하면 실시간 장면의 날짜(한국 표준시 오늘)를 쓴다.
export function kstToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export const WEATHER_PRESETS = Object.freeze([
  ["clear", "맑음"],
  ["partly_cloudy", "부분 흐림"],
  ["overcast", "흐림"],
]);
const WEATHER_LABELS = Object.fromEntries(WEATHER_PRESETS);
export const weatherPresetLabel = (value) => WEATHER_LABELS[value] ?? value;

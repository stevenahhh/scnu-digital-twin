// 밤 시간대별 창문 불빛과 주변광. 연출용 모형(재실 데이터가 아니다): 해가 진 뒤 저녁에 가장 밝고, 밤이 깊을수록 꺼지고,
// 새벽에 다시 조금 켜진다. 태양 고도(라디안)가 -2도보다 높으면 창문 불빛은 0이다.

const DEGREES = 180 / Math.PI;
const clamp01 = (value) => Math.min(1, Math.max(0, value));
const smooth = (t) => t * t * (3 - 2 * t);

// [분, 값] 하루 고리(마지막 점 뒤는 첫 점으로 이어진다). 19:00에 가득, 21:00까지 거의 그대로(0.9),
// 23:00 0.35, 01:00 이후 0.1, 06:00 0.3(해 뜰 때까지).
const WINDOW_KEYS = Object.freeze([
  [60, 0.1],
  [300, 0.1],
  [360, 0.3],
  [720, 0.3],
  [960, 0.6],
  [1140, 1],
  [1260, 0.9],
  [1380, 0.35],
]);

// 주변광(밤 몫)의 시간 곱: 19:00까지 1, 21:00 0.8, 23:00~04:00 0.6, 06:00에 다시 1.
const AMBIENT_TIME_KEYS = Object.freeze([
  [240, 0.6],
  [360, 1],
  [1140, 1],
  [1260, 0.8],
  [1380, 0.6],
]);

// getSkyNightMix가 -12도에서 끝나므로, 그 아래(-12 -> -30도)에서 주변광을 0.7배까지 더 낮춘다.
const AMBIENT_FULL_DARK_DEGREES = -30;
const AMBIENT_SKY_END_DEGREES = -12;
const AMBIENT_ALTITUDE_FLOOR = 0.7;

const WINDOW_GATE_START_DEGREES = -2;
const WINDOW_GATE_FULL_DEGREES = -6;

function wrapMinute(minute) {
  const value = Number.isFinite(minute) ? minute % 1440 : 0;
  return value < 0 ? value + 1440 : value;
}

// 하루 고리 위 선형 보간.
function sampleRing(keys, minute) {
  const m = wrapMinute(minute);
  for (let index = 0; index < keys.length; index += 1) {
    const [from, a] = keys[index];
    const [toRaw, b] = keys[(index + 1) % keys.length];
    const to = toRaw <= from ? toRaw + 1440 : toRaw;
    const at = m < from ? m + 1440 : m;
    if (at >= from && at <= to) return a + ((b - a) * (at - from)) / (to - from);
  }
  return keys[0][1];
}

// 창문·발광 재질의 밤 불빛 0..1(재질에 정해 둔 세기에 곱한다).
export function windowGlowAt(minuteOfDay, sunAltitude) {
  const degrees = Number.isFinite(sunAltitude) ? sunAltitude * DEGREES : -90;
  const gate = smooth(clamp01((WINDOW_GATE_START_DEGREES - degrees) / (WINDOW_GATE_START_DEGREES - WINDOW_GATE_FULL_DEGREES)));
  return gate * sampleRing(WINDOW_KEYS, minuteOfDay);
}

// 주변광·반구광 가운데 밤 몫에 곱하는 값 0..1. 하늘 돔이 -12도에서 다 어두워진 뒤에도, 고도와 밤 시각에 따라 더 낮아진다.
export function nightAmbientAt(minuteOfDay, sunAltitude) {
  const degrees = Number.isFinite(sunAltitude) ? sunAltitude * DEGREES : AMBIENT_FULL_DARK_DEGREES;
  const depth = clamp01((AMBIENT_SKY_END_DEGREES - degrees) / (AMBIENT_SKY_END_DEGREES - AMBIENT_FULL_DARK_DEGREES));
  const byAltitude = 1 - (1 - AMBIENT_ALTITUDE_FLOOR) * smooth(depth);
  // 고도(하늘이 얼마나 깊이 어두운가)와 밤 시각(불이 얼마나 꺼졌는가)은 서로 다른 원인이라 곱한다.
  return byAltitude * sampleRing(AMBIENT_TIME_KEYS, minuteOfDay);
}

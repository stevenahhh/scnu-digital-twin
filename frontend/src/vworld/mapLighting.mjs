// 지도 영상 위에 까는 야간 음영. 해 고도(도)에서 투명도를 정한다: +6도에서 0, 시민 박명 끝(-6도)에 0.6, 그 뒤로도
// 천문 박명이 끝나는 -24도까지 0.82로 짙어진다(해가 진 뒤에도 19시와 21시 화면이 다르다).
export function mapLighting(altitudeDegrees) {
  const dusk = Math.min(1, Math.max(0, (6 - altitudeDegrees) / 12)) * 0.6;
  const night = Math.min(1, Math.max(0, (-6 - altitudeDegrees) / 18)) * 0.22;
  return { nightOpacity: dusk + night };
}

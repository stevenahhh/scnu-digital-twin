// 지도 카메라를 한 자리로 바로 옮긴다(발표 모드의 첫 시점). 선택 뒤 카메라는 campusCamera.flyTo 한 길로만 움직인다.
// 선택 뒤 자동 회전과 화면 크기 변화에 따른 재정렬은 없다(사람의 원인 없는 카메라 움직임 금지).
export function focusMapAt(
  map,
  vw,
  { longitude, latitude, altitude = 200, heading = 0 },
) {
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(altitude) ||
    !Number.isFinite(heading) ||
    typeof map?.lookat?.moveTo !== "function"
  ) {
    return false;
  }

  map.lookat.moveTo(
    new vw.CameraPosition(
      new vw.CoordZ(longitude, latitude, altitude),
      new vw.Direction(heading, -60, 0),
    ),
  );
  return true;
}

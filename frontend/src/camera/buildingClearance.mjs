// 궤도 카메라가 건물을 뚫고 들어가지 않게 하는 순수 계산. 목표점에서 카메라 쪽으로 쏜 광선이 건물 면과 만난 자리를 보고
// 카메라를 둘 거리(팔 길이)를 정한다. 광선 검사 자체는 CityModel이 건물 메시의 BVH로 한다.

// 카메라(와 near 평면)가 벽 앞에 남겨 둘 여유(장면 단위).
export const CAMERA_WALL_MARGIN = 1;

// hits: 목표점에서 카메라 방향 광선의 교차를 거리순으로 [{ distance, entering }]. entering은 앞면(건물 밖에서 안으로)이다.
// desired: 사용자가 원하는 목표점-카메라 거리. 반환: 카메라를 둘 거리.
// - 카메라 앞에서 광선이 건물에 들어가면 그 벽 앞(여유만큼 목표점 쪽)에 둔다. 앞선 교차(목표점이 들어 있던 건물의 벽)와
//   여유보다 가까우면 두 벽의 가운데에 둔다.
// - 카메라 뒤 첫 교차가 뒷면(안에서 밖으로)이면 카메라가 건물 안에 있다. 그 벽 바깥으로 밀어낸다.
export function resolveArmLength(hits, desired, margin = CAMERA_WALL_MARGIN) {
  let previous = 0;
  for (const hit of hits) {
    if (hit.distance >= desired) return hit.entering ? desired : hit.distance + margin;
    if (hit.entering) return Math.max(hit.distance - margin, (previous + hit.distance) / 2);
    previous = hit.distance;
  }
  return desired;
}

// 벽에 밀려 짧아진 팔이 장애물이 사라지면 사용자의 거리로 돌아가도록 원하는 거리를 기억한다.
// 실제 거리가 지난 프레임에 둔 거리와 같으면(궤도 회전은 반지름을 바꾸지 않는다) 기억한 거리를 쓰고, 달라졌으면
// (확대·축소, 시점 비행) 그 거리를 새 원하는 거리로 삼는다.
export function createCameraArm({ tolerance = 1e-2 } = {}) {
  let wish = null;
  let last = null;
  return {
    desired(actual) {
      if (wish === null || last === null || Math.abs(actual - last) > tolerance) wish = actual;
      return wish;
    },
    placed(length) {
      last = length;
    },
  };
}

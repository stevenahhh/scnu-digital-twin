// 궤도 카메라가 건물 안에 들어가지 않게 하는 순수 계산. 목표점에서 카메라 쪽으로 쏜 광선이 건물 면과 만난 자리를 보고
// 카메라를 둘 거리(팔 길이)를 정한다. 광선 검사 자체는 CityModel이 건물 메시의 BVH로 한다.
// 목표점과 카메라 사이를 가로막기만 하는 건물은 카메라를 움직이지 않는다. 그런 건물마다 벽 앞으로 당기면 궤도를 돌 때
// 카메라가 수십 미터씩 튀었다.

// 카메라(와 near 평면)가 벽 앞에 남겨 둘 여유(장면 단위).
export const CAMERA_WALL_MARGIN = 1;

// hits: 목표점에서 카메라 방향 광선의 교차를 거리순으로 [{ distance, entering }]. entering은 앞면(건물 밖에서 안으로)이다.
// desired: 사용자가 원하는 목표점-카메라 거리. 반환: 카메라를 둘 거리.
// - 카메라가 건물 안에 있으면(마지막으로 지난 면이 앞면이거나, 카메라 뒤 첫 면이 뒷면) 그 건물의 앞벽(목표점 쪽)과
//   뒷벽 중 가까운 쪽 바깥에 둔다. 목표점이 같은 건물 안이라 앞벽이 없으면 뒷벽 바깥으로 밀어낸다.
// - 앞벽 쪽은 여유만큼 목표점 쪽이다. 앞선 교차(목표점이 들어 있던 건물의 벽)와 여유보다 가까우면 두 벽 사이 중앙에 둔다.
// - 카메라가 건물 밖이면 원하는 거리를 그대로 쓴다.
export function resolveArmLength(hits, desired, margin = CAMERA_WALL_MARGIN) {
  let previous = 0;
  let entry = null;
  const front = () => Math.max(entry - margin, (previous + entry) / 2);
  for (const hit of hits) {
    if (hit.distance >= desired) {
      if (hit.entering) return desired;
      const back = hit.distance + margin;
      if (entry === null) return back;
      return desired - front() <= back - desired ? front() : back;
    }
    if (hit.entering) {
      entry = hit.distance;
    } else {
      previous = hit.distance;
      entry = null;
    }
  }
  return entry === null ? desired : front();
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

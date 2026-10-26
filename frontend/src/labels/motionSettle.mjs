// 카메라 움직임(사용자 조작·시점 비행)이 끝났는지 정하는 순수 상태 기계. 라벨 층은 움직이는 동안 흐리게 하고 배치를 멈췄다가,
// 끝나면 한 번 다시 배치한다. 끝났다고 보려면 둘 다 필요하다:
//   1. end 이벤트와 마지막 카메라 움직임에서 settleMs(--motion-settle, 150 ms)가 지났다.
//   2. 마지막 움직임 뒤로 카메라가 움직이지 않은 프레임이 stillFrames(3)개 이어졌다.
// 시간만 보면, 부하가 커서 프레임 간격이 settleMs보다 길 때 OrbitControls 감쇠가 아직 카메라를 옮기는 중인데도 프레임 사이에서
// 끝났다고 보고 다시 배치한다. 시간은 호출하는 쪽이 now()로 넘긴다(타이머·DOM·three.js 없음).

export const SETTLE_MS = 150;
export const SETTLE_STILL_FRAMES = 3;

export function createMotionSettle({ settleMs = () => SETTLE_MS, stillFrames = SETTLE_STILL_FRAMES, now = () => performance.now() } = {}) {
  const settleTime = typeof settleMs === "function" ? settleMs : () => settleMs;
  let active = false;
  let endedAt = null;
  let lastMoveAt = -Infinity;
  let still = 0;

  return {
    start() {
      active = true;
      endedAt = null;
      still = 0;
    },
    end() {
      if (active) endedAt = now();
    },
    // 렌더 프레임마다 그 프레임에 카메라가 움직였는지 알린다.
    noteFrame(moved) {
      if (moved) {
        lastMoveAt = now();
        still = 0;
      } else {
        still += 1;
      }
    },
    isActive: () => active,
    // 끝났는지 본다. 결과:
    //   { settled: true }                      움직임이 끝났다(이 호출에서 끝냈거나 원래 움직이지 않았다).
    //   { settled: false, waitMs }             시간이 더 지나야 한다(waitMs 뒤에 다시 본다).
    //   { settled: false, framesNeeded }       시간은 됐지만 조용한 프레임이 모자란다(프레임을 더 그려 달라고 한다).
    //   { settled: false, waitMs: null }       아직 end가 오지 않았다.
    poll() {
      if (!active) return { settled: true };
      if (endedAt === null) return { settled: false, waitMs: null };
      const remaining = settleTime() - (now() - Math.max(endedAt, lastMoveAt));
      if (remaining > 0) return { settled: false, waitMs: remaining };
      if (still < stillFrames) return { settled: false, framesNeeded: stillFrames - still };
      active = false;
      return { settled: true };
    },
  };
}

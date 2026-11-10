import { useEffect, useRef, useState } from "react";

// 값이 사람의 이산 조작(날짜·시각 입력, 시점 이동, 지금)으로 바뀐 직후 잠깐(durationMs) true. 처음 그릴 때는 false다.
// 재생과 실시간 분 갱신(한 분씩 나아간다), 슬라이더 끌기(짧은 간격으로 이어지는 변화)에는 켜지 않고 켜져 있던 강조도 끈다.
export const UPDATED_CUE_MS = 1000;
// 앞 변화에서 이 시간 안에 또 바뀌면 끌기·재생처럼 이어지는 변화로 본다.
export const CONTINUOUS_GAP_MS = 400;
const MINUTES_PER_DAY = 1440;

export function isDiscreteJump(previous, next, sincePreviousMs, gapMs = CONTINUOUS_GAP_MS) {
  if (sincePreviousMs < gapMs) return false;
  if (typeof previous === "number" && typeof next === "number") {
    const delta = Math.abs(next - previous) % MINUTES_PER_DAY;
    if (Math.min(delta, MINUTES_PER_DAY - delta) <= 1) return false;
  }
  return true;
}

export function useUpdatedCue(value, { durationMs = UPDATED_CUE_MS } = {}) {
  const [updated, setUpdated] = useState(false);
  const previous = useRef({ value, at: -Infinity });
  useEffect(() => {
    const last = previous.current;
    if (Object.is(last.value, value)) return undefined;
    const at = Date.now();
    previous.current = { value, at };
    if (!isDiscreteJump(last.value, value, at - last.at)) {
      setUpdated(false);
      return undefined;
    }
    setUpdated(true);
    const timer = setTimeout(() => setUpdated(false), durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, value]);
  return updated;
}

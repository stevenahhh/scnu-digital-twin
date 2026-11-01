import { useEffect, useRef, useState } from "react";

// 값이 바뀐 직후 잠깐(durationMs) true. 처음 그릴 때는 false다. 시간을 옮기면 무엇이 갱신됐는지 읽음판이 알린다(AUDIT GAP-14).
export const UPDATED_CUE_MS = 2000;

export function useUpdatedCue(value, { durationMs = UPDATED_CUE_MS } = {}) {
  const [updated, setUpdated] = useState(false);
  const previous = useRef(value);
  useEffect(() => {
    if (Object.is(previous.current, value)) return undefined;
    previous.current = value;
    setUpdated(true);
    const timer = setTimeout(() => setUpdated(false), durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, value]);
  return updated;
}

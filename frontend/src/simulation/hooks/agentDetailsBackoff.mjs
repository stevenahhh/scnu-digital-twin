// 다시 받기 간격. 성공하면 okMs마다, 실패하면 firstFailureMs부터 두 배씩 늘려 maxMs에서 멈춘다.
// 선택한 객체 상세(useAgentDetails): 5초 / 1 -> 2 -> 4 -> 8초 ... 30초. 영상 분석 피드(useTrafficFeed): 2초 / 5 -> 10 -> 20 -> 30초.
export const AGENT_DETAILS_BACKOFF = Object.freeze({ okMs: 5000, firstFailureMs: 1000, maxMs: 30000 });
export const TRAFFIC_FEED_BACKOFF = Object.freeze({ okMs: 2000, firstFailureMs: 5000, maxMs: 30000 });

export function nextPollDelay(consecutiveFailures, { okMs, firstFailureMs, maxMs }) {
  if (consecutiveFailures <= 0) return okMs;
  return Math.min(maxMs, firstFailureMs * 2 ** (consecutiveFailures - 1));
}

// 오프라인이면 요청하지 않고 online 이벤트를 기다린다.
export function shouldPoll(navigatorLike) {
  return navigatorLike?.onLine !== false;
}

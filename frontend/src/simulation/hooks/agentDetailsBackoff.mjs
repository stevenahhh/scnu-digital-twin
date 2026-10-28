// 다시 받기 간격. 성공하면 okMs마다, 실패하면 firstFailureMs부터 두 배씩 늘려 maxMs에서 멈춘다.
// 선택한 객체 상세(useAgentDetails): 5초 / 1 -> 2 -> 4 -> 8초 ... 30초. 영상 분석 피드(useTrafficFeed): 2초 / 5 -> 10 -> 20 -> 30초.
export const AGENT_DETAILS_BACKOFF = Object.freeze({ okMs: 5000, firstFailureMs: 1000, maxMs: 30000 });
export const TRAFFIC_FEED_BACKOFF = Object.freeze({ okMs: 2000, firstFailureMs: 5000, maxMs: 30000 });

export function nextPollDelay(consecutiveFailures, { okMs, firstFailureMs, maxMs }) {
  if (consecutiveFailures <= 0) return okMs;
  return Math.min(maxMs, firstFailureMs * 2 ** (consecutiveFailures - 1));
}

// 다음 요청까지 기다릴 시간(요청을 끝낸 시점부터). 실패하는 동안 요청 시작 사이 간격은 백오프 값보다 짧지 않고, 앞 간격보다도
// 줄지 않는다: 응답이 느리게 끝난 뒤(예: 첫 요청이 12초 걸림) 다음 간격이 앞보다 짧아지면 장애 중에 더 자주 묻게 된다.
// startedAt·completedAt: 이번 요청의 시작·끝(ms), previousGap: 앞 요청 시작에서 이번 시작까지(ms, 처음이나 성공 뒤면 0).
// 반환: { wait: 지금부터 기다릴 ms, gap: 이번 시작에서 다음 시작까지 ms }.
export function nextPollWait({ failures, startedAt, completedAt, previousGap = 0, backoff }) {
  const delay = nextPollDelay(failures, backoff);
  if (failures <= 0) return { wait: delay, gap: completedAt - startedAt + delay };
  const gap = Math.max(delay, previousGap, completedAt - startedAt);
  return { wait: Math.max(0, startedAt + gap - completedAt), gap };
}

// 오프라인이면 요청하지 않고 online 이벤트를 기다린다.
export function shouldPoll(navigatorLike) {
  return navigatorLike?.onLine !== false;
}

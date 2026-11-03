export function reconnectDelayMs(retryCount) {
  if (retryCount > 8) return 30000;
  return Math.min(10000, 500 * 2 ** (retryCount - 1));
}

export function connectionLabel(retryCount) {
  return retryCount > 8 ? "연결 끊김" : "재연결 중";
}

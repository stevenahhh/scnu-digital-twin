export function toKoreanEnergyError(error) {
  const messageKo = error?.detail?.message_ko ?? error?.message_ko;
  if (typeof messageKo === "string" && messageKo.trim()) return messageKo;

  const message = typeof error === "string" ? error : error?.message;
  const code = error?.code;
  if (/^INVALID_/i.test(code ?? "") || error?.field || /(?:^|\n)[\w.]+:\s*.*\brequired\b/i.test(message ?? "")) {
    return "서버 응답 형식이 올바르지 않습니다";
  }

  if (error instanceof TypeError) return "에너지 API에 연결할 수 없습니다";

  return "요청을 처리하지 못했습니다";
}

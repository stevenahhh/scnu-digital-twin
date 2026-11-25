import { authorizedFetch, sessionStore } from "../auth/session.mjs";
import { ASSISTANT_API_URL } from "../simulation/utils/apiConfig.js";

export const ASSISTANT_LOGIN_NOTICE = "도우미는 서버에 로그인한 뒤 사용할 수 있습니다";
const CLIENT_KEY = "scnu.assistant.client";

export class AssistantError extends Error {
  constructor(code, message, retryAfter = null) {
    super(message);
    this.name = "AssistantError";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

// The caller owns the unfinished frame; no parser state is shared between streams.
export function parseSSE(buffer, chunk) {
  const text = buffer + chunk;
  const separator = /\r?\n\r?\n/g;
  const events = [];
  let offset = 0;
  for (const match of text.matchAll(separator)) {
    const frame = text.slice(offset, match.index);
    offset = match.index + match[0].length;
    let event = "message";
    const data = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length === 0) continue;
    try {
      events.push({ event, data: JSON.parse(data.join("\n")) });
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new AssistantError("invalid_stream", "도우미 응답 형식을 읽을 수 없습니다");
    }
  }
  return { events, buffer: text.slice(offset) };
}

export function createAssistantClient({
  session = sessionStore.getSession(), apiBase = ASSISTANT_API_URL,
  fetchImpl = authorizedFetch, storage = () => globalThis.localStorage,
} = {}) {
  async function request(path, { method = "GET", body, signal, stream = false } = {}) {
    if (!session?.token) throw new AssistantError("login_required", ASSISTANT_LOGIN_NOTICE);
    const headers = { Authorization: `Bearer ${session.token}`, Accept: stream ? "text/event-stream" : "application/json" };
    if (session.account.guest) {
      try {
        const store = typeof storage === "function" ? storage() : storage;
        let clientId = store.getItem(CLIENT_KEY);
        if (!/^[A-Za-z0-9_-]{22,64}$/.test(clientId ?? "")) {
          clientId = globalThis.crypto.randomUUID();
          store.setItem(CLIENT_KEY, clientId);
        }
        headers["X-Assistant-Client"] = clientId;
      } catch (error) {
        if (!(error instanceof DOMException || error instanceof TypeError)) throw error;
        throw new AssistantError("storage_unavailable", "게스트 대화를 시작하려면 브라우저 저장소를 허용해 주세요");
      }
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await fetchImpl(`${apiBase}${path}`, {
        method, headers, signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      throw new AssistantError("connection_failed", "도우미 서버에 연결할 수 없습니다");
    }
    if (!response.ok) {
      let detail;
      try {
        detail = (await response.json()).detail;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      throw new AssistantError(
        detail?.code ?? `http_${response.status}`,
        detail?.message_ko ?? (typeof detail === "string" ? detail : `도우미 요청이 실패했습니다 (HTTP ${response.status})`),
        detail?.retry_after_s ?? null,
      );
    }
    return response;
  }
  const sessions = "/chat/sessions";
  const path = (sid) => `${sessions}/${encodeURIComponent(sid)}`;
  const json = async (url, options) => (await request(url, options)).json();
  return {
    create: (signal) => json(sessions, { method: "POST", body: {}, signal }),
    list: (signal) => json(sessions, { signal }),
    messages: (sid, signal) => json(`${path(sid)}/messages`, { signal }),
    prompts: (signal) => json("/chat/prompts", { signal }),
    cancel: (sid) => request(`${path(sid)}/cancel`, { method: "POST" }),
    confirm: (sid, body) => request(`${path(sid)}/confirm`, { method: "POST", body }),
    remove: (sid) => request(path(sid), { method: "DELETE" }),
    async send(sid, body, { signal, onEvent }) {
      const response = await request(`${path(sid)}/messages`, { method: "POST", body, signal, stream: true });
      if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
        throw new AssistantError("invalid_stream", "도우미 스트림 응답을 읽을 수 없습니다");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let ended = false;
      try {
        while (!ended) {
          const { done, value } = await reader.read();
          const parsed = parseSSE(buffer, done ? decoder.decode() : decoder.decode(value, { stream: true }));
          buffer = parsed.buffer;
          for (const event of parsed.events) {
            onEvent(event);
            if (event.event === "end") { ended = true; break; }
          }
          if (done) break;
        }
        if (!ended) throw new AssistantError("stream_interrupted", "답변 연결이 끊겼습니다. 다시 질문해 주세요");
      } finally {
        try { await reader.cancel(); }
        finally { reader.releaseLock(); }
      }
    },
  };
}

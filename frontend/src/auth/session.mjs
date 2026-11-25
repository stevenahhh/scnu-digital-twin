import { WEATHER_API_URL } from "../simulation/utils/apiConfig.js";

export const SESSION_KEY = "scnu.session";
export const PASSWORD_LENGTH = 8;
export const ROLES = Object.freeze(["student", "admin"]);

const SERVER_UNREACHABLE = "서버에 연결할 수 없습니다";
const SESSION_ENDED = "로그인이 필요한 작업입니다. 다시 로그인하세요";
const text = (value, fallback) => (typeof value === "string" && value.length > 0 ? value : fallback);

// 서버 응답이나 저장해 둔 값을 세션으로 읽는다. 모양이 다르거나 만료됐으면 null이다.
function parseSession(value, now) {
  const account = value?.account;
  if (typeof account?.id !== "string" || !ROLES.includes(account.role)) return null;
  const expiresAt = text(value.expires_at ?? value.expiresAt, null);
  if (expiresAt && !(Date.parse(expiresAt) > now)) return null;
  return {
    token: text(value.token, null),
    expiresAt,
    account: { id: account.id, name: text(account.name, account.id), role: account.role, guest: account.guest === true },
  };
}

// 인증 서버에 닿지 못할 때의 게스트 세션. 토큰이 없으므로 화면만 고르고, 서버는 쓰기 요청을 401로 막는다.
const localGuest = (role) => ({ token: null, expiresAt: null, account: { id: `guest-${role}`, name: "게스트", role, guest: true } });

// 로그인 세션 하나를 들고 있는 저장소. 세션은 localStorage(SESSION_KEY)에 남아 새로 고침 뒤에도 이어진다.
// 화면은 역할(student·admin)로 갈리고, 권한은 서버가 토큰으로 확인한다(GET은 공개, 그 밖의 메서드는 관리자).
export function createSessionStore({
  storage = () => globalThis.localStorage ?? null,
  fetchImpl = (...args) => globalThis.fetch(...args),
  apiBase = WEATHER_API_URL,
  now = Date.now,
} = {}) {
  const listeners = new Set();
  let notice = null;
  let loaded = false;
  let session = null;

  const readStored = () => {
    try {
      return parseSession(JSON.parse(storage()?.getItem(SESSION_KEY) ?? "null"), now());
    } catch (error) {
      // 저장소를 못 읽거나(권한) 값이 깨졌으면 로그인하지 않은 것으로 본다.
      if (error instanceof SyntaxError || error instanceof DOMException) return null;
      throw error;
    }
  };
  const writeStored = (next) => {
    try {
      if (next) storage()?.setItem(SESSION_KEY, JSON.stringify(next));
      else storage()?.removeItem(SESSION_KEY);
    } catch (error) {
      // 저장하지 못해도 이번 방문의 세션은 유지된다.
      if (!(error instanceof DOMException)) throw error;
    }
  };
  const update = (next, nextNotice = null) => {
    loaded = true;
    session = next;
    notice = nextNotice;
    writeStored(next);
    listeners.forEach((listener) => listener());
  };
  const getSession = () => {
    if (!loaded) {
      loaded = true;
      session = readStored();
    }
    return session;
  };

  // fallback은 서버에 닿지 못했을 때 대신 쓸 세션이다(게스트만 준다).
  async function signIn(path, body, fallback = null) {
    let response;
    try {
      response = await fetchImpl(`${apiBase}${path}`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      response = null;
    }
    const unreachable = response === null || response.status === 404 || response.status >= 500;
    if (unreachable && fallback) {
      update(fallback);
      return { ok: true };
    }
    if (response === null) return { ok: false, message: SERVER_UNREACHABLE };
    const payload = await response.json().catch(() => null);
    const next = response.ok ? parseSession(payload, now()) : null;
    if (!next) return { ok: false, message: text(payload?.detail, `로그인 요청이 실패했습니다 (HTTP ${response.status})`) };
    update(next);
    return { ok: true };
  }

  return {
    getSession,
    getNotice: () => notice,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    login({ id, password }) {
      if (password.length !== PASSWORD_LENGTH) return Promise.resolve({ ok: false, message: `비밀번호는 ${PASSWORD_LENGTH}자리입니다` });
      return signIn("/auth/login", { id, password });
    },
    loginAsGuest: (role) => signIn("/auth/guest", { role }, localGuest(role)),
    logout: () => update(null),
    // 쓰기 요청(GET·HEAD가 아닌 것)에만 토큰을 싣는다. 401이면 세션을 끝내 로그인 화면으로 돌려보낸다.
    async authorizedFetch(...args) {
      const [input, init = {}] = args;
      const method = (init.method ?? "GET").toUpperCase();
      if (method === "GET" || method === "HEAD") return fetchImpl(...args);
      const current = getSession();
      const response = await fetchImpl(
        input,
        current?.token ? { ...init, headers: { ...init.headers, Authorization: `Bearer ${current.token}` } } : init,
      );
      if (response.status === 401 && current) update(null, SESSION_ENDED);
      return response;
    },
  };
}

export const sessionStore = createSessionStore();
export const authorizedFetch = (...args) => sessionStore.authorizedFetch(...args);

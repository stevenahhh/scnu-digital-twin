import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_KEY, createSessionStore } from "./session.mjs";

const API = "http://api.test";
const FUTURE = "2099-01-01T00:00:00Z";
const adminBody = { token: "tok-admin", token_type: "bearer", expires_at: FUTURE, account: { id: "admin", name: "관리자", role: "admin", guest: false } };
const guestBody = (role) => ({ token: `tok-${role}`, token_type: "bearer", expires_at: FUTURE, account: { id: `guest-${role}`, name: "게스트", role, guest: true } });

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const networkDown = async () => {
  throw new TypeError("Failed to fetch");
};

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

function storeWith(respond, storage = memoryStorage()) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { store: createSessionStore({ storage: () => storage, fetchImpl, apiBase: API, now: () => Date.parse("2026-11-17T00:00:00Z") }), calls, storage };
}

test("account login stores the session, notifies subscribers and survives a reload", async () => {
  const { store, calls, storage } = storeWith(() => json(200, adminBody));
  let notified = 0;
  store.subscribe(() => { notified += 1; });

  const result = await store.login({ id: "admin", password: "12341234" });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].url, `${API}/auth/login`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { id: "admin", password: "12341234" });
  assert.equal(store.getSession().account.role, "admin");
  assert.equal(notified, 1);
  const reloaded = createSessionStore({ storage: () => storage, fetchImpl: networkDown, apiBase: API, now: () => Date.parse("2026-11-17T00:00:00Z") });
  assert.equal(reloaded.getSession().token, "tok-admin");
});

test("a password that is not 8 characters never reaches the server", async () => {
  const { store, calls } = storeWith(() => json(200, adminBody));
  const result = await store.login({ id: "admin", password: "1234" });
  assert.equal(result.ok, false);
  assert.match(result.message, /8자리/);
  assert.equal(calls.length, 0);
  assert.equal(store.getSession(), null);
});

test("a rejected login reports the server's message and leaves no session", async () => {
  const { store } = storeWith(() => json(401, { detail: "아이디 또는 비밀번호가 올바르지 않습니다" }));
  const result = await store.login({ id: "20239901", password: "00000000" });
  assert.deepEqual(result, { ok: false, message: "아이디 또는 비밀번호가 올바르지 않습니다" });
  assert.equal(store.getSession(), null);
});

test("guest login asks the server for the chosen role", async () => {
  const { store, calls } = storeWith((_url, init) => json(200, guestBody(JSON.parse(init.body).role)));
  assert.deepEqual(await store.loginAsGuest("student"), { ok: true });
  assert.equal(calls[0].url, `${API}/auth/guest`);
  assert.deepEqual(store.getSession().account, { id: "guest-student", name: "게스트", role: "student", guest: true });
});

test("guest login still enters without a token when the auth server is unreachable, account login does not", async () => {
  const { store } = storeWith(networkDown);
  assert.deepEqual(await store.loginAsGuest("admin"), { ok: true });
  assert.equal(store.getSession().token, null);
  assert.equal(store.getSession().account.role, "admin");

  const offline = storeWith(networkDown).store;
  const result = await offline.login({ id: "admin", password: "12341234" });
  assert.equal(result.ok, false);
  assert.equal(offline.getSession(), null);
});

test("guest login is refused when the server has it turned off", async () => {
  const { store } = storeWith(() => json(403, { detail: "게스트 로그인이 꺼져 있습니다" }));
  assert.deepEqual(await store.loginAsGuest("admin"), { ok: false, message: "게스트 로그인이 꺼져 있습니다" });
  assert.equal(store.getSession(), null);
});

test("authorizedFetch adds the bearer token to writes only", async () => {
  const { store, calls } = storeWith((url) => (url.endsWith("/auth/login") ? json(200, adminBody) : json(200, {})));
  await store.login({ id: "admin", password: "12341234" });

  const getInit = { headers: { Accept: "application/json" } };
  await store.authorizedFetch(`${API}/energy/buildings`, getInit);
  assert.equal(calls[1].init, getInit);

  await store.authorizedFetch(`${API}/energy/scenarios`, { method: "POST", headers: { Accept: "application/json" }, body: "{}" });
  assert.deepEqual(calls[2].init.headers, { Accept: "application/json", Authorization: "Bearer tok-admin" });
});

test("a 401 on a write ends the session and leaves a notice for the login screen", async () => {
  const { store } = storeWith((url) => (url.endsWith("/auth/login") ? json(200, adminBody) : json(401, { detail: "로그인이 필요합니다" })));
  await store.login({ id: "admin", password: "12341234" });

  const response = await store.authorizedFetch(`${API}/energy/scenarios`, { method: "POST", body: "{}" });

  assert.equal(response.status, 401);
  assert.equal(store.getSession(), null);
  assert.match(store.getNotice(), /다시 로그인/);
});

test("an expired or malformed stored session is ignored", () => {
  const expired = JSON.stringify({ token: "old", expiresAt: "2020-01-01T00:00:00Z", account: { id: "admin", name: "관리자", role: "admin", guest: false } });
  assert.equal(storeWith(networkDown, memoryStorage({ [SESSION_KEY]: expired })).store.getSession(), null);
  assert.equal(storeWith(networkDown, memoryStorage({ [SESSION_KEY]: "{not json" })).store.getSession(), null);
  const unknownRole = JSON.stringify({ token: "t", expiresAt: FUTURE, account: { id: "x", name: "x", role: "root", guest: false } });
  assert.equal(storeWith(networkDown, memoryStorage({ [SESSION_KEY]: unknownRole })).store.getSession(), null);
});

test("logout clears the stored session", async () => {
  const { store, storage } = storeWith(() => json(200, adminBody));
  await store.login({ id: "admin", password: "12341234" });
  store.logout();
  assert.equal(store.getSession(), null);
  assert.equal(storage.getItem(SESSION_KEY), null);
  assert.equal(store.getNotice(), null);
});

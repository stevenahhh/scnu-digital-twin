import assert from "node:assert/strict";
import { test } from "node:test";
import { createAssistantClient, parseSSE, AssistantError } from "./assistantClient.mjs";
import { resolveAssistantEndpoint } from "../simulation/utils/apiConfig.js";

test("assistant endpoint uses its own origin and trims trailing slashes", () => {
  assert.equal(resolveAssistantEndpoint(), "http://127.0.0.1:8004");
  assert.equal(resolveAssistantEndpoint({ VITE_ASSISTANT_API_URL: "https://assistant.example///" }), "https://assistant.example");
});

test("SSE preserves split frames and ignores heartbeat comments at every chunk boundary", () => {
  const wire = ': heartbeat\r\n\r\nevent: token\r\ndata: {"text":"순천"}\r\n\r\nevent: final\ndata: {"text":"추정"}\n\nevent: end\ndata: {}\n\n';
  const expected = [
    { event: "token", data: { text: "순천" } },
    { event: "final", data: { text: "추정" } },
    { event: "end", data: {} },
  ];
  for (let split = 0; split <= wire.length; split += 1) {
    const first = parseSSE("", wire.slice(0, split));
    const second = parseSSE(first.buffer, wire.slice(split));
    assert.deepEqual([...first.events, ...second.events], expected);
    assert.equal(second.buffer, "");
  }
});

test("SSE accumulates multiple data lines and keeps an unfinished frame", () => {
  assert.deepEqual(parseSSE("", 'event: token\ndata: {"text":\ndata: "안녕"}\n\nevent: final\n'), {
    events: [{ event: "token", data: { text: "안녕" } }], buffer: "event: final\n",
  });
  assert.throws(() => parseSSE("", "event: token\ndata: broken\n\n"), AssistantError);
});

const account = { role: "student", guest: true };
const memoryStorage = () => {
  const items = new Map();
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
};

test("all private endpoints carry bearer and a stable guest identity, including GETs", async () => {
  const requests = [];
  const storage = memoryStorage();
  const options = {
    session: { token: "test-session", account }, storage, apiBase: "http://assistant.test",
    fetchImpl: async (url, init) => {
      requests.push({ url, ...init });
      return new Response(init.method === "DELETE" || url.endsWith("/confirm") ? null : "{}", { status: init.method === "DELETE" || url.endsWith("/confirm") ? 204 : 200 });
    },
  };
  const client = createAssistantClient(options);
  await client.create();
  await client.list();
  await client.messages("sid");
  await client.prompts();
  await client.cancel("sid");
  await client.confirm("sid", { confirm_id: "c1", decision: "approve" });
  await createAssistantClient(options).remove("sid");
  assert.deepEqual(requests.map(({ url, method }) => [url, method]), [
    ["http://assistant.test/chat/sessions", "POST"],
    ["http://assistant.test/chat/sessions", "GET"],
    ["http://assistant.test/chat/sessions/sid/messages", "GET"],
    ["http://assistant.test/chat/prompts", "GET"],
    ["http://assistant.test/chat/sessions/sid/cancel", "POST"],
    ["http://assistant.test/chat/sessions/sid/confirm", "POST"],
    ["http://assistant.test/chat/sessions/sid", "DELETE"],
  ]);
  const ids = requests.map(({ headers }) => headers["X-Assistant-Client"]);
  assert.match(ids[0], /^[A-Za-z0-9_-]{22,64}$/);
  assert.equal(new Set(ids).size, 1);
  assert.ok(requests.every(({ headers }) => headers.Authorization === "Bearer test-session"));
  assert.deepEqual(JSON.parse(requests[5].body), { confirm_id: "c1", decision: "approve" });
});

test("a local-only session sends nothing and an account session needs no guest storage", async () => {
  let calls = 0;
  const fetchImpl = async (_url, init) => {
    calls += 1;
    assert.equal(init.headers["X-Assistant-Client"], undefined);
    return new Response("{}");
  };
  const local = createAssistantClient({ session: { token: null, account }, fetchImpl });
  await assert.rejects(local.list(), { code: "login_required" });
  assert.equal(calls, 0);
  await createAssistantClient({ session: { token: "account-token", account: { guest: false } }, fetchImpl }).list();
  assert.equal(calls, 1);
});

test("fetch stream decodes split UTF-8 and delivers every event with context", async () => {
  const names = ["run", "status", "token", "tool", "action", "confirm", "todo", "final", "error", "end"];
  const bytes = new TextEncoder().encode(names.map((name) => `event: ${name}\ndata: ${JSON.stringify({ text: "순천" })}\n\n`).join(""));
  const events = [];
  let request;
  const client = createAssistantClient({
    session: { token: "test-session", account: { guest: false } },
    fetchImpl: async (_url, init) => {
      request = init;
      return new Response(new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
          controller.close();
        },
      }), { headers: { "Content-Type": "text/event-stream" } });
    },
  });
  const context = { t: "2026-11-25T09:00+09:00", sel: "BLD_D4", tab: "assistant", view: "campus", clock: "live" };
  await client.send("sid", { text: "날씨", context }, { onEvent: (event) => events.push(event) });
  assert.deepEqual(events.map((item) => item.event), names);
  assert.ok(events.every((item) => item.data.text === "순천"));
  assert.deepEqual(JSON.parse(request.body), { text: "날씨", context });
  assert.equal(request.headers.Accept, "text/event-stream");
});

test("C1 errors preserve Korean message and retry hint", async () => {
  const client = createAssistantClient({
    session: { token: "test-session", account: { guest: false } },
    fetchImpl: async () => new Response(JSON.stringify({ detail: { code: "budget_exceeded", message_ko: "사용 한도 초과", retry_after_s: 60 } }), { status: 429 }),
  });
  await assert.rejects(client.list(), { code: "budget_exceeded", message: "사용 한도 초과", retryAfter: 60 });
});

test("an interrupted stream fails instead of reporting a completed answer", async () => {
  const client = createAssistantClient({
    session: { token: "test-session", account: { guest: false } },
    fetchImpl: async () => new Response('event: token\ndata: {"text":"일부"}\n\n', { headers: { "Content-Type": "text/event-stream" } }),
  });
  await assert.rejects(client.send("sid", { text: "질문" }, { onEvent() {} }), { code: "stream_interrupted" });
});

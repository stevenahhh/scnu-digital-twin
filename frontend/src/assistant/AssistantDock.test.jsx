/* @vitest-environment jsdom */
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AssistantDock } from "./AssistantDock.jsx";
import { useAssistant } from "./useAssistant.mjs";

const student = { token: "test-student", account: { role: "student", guest: false } };
const admin = { token: "test-admin", account: { role: "admin", guest: false } };
const context = () => ({ t: "2026-11-25T10:00+09:00", sel: "BLD_D4", tab: "assistant", view: "campus", clock: "live" });
const wire = (event, data) => new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function server() {
  let stream;
  const fetch = vi.fn(async (url, init) => {
    if (url.endsWith("/chat/prompts")) return json({ prompts: [{ name: "weather_now", title: "지금 캠퍼스 날씨", description: "" }] });
    if (url.endsWith("/chat/sessions")) return init.method === "POST"
      ? json({ session_id: "new", role: "admin", epoch: 1, limits: {} }, 201)
      : json({ sessions: [{ session_id: "old", title: "이전 날씨" }] });
    if (url.endsWith("/messages") && init.method === "GET") return json({ messages: [{ role: "assistant", text: "이전 답변", flags: { stale: true } }] });
    if (url.endsWith("/messages")) return new Response(new ReadableStream({
      start(controller) {
        stream = controller;
        init.signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
      },
    }), { headers: { "Content-Type": "text/event-stream" } });
    return new Response(null, { status: url.endsWith("/cancel") ? 202 : 204 });
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, emit: (name, data) => act(async () => { stream.enqueue(wire(name, data)); }) };
}

function Harness({ session = student, onAction = () => {}, refresh = () => {} }) {
  const [visible, setVisible] = useState(true);
  const assistant = useAssistant({ session, active: visible, context, onAction, onWriteComplete: refresh });
  return <><button onClick={() => setVisible((value) => !value)}>다른 탭</button>{visible && <AssistantDock assistant={assistant} />}</>;
}
async function ask() {
  await screen.findByRole("button", { name: "지금 캠퍼스 날씨" });
  fireEvent.change(screen.getByRole("textbox", { name: "질문" }), { target: { value: "날씨 알려줘" } });
  fireEvent.click(screen.getByRole("button", { name: "전송" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "답변 중지" })).toBeTruthy());
  await act(async () => {});
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("sends the prompt title when the live prompt catalogue supplies no text field", async () => {
  const api = server();
  render(<Harness />);
  fireEvent.click(await screen.findByRole("button", { name: "지금 캠퍼스 날씨" }));
  await waitFor(() => expect(api.fetch.mock.calls.some(([url, init]) => url.endsWith("/messages") && init.method === "POST")).toBe(true));
  const sent = api.fetch.mock.calls.find(([url, init]) => url.endsWith("/messages") && init.method === "POST");
  expect(JSON.parse(sent[1].body).text).toBe("지금 캠퍼스 날씨");
  await api.emit("end", {});
});

it("a local guest sees the login notice and makes no network requests", () => {
  const api = server();
  render(<Harness session={{ token: null, account: { role: "student", guest: true } }} />);
  expect(screen.getByText("도우미는 서버에 로그인한 뒤 사용할 수 있습니다")).toBeTruthy();
  expect(screen.getByText("질문과 답변은 외부 AI 서비스로 전송됩니다")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(api.fetch).not.toHaveBeenCalled();
});

it("replaces streamed text with final text and renders all provenance badges and estimated usage", async () => {
  const api = server();
  const onAction = vi.fn();
  render(<Harness onAction={onAction} />);
  await ask();
  await api.emit("run", { run_id: "r1", epoch: 1 });
  await api.emit("token", { text: "임시 답변" });
  expect(screen.getByText("임시 답변")).toBeTruthy();
  await api.emit("tool", { call_id: "a", name: "campus_weather", state: "start" });
  await api.emit("tool", { call_id: "a", name: "campus_weather", state: "ok", ms: 42 });
  await api.emit("action", { action: "focus", target: "BLD_D4", label_ko: "공대 이동" });
  await api.emit("todo", { items: [{ text: "날씨 확인", done: true }] });
  await api.emit("final", { text: "최종 추정 답변", flags: { estimated: true, stale: true, sample: true, simulation: true }, usage: { est_input: 12, est_output: 20, est_context: 32, estimated: true } });
  await api.emit("end", {});
  await waitFor(() => expect(screen.queryByRole("button", { name: "답변 중지" })).toBeNull());
  expect(screen.queryByText("임시 답변")).toBeNull();
  expect(screen.getByText("최종 추정 답변")).toBeTruthy();
  for (const text of ["추정", "저장된 기상 데이터", "샘플 데이터", "시뮬레이션 시나리오"]) expect(screen.getByText(text).dataset.qa).toMatch(/badge/);
  expect(screen.getByText("토큰 사용량 추정 · 입력 12 · 출력 20 · 문맥 32")).toBeTruthy();
  expect(screen.getByLabelText("도구 실행 상태").children).toHaveLength(1);
  expect(screen.getByText("캠퍼스 날씨 · 완료 · 42ms")).toBeTruthy();
  expect(onAction).toHaveBeenCalledWith({ action: "focus", target: "BLD_D4", label_ko: "공대 이동" });
  const sent = api.fetch.mock.calls.find(([url, init]) => url.endsWith("/messages") && init.method === "POST");
  expect(JSON.parse(sent[1].body).context).toEqual(context());
});

it.each(["approve", "reject"])("admin confirmation sends %s only after a click and refreshes only after tool success", async (decision) => {
  const api = server();
  const refresh = vi.fn();
  render(<Harness session={admin} refresh={refresh} />);
  await ask();
  await api.emit("confirm", { confirm_id: "c1", tool: "restriction_create", args: {}, summary_ko: "RD_057 차량 제한", expires_in_s: 120 });
  expect(api.fetch.mock.calls.some(([url]) => url.endsWith("/confirm"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: decision === "approve" ? "적용" : "취소" }));
  await waitFor(() => expect(screen.queryByRole("group", { name: "시뮬레이션 변경 확인" })).toBeNull());
  const sent = api.fetch.mock.calls.find(([url]) => url.endsWith("/confirm"));
  expect(JSON.parse(sent[1].body)).toEqual({ confirm_id: "c1", decision });
  expect(refresh).not.toHaveBeenCalled();
  if (decision === "approve") {
    await api.emit("tool", { call_id: "write", name: "restriction_create", state: "ok" });
    expect(refresh).toHaveBeenCalledTimes(1);
  }
  await api.emit("end", {});
});

it("students cannot confirm and stopping aborts the stream and calls cancel", async () => {
  const api = server();
  render(<Harness />);
  await ask();
  await api.emit("confirm", { confirm_id: "c1", summary_ko: "변경", expires_in_s: 120 });
  expect(screen.queryByRole("button", { name: "적용" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "답변 중지" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "답변 중지" })).toBeNull());
  expect(api.fetch.mock.calls.find(([url]) => url.endsWith("/cancel"))[1].method).toBe("POST");
  expect(api.fetch.mock.calls.find(([url, init]) => url.endsWith("/messages") && init.method === "POST")[1].signal.aborted).toBe(true);
});

it("changing tabs keeps the run alive but unmounting the dashboard aborts it", async () => {
  const api = server();
  const mounted = render(<Harness />);
  await ask();
  const signal = api.fetch.mock.calls.find(([url, init]) => url.endsWith("/messages") && init.method === "POST")[1].signal;
  fireEvent.click(screen.getByRole("button", { name: "다른 탭" }));
  expect(signal.aborted).toBe(false);
  await api.emit("token", { text: "계속되는 답변" });
  fireEvent.click(screen.getByRole("button", { name: "다른 탭" }));
  fireEvent.click(screen.getByRole("button", { name: "대화창 펼치기" }));
  expect(screen.getByText("계속되는 답변")).toBeTruthy();
  mounted.unmount();
  expect(signal.aborted).toBe(true);
});

it("restores history and deletes the selected conversation", async () => {
  const api = server();
  render(<Harness />);
  await screen.findByRole("button", { name: "이전 대화" });
  fireEvent.click(screen.getByRole("button", { name: "이전 대화" }));
  fireEvent.click(screen.getByRole("button", { name: "이전 날씨" }));
  await screen.findByText("이전 답변");
  expect(screen.getByText("저장된 기상 데이터").dataset.qa).toBe("status-badge");
  fireEvent.click(screen.getByRole("button", { name: "대화 삭제" }));
  await waitFor(() => expect(screen.queryByText("이전 답변")).toBeNull());
  expect(api.fetch.mock.calls.find(([url, init]) => url.endsWith("/old") && init.method === "DELETE")).toBeTruthy();
});

it("expired proposals stop offering an apply action", async () => {
  const api = server();
  render(<Harness session={admin} />);
  await ask();
  vi.useFakeTimers();
  await api.emit("confirm", { confirm_id: "c1", summary_ko: "변경", expires_in_s: 120 });
  act(() => vi.advanceTimersByTime(120000));
  expect(screen.queryByRole("button", { name: "적용" })).toBeNull();
  expect(screen.getByText("적용 확인 시간이 만료됐습니다")).toBeTruthy();
  await api.emit("end", {});
});

it("renders answers as markdown and html blocks as sandboxed cards", async () => {
  const api = server();
  render(<Harness />);
  await ask();
  expect(screen.getByRole("region", { name: "도우미 대화" }).dataset.expanded).toBe("true");
  await api.emit("final", { text: "**굵은 요약**\n\n```html\n<table><tr><td>34.9</td></tr></table>\n```", flags: {} });
  await api.emit("end", {});
  expect(screen.getByText("굵은 요약").tagName).toBe("STRONG");
  const card = screen.getByTitle("도우미 자료");
  expect(card.getAttribute("sandbox")).toBe("allow-same-origin");
  expect(card.getAttribute("srcdoc")).toContain("<td>34.9</td>");
});

it("deletes a conversation from the history list without opening it", async () => {
  const api = server();
  render(<Harness />);
  fireEvent.click(await screen.findByRole("button", { name: "이전 대화" }));
  fireEvent.click(screen.getByRole("button", { name: "이전 날씨 삭제" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "이전 날씨" })).toBeNull());
  expect(api.fetch.mock.calls.find(([url, init]) => url.endsWith("/old") && init.method === "DELETE")).toBeTruthy();
  expect(api.fetch.mock.calls.some(([url, init]) => url.endsWith("/old/messages") && init.method === "GET")).toBe(false);
});

it("Escape folds the chat window back into the input bar", async () => {
  const api = server();
  render(<Harness />);
  await ask();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "질문" }), { key: "Escape" });
  expect(screen.getByRole("region", { name: "도우미 대화" }).dataset.expanded).toBe("false");
  expect(screen.getByRole("button", { name: "대화창 펼치기" })).toBeTruthy();
  await api.emit("end", {});
});

import { useId, useState } from "react";
import { Button, FOCUS_RING } from "../ui/Button.jsx";
import { Disclosure } from "../ui/Disclosure.jsx";
import { StatusBadge } from "../ui/StatusBadge.jsx";
import { ASSISTANT_LOGIN_NOTICE } from "./assistantClient.mjs";

const FLAGS = [
  ["estimated", "추정", "estimate"],
  ["stale", "저장된 기상 데이터", "warning"],
  ["sample", "샘플 데이터", "sample"],
  ["simulation", "시뮬레이션 시나리오", "neutral"],
];
const TOOL_STATES = { start: "처리 중", ok: "완료", error: "실패" };
const TOOL_LABELS = {
  find_place: "장소 검색", campus_weather: "캠퍼스 날씨", building_status: "건물 상태",
  comfort_rank: "쾌적도 비교", campus_status: "캠퍼스 현황", ui_action: "화면 이동",
  eval: "자료 분석", read: "자료 읽기", search: "자료 검색", simulation_overview: "교통 시뮬레이션",
  restriction_create: "통제 시나리오 생성", restriction_remove: "통제 시나리오 삭제",
  simulation_control: "시뮬레이션 제어", todo: "작업 목록",
};

export function AssistantPanel({ assistant }) {
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const noticeId = useId();
  const busy = assistant.running || assistant.loading;
  const send = (text) => {
    if (busy || !assistant.available || !text.trim() || text.trim().length > 2000) return;
    setDraft("");
    void assistant.send(text);
  };
  return (
    <section aria-label="도우미 대화" data-qa="assistant-panel" className="flex min-w-0 flex-col gap-6 text-body [overflow-wrap:anywhere]">
      <p id={noticeId} className="text-caption text-ink-muted">질문과 답변은 외부 AI 서비스로 전송됩니다</p>
      {!assistant.available ? <p role="status">{ASSISTANT_LOGIN_NOTICE}</p> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => { assistant.newConversation(); setDraft(""); }} disabled={busy}>새 대화</Button>
            {assistant.sid && <Button size="sm" variant="ghost" disabled={busy} onClick={assistant.remove}>대화 삭제</Button>}
          </div>
          {assistant.sessions.length > 0 && (
            <Disclosure summary="이전 대화">
              <ul className="flex min-w-0 flex-col gap-2">
                {assistant.sessions.map((item) => (
                  <li key={item.session_id} className="min-w-0">
                    <Button variant="ghost" disabled={busy} onClick={() => assistant.restore(item.session_id)} aria-current={assistant.sid === item.session_id ? "true" : undefined} className="h-auto min-h-11 max-w-full whitespace-normal text-left">
                      {item.title || "제목 없는 대화"}
                    </Button>
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
          {assistant.loading && <p role="status" className="text-caption text-ink-muted">대화를 불러오는 중입니다</p>}
          {assistant.messages.length === 0 && !assistant.loading && (
            <div className="flex flex-col gap-3">
              <p>캠퍼스 날씨나 건물 상태를 질문해 주세요.</p>
              <div className="flex flex-wrap gap-2">
                {assistant.prompts.map((prompt) => (
                  <Button key={prompt.name} size="sm" disabled={busy} onClick={() => send(prompt.text ?? prompt.title)} className="h-auto min-h-11 whitespace-normal">{prompt.title}</Button>
                ))}
              </div>
            </div>
          )}
          <ol aria-label="대화 내용" className="flex min-w-0 flex-col gap-6">
            {assistant.messages.map((message, index) => (
              <li key={index} className="flex min-w-0 flex-col gap-2">
                <p className="text-caption text-ink-muted">{message.role === "user" ? "나" : "도우미"}</p>
                <p className="whitespace-pre-wrap">{message.text}</p>
                {message.flags && (
                  <div className="flex flex-wrap gap-2">
                    {FLAGS.filter(([flag]) => message.flags[flag]).map(([flag, label, tone]) => <StatusBadge key={flag} tone={tone}>{label}</StatusBadge>)}
                  </div>
                )}
                {message.observed_at && <p className="text-caption text-ink-muted">자료 기준 시각: {message.observed_at}</p>}
                {message.usage && <p className="text-caption text-ink-muted">토큰 사용량 추정 · 입력 {message.usage.est_input} · 출력 {message.usage.est_output} · 문맥 {message.usage.est_context}</p>}
              </li>
            ))}
          </ol>
          {assistant.tools.length > 0 && (
            <ul aria-label="도구 실행 상태" className="flex flex-col gap-2 text-caption text-ink-muted">
              {assistant.tools.map((tool) => <li key={tool.call_id}>{TOOL_LABELS[tool.name] ?? tool.name} · {TOOL_STATES[tool.state]}{tool.ms != null ? ` · ${tool.ms}ms` : ""}</li>)}
            </ul>
          )}
          {assistant.todo.length > 0 && (
            <ul aria-label="작업 목록" className="flex flex-col gap-2 text-caption">
              {assistant.todo.map((item, index) => <li key={index}>{item.done ? "완료" : "진행 예정"} · {item.text}</li>)}
            </ul>
          )}
          {assistant.status && <p role="status" className="text-caption text-ink-muted">{assistant.status}</p>}
          {assistant.pendingConfirm && assistant.role === "admin" && (
            <div role="group" aria-label="시뮬레이션 변경 확인" className="flex flex-col gap-3 rounded-card bg-surface-2 p-4">
              <p>{assistant.pendingConfirm.summary_ko}</p>
              <p className="text-caption text-ink-muted">{assistant.pendingConfirm.expires_in_s}초 이내에 적용 여부를 선택해 주세요.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={assistant.confirming} onClick={() => assistant.confirm("approve")}>적용</Button>
                <Button disabled={assistant.confirming} onClick={() => assistant.confirm("reject")}>취소</Button>
              </div>
            </div>
          )}
          {assistant.error && (
            <div className="flex flex-col items-start gap-2">
              <p role="alert">{assistant.error}</p>
              <Button size="sm" disabled={busy} onClick={assistant.retry}>다시 연결</Button>
            </div>
          )}
          <form onSubmit={(event) => { event.preventDefault(); send(draft); }} className="flex min-w-0 flex-col gap-3">
            <label htmlFor={inputId} className="text-caption text-ink-muted">질문</label>
            <textarea id={inputId} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} rows={3}
              aria-describedby={noticeId} disabled={busy}
              className={`w-full min-w-0 resize-y rounded-control border border-hairline-strong bg-surface-1 p-3 text-body text-ink caret-primary disabled:opacity-50 ${FOCUS_RING}`} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-caption text-ink-muted">{draft.length}/2000</span>
              {assistant.running
                ? <Button onClick={assistant.stop}>답변 중지</Button>
                : <Button type="submit" variant="primary" disabled={busy || !draft.trim()}>전송</Button>}
            </div>
          </form>
        </>
      )}
    </section>
  );
}

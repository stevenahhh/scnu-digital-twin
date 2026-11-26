import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUp, Check, ChevronDown, ChevronUp, Copy, History, Maximize2, Minimize2, Sparkles, SquarePen, Square, Trash2, X,
} from "lucide-react";
import { Button, FOCUS_RING } from "../ui/Button.jsx";
import { StatusBadge } from "../ui/StatusBadge.jsx";
import { cx } from "../ui/cx.mjs";
import { ASSISTANT_LOGIN_NOTICE } from "./assistantClient.mjs";
import { cardDocument, splitAnswer } from "./assistantMarkdown.mjs";

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
const NOTICE = "질문과 답변은 외부 AI 서비스로 전송됩니다";
const MAX_CHARS = 2000;
// 접힌 입력 막대 높이. 펼치면 막대 위로 그 네 배만큼 대화창이 자란다(폰은 화면 비율로 따로 정한다).
const BAR_PX = 76;
// 데스크톱에서 하단 왼쪽 시간 카드(16~400px)와 오른쪽 카메라 단추 열(지도 오른쪽 끝에서 58px) 사이의 빈 띠 가운데에 둔다.
const HUD_LEFT_PX = 416;
const HUD_RIGHT_PX = 74;
const HEIGHTS = {
  desktop: { open: `${BAR_PX * 5}px`, max: "min(80vh, 860px)" },
  phone: { open: "62dvh", max: "88dvh" },
};

// 모델이 ```html 블록으로 보낸 자료: 스크립트 없는 sandbox 문서로 띄우고 내용 높이에 맞춘다.
function HtmlCard({ html, complete }) {
  const frame = useRef(null);
  const [height, setHeight] = useState(48);
  const [doc, setDoc] = useState("");
  const [scheme, setScheme] = useState("dark");
  const observer = useRef(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  useLayoutEffect(() => {
    const style = frame.current ? getComputedStyle(frame.current.parentElement) : null;
    const root = getComputedStyle(document.documentElement);
    const primary = root.getPropertyValue("--primary").trim();
    // 부모와 color-scheme이 다르면 Chrome이 투명한 iframe 바탕을 흰색으로 칠한다.
    const scheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    setScheme(scheme);
    setDoc(cardDocument(html, style ? { color: style.color, font: style.fontFamily, accent: primary ? `hsl(${primary})` : undefined, scheme } : undefined));
  }, [html]);
  const measure = () => {
    const body = frame.current?.contentDocument?.documentElement;
    if (!body) return;
    const fit = () => setHeight(Math.min(Math.max(body.scrollHeight, 24), 1600));
    fit();
    observer.current?.disconnect();
    observer.current = new ResizeObserver(fit);
    observer.current.observe(body);
  };
  if (!complete) return <div className="rounded-control bg-surface-2 px-3 py-2 text-caption text-ink-muted" data-qa="assistant-card-pending">시각 자료를 만드는 중입니다</div>;
  return (
    <div className="min-w-0 overflow-hidden rounded-control" data-qa="assistant-card">
      <iframe ref={frame} title="도우미 자료" sandbox="allow-same-origin" srcDoc={doc} onLoad={measure}
        className="block w-full border-0 bg-transparent" style={{ height, colorScheme: scheme }} />
    </div>
  );
}

function AnswerBody({ text }) {
  const segments = splitAnswer(text);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {segments.map((segment, index) => segment.type === "card"
        ? <HtmlCard key={index} html={segment.html} complete={segment.complete} />
        // eslint-disable-next-line react/no-danger -- DOMPurify에서 거른 마크다운 HTML이다.
        : <div key={index} className="assistant-md min-w-0" dangerouslySetInnerHTML={{ __html: segment.html }} />)}
    </div>
  );
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="ghost" iconOnly label={done ? "복사됨" : "답변 복사"}
      icon={done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      onClick={async () => { await navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }} />
  );
}

function Message({ message, last, assistant }) {
  if (message.role === "user") {
    return (
      <li className="flex justify-end">
        <p className="max-w-xl whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2 text-body text-primary-foreground [overflow-wrap:anywhere]">{message.text}</p>
      </li>
    );
  }
  const live = last && assistant.running;
  const tools = last ? assistant.tools : [];
  return (
    <li className="flex min-w-0 gap-3" data-qa="assistant-message">
      <span aria-hidden="true" className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-2 text-primary"><Sparkles className="h-4 w-4" /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {tools.length > 0 && (
          <ul aria-label="도구 실행 상태" className="flex flex-wrap gap-1.5">
            {tools.map((tool) => (
              <li key={tool.call_id} className={cx("rounded-full border border-hairline px-2.5 py-0.5 text-caption", tool.state === "error" ? "text-danger" : "text-ink-muted")}>
                {TOOL_LABELS[tool.name] ?? tool.name} · {TOOL_STATES[tool.state]}{tool.ms != null ? ` · ${tool.ms}ms` : ""}
              </li>
            ))}
          </ul>
        )}
        {message.text ? <AnswerBody text={message.text} /> : live && (
          <p role="status" className="flex items-center gap-1 text-caption text-ink-muted" data-qa="assistant-typing">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-muted motion-reduce:animate-none" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-muted [animation-delay:120ms] motion-reduce:animate-none" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-muted [animation-delay:240ms] motion-reduce:animate-none" />
            <span className="sr-only">{assistant.status || "답변을 준비하고 있습니다"}</span>
          </p>
        )}
        {message.flags && FLAGS.some(([flag]) => message.flags[flag]) && (
          <div className="flex flex-wrap gap-2">
            {FLAGS.filter(([flag]) => message.flags[flag]).map(([flag, label, tone]) => <StatusBadge key={flag} tone={tone}>{label}</StatusBadge>)}
          </div>
        )}
        {(message.usage || (message.text && !live)) && (
          <div className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
            {message.observed_at && <span>자료 기준 시각: {message.observed_at}</span>}
            {message.usage && <span>토큰 사용량 추정 · 입력 {message.usage.est_input} · 출력 {message.usage.est_output} · 문맥 {message.usage.est_context}</span>}
            {message.text && !live && <CopyButton text={message.text} />}
          </div>
        )}
      </div>
    </li>
  );
}

function HistoryList({ assistant, busy, onClose }) {
  return (
    <div role="dialog" aria-label="대화 목록" className="absolute inset-x-3 top-12 z-10 max-h-[70%] overflow-y-auto rounded-card border border-hairline bg-surface-1 p-2" style={{ boxShadow: "var(--shadow-popover)" }}>
      {assistant.sessions.length === 0 ? <p className="p-3 text-caption text-ink-muted">저장된 대화가 없습니다</p> : (
        <ul className="flex flex-col">
          {assistant.sessions.map((item) => (
            <li key={item.session_id} className="flex min-w-0 items-center gap-1">
              <Button variant="ghost" disabled={busy} aria-current={assistant.sid === item.session_id ? "true" : undefined}
                onClick={() => { void assistant.restore(item.session_id); onClose(); }}
                className="h-auto min-h-10 min-w-0 flex-1 justify-start whitespace-normal text-left">
                {item.title || "제목 없는 대화"}
              </Button>
              <Button size="sm" variant="ghost" iconOnly label={`${item.title || "제목 없는 대화"} 삭제`} disabled={busy}
                icon={<Trash2 className="h-4 w-4" />} onClick={() => assistant.remove(item.session_id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// 3D 화면 하단 가운데의 도우미. 접힌 상태는 긴 입력 막대이고, 질문을 보내면 막대 위쪽으로만 대화창이 자란다.
export function AssistantDock({ assistant, mode = "desktop", insetRight = "0px", bottom, hidden = false, sheetRaised = false, onExpand }) {
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const thread = useRef(null);
  const input = useRef(null);
  const noticeId = useId();
  const phone = mode === "phone";
  const busy = assistant.running || assistant.loading;
  const hasConversation = assistant.messages?.length > 0;

  const open = (next) => {
    setExpanded(next);
    if (next) onExpand?.();
    if (!next) { setMaximized(false); setHistoryOpen(false); }
  };
  const send = (text) => {
    const question = text.trim();
    if (busy || !assistant.available || !question || question.length > MAX_CHARS) return;
    setDraft("");
    stick.current = true;
    open(true);
    void assistant.send(question);
  };

  // 새 토큰이 들어오면 맨 아래를 따라간다. 사용자가 위로 올려 읽는 중이면 따라가지 않는다.
  const stick = useRef(true);
  useEffect(() => {
    const node = thread.current;
    const content = node?.firstElementChild;
    if (!node || !content) return undefined;
    node.scrollTop = node.scrollHeight;
    const observer = new ResizeObserver(() => { if (stick.current) node.scrollTop = node.scrollHeight; });
    observer.observe(content);
    return () => observer.disconnect();
  }, [expanded]);

  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, phone ? 96 : 140)}px`;
  }, [draft, phone]);

  if (hidden || (sheetRaised && !expanded)) return null;
  const size = HEIGHTS[phone ? "phone" : "desktop"];
  const available = Boolean(assistant.available);
  const band = `(100% - ${insetRight} - ${HUD_LEFT_PX + HUD_RIGHT_PX}px)`;
  const width = phone ? "calc(100% - 16px)" : `min(760px, calc(${band} - 16px))`;

  return (
    <section aria-label="도우미 대화" data-qa="assistant-dock" data-expanded={expanded ? "true" : "false"}
      onKeyDown={(event) => { if (event.key === "Escape" && expanded) { event.stopPropagation(); open(false); } }}
      className="pointer-events-auto absolute z-30 flex flex-col overflow-hidden rounded-3xl border border-hairline-strong bg-surface-1/95 text-body text-ink backdrop-blur-md transition-[height] duration-300 ease-out motion-reduce:transition-none"
      style={{
        left: phone ? "8px" : `calc(${HUD_LEFT_PX}px + ${band} / 2)`, transform: phone ? undefined : "translateX(-50%)",
        bottom: bottom ?? (phone ? "104px" : "20px"), width,
        height: expanded ? (maximized ? size.max : size.open) : "auto",
        boxShadow: "var(--shadow-dialog)",
      }}>
      {expanded && (
        <header className="flex shrink-0 items-center gap-1 border-b border-hairline px-3 py-1.5">
          <Sparkles aria-hidden="true" className="h-4 w-4 text-primary" />
          <h2 className="mr-auto truncate text-body font-semibold">도우미</h2>
          <Button size="sm" variant="ghost" iconOnly label="이전 대화" aria-expanded={historyOpen} icon={<History className="h-4 w-4" />} onClick={() => setHistoryOpen((value) => !value)} />
          <Button size="sm" variant="ghost" iconOnly label="새 대화" disabled={busy} icon={<SquarePen className="h-4 w-4" />} onClick={() => { assistant.newConversation(); setDraft(""); setHistoryOpen(false); }} />
          {assistant.sid && <Button size="sm" variant="ghost" iconOnly label="대화 삭제" disabled={busy} icon={<Trash2 className="h-4 w-4" />} onClick={() => assistant.remove()} />}
          <Button size="sm" variant="ghost" iconOnly label={maximized ? "작게 보기" : "크게 보기"} icon={maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />} onClick={() => setMaximized((value) => !value)} />
          <Button size="sm" variant="ghost" iconOnly label="대화창 접기" icon={<ChevronDown className="h-4 w-4" />} onClick={() => open(false)} />
        </header>
      )}
      {expanded && historyOpen && <HistoryList assistant={assistant} busy={busy} onClose={() => setHistoryOpen(false)} />}
      {expanded && (
        <div ref={thread} onScroll={(event) => { const node = event.currentTarget; stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]">
          <div className="flex min-h-full flex-col px-4 py-4">
          {assistant.loading && <p role="status" className="text-caption text-ink-muted">대화를 불러오는 중입니다</p>}
          {!hasConversation && !assistant.loading && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <Sparkles aria-hidden="true" className="h-6 w-6 text-primary" />
              <p>캠퍼스 날씨, 건물 상태, 통제 구간을 물어보세요.</p>
            </div>
          )}
          <ol aria-label="대화 내용" className="flex min-w-0 flex-col gap-5">
            {assistant.messages?.map((message, index) => (
              <Message key={index} message={message} last={index === assistant.messages.length - 1} assistant={assistant} />
            ))}
          </ol>
          {assistant.todo?.length > 0 && (
            <ul aria-label="작업 목록" className="mt-4 flex flex-col gap-1 rounded-control bg-surface-2 p-3 text-caption">
              {assistant.todo.map((item, index) => <li key={index}>{item.done ? "완료" : "진행 예정"} · {item.text}</li>)}
            </ul>
          )}
          {assistant.status && !assistant.running && <p role="status" className="mt-3 text-caption text-ink-muted">{assistant.status}</p>}
          {assistant.pendingConfirm && assistant.role === "admin" && (
            <div role="group" aria-label="시뮬레이션 변경 확인" className="mt-4 flex flex-col gap-3 rounded-card border border-primary/40 bg-surface-2 p-4">
              <p className="font-semibold">{assistant.pendingConfirm.summary_ko}</p>
              <p className="text-caption text-ink-muted">{assistant.pendingConfirm.expires_in_s}초 이내에 적용 여부를 선택해 주세요.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" disabled={assistant.confirming} onClick={() => assistant.confirm("approve")}>적용</Button>
                <Button disabled={assistant.confirming} onClick={() => assistant.confirm("reject")}>취소</Button>
              </div>
            </div>
          )}
          {assistant.error && (
            <div className="mt-4 flex flex-col items-start gap-2 rounded-control bg-surface-2 p-3">
              <p role="alert">{assistant.error}</p>
              <Button size="sm" disabled={busy} onClick={assistant.retry}>다시 연결</Button>
            </div>
          )}
          </div>
        </div>
      )}
      {!expanded && !hasConversation && available && assistant.prompts?.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 pt-3 [scrollbar-width:none]">
          {assistant.prompts.map((prompt) => (
            <Button key={prompt.name} size="sm" variant="ghost" disabled={busy} onClick={() => send(prompt.text ?? prompt.title)}
              className="shrink-0 rounded-full border border-hairline">{prompt.title}</Button>
          ))}
        </div>
      )}
      <form onSubmit={(event) => { event.preventDefault(); send(draft); }} className={cx("flex shrink-0 items-end gap-2 p-3", expanded && "border-t border-hairline")}>
        {!expanded && hasConversation && (
          <Button size="sm" variant="ghost" iconOnly label="대화창 펼치기" icon={<ChevronUp className="h-4 w-4" />} onClick={() => open(true)} />
        )}
        {!expanded && !hasConversation && assistant.sessions?.length > 0 && (
          <Button size="sm" variant="ghost" iconOnly label="이전 대화" icon={<History className="h-4 w-4" />} onClick={() => { open(true); setHistoryOpen(true); }} />
        )}
        {!available ? <p role="status" className="min-h-11 flex-1 px-2 py-2.5 text-ink-muted">{ASSISTANT_LOGIN_NOTICE}</p> : <textarea ref={input} aria-label="질문" aria-describedby={noticeId} rows={1} value={draft} maxLength={MAX_CHARS}
          disabled={!available || busy}
          placeholder="캠퍼스에 대해 무엇이든 물어보세요"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(draft); }
          }}
          className={cx("min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-body text-ink caret-primary outline-none placeholder:text-ink-muted disabled:opacity-60", FOCUS_RING, "rounded-control")} />}
        {available && (assistant.running
          ? <Button variant="secondary" iconOnly label="답변 중지" icon={<Square className="h-4 w-4" />} onClick={assistant.stop} className="rounded-full" />
          : <Button type="submit" variant="primary" iconOnly label="전송" disabled={busy || !available || !draft.trim()} icon={<ArrowUp className="h-4 w-4" />} className="rounded-full" />)}
        {expanded && phone && <Button size="sm" variant="ghost" iconOnly label="닫기" icon={<X className="h-4 w-4" />} onClick={() => open(false)} />}
      </form>
      <p id={noticeId} className={cx("px-5 pb-2 text-caption text-ink-muted", !expanded && available && "sr-only")}>
        {NOTICE}{draft.length > MAX_CHARS * 0.8 ? ` · ${draft.length}/${MAX_CHARS}` : ""}
      </p>
    </section>
  );
}

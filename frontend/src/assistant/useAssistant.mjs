import { useEffect, useMemo, useRef, useState } from "react";
import { createAssistantClient } from "./assistantClient.mjs";

const WRITE_TOOLS = new Set(["restriction_create", "restriction_remove", "simulation_control"]);
const emptyTurn = () => ({ tools: [], todo: [], confirm: null, status: "", usage: null });

// Mounted by the dashboard, so a client action can change tabs without cancelling its run.
export function useAssistant({ session, active, context, onAction, onWriteComplete }) {
  const client = useMemo(() => createAssistantClient({ session }), [session]);
  const current = useRef({ client, context, onAction, onWriteComplete });
  current.current = { client, context, onAction, onWriteComplete };
  const run = useRef(null);
  const operation = useRef(null);
  const [sid, setSid] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [prompts, setPrompts] = useState([]);
  const [messages, setMessages] = useState([]);
  const [turn, setTurn] = useState(emptyTurn);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const available = Boolean(session?.token);
  const isCurrent = () => current.current.client === client;
  const report = (failure) => {
    if (failure instanceof Error && failure.name === "AbortError") return;
    if (isCurrent()) setError(failure instanceof Error ? failure.message : "도우미 요청을 처리하지 못했습니다");
  };

  useEffect(() => {
    setSid(null); setSessions([]); setPrompts([]); setMessages([]);
    setTurn(emptyTurn()); setLoaded(false); setRunning(false); setLoading(false); setConfirming(false); setError(null);
    return () => {
      run.current?.controller.abort();
      operation.current?.abort();
      run.current = null;
      operation.current = null;
    };
  }, [client]);

  useEffect(() => {
    if (!available || !active || loaded) return undefined;
    const controller = new AbortController();
    setLoading(true);
    Promise.all([client.list(controller.signal), client.prompts(controller.signal)])
      .then(([history, suggestions]) => {
        if (controller.signal.aborted) return;
        setSessions(history.sessions);
        setPrompts(suggestions.prompts);
      })
      .catch((failure) => { if (!controller.signal.aborted) report(failure); })
      .finally(() => {
        if (!controller.signal.aborted) { setLoading(false); setLoaded(true); }
      });
    return () => controller.abort();
  }, [client, available, active, loaded]);

  useEffect(() => {
    if (!turn.confirm) return undefined;
    const timer = window.setTimeout(() => {
      setTurn((previous) => ({ ...previous, confirm: null, status: "적용 확인 시간이 만료됐습니다" }));
    }, Math.max(0, turn.confirm.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [turn.confirm]);

  async function send(text) {
    const question = text.trim();
    if (!available || run.current || operation.current || loading || !question) return false;
    const controller = new AbortController();
    const task = { controller, sid };
    run.current = task;
    setRunning(true); setError(null); setTurn(emptyTurn());
    setMessages((previous) => [...previous, { role: "user", text: question }, { role: "assistant", text: "" }]);
    try {
      if (!task.sid) {
        const created = await client.create(controller.signal);
        if (controller.signal.aborted || !isCurrent()) return false;
        task.sid = created.session_id;
        setSid(task.sid);
        setSessions((previous) => [{ session_id: task.sid, title: question.slice(0, 60) }, ...previous]);
      }
      const updateAnswer = (update) => setMessages((previous) => previous.map((message, index) => index === previous.length - 1 ? update(message) : message));
      await client.send(task.sid, { text: question, context: current.current.context() }, {
        signal: controller.signal,
        onEvent: ({ event, data }) => {
          if (controller.signal.aborted || !isCurrent()) return;
          switch (event) {
            case "run":
              setTurn((previous) => ({ ...previous, status: "답변을 준비하고 있습니다" }));
              break;
            case "status":
              setTurn((previous) => ({ ...previous, status: data.label_ko }));
              break;
            case "token":
              updateAnswer((message) => ({ ...message, text: message.text + data.text }));
              break;
            case "tool":
              setTurn((previous) => ({ ...previous, tools: [...previous.tools.filter((tool) => tool.call_id !== data.call_id), data] }));
              if (session.account.role === "admin" && data.state === "ok" && WRITE_TOOLS.has(data.name)) current.current.onWriteComplete();
              break;
            case "action":
              current.current.onAction(data);
              break;
            case "confirm":
              if (session.account.role === "admin") setTurn((previous) => ({ ...previous, confirm: { ...data, expiresAt: Date.now() + data.expires_in_s * 1000 } }));
              break;
            case "todo":
              setTurn((previous) => ({ ...previous, todo: data.items }));
              break;
            case "final":
              updateAnswer(() => ({ role: "assistant", text: data.text, flags: data.flags, observed_at: data.observed_at, usage: data.usage }));
              setTurn((previous) => ({ ...previous, usage: data.usage, confirm: null, status: "" }));
              break;
            case "error":
              setError(`${data.message_ko}${data.retry_after_s ? ` (${data.retry_after_s}초 후 다시 시도)` : ""}`);
              break;
            case "end":
              setTurn((previous) => ({ ...previous, confirm: null, status: "" }));
              break;
            default:
              break;
          }
        },
      });
    } catch (failure) {
      report(failure);
    } finally {
      if (run.current === task && !task.stopping) {
        run.current = null;
        setRunning(false);
        setTurn((previous) => ({ ...previous, confirm: null, status: "" }));
      }
    }
    return true;
  }

  async function stop() {
    const task = run.current;
    if (!task || task.stopping) return;
    task.stopping = true;
    task.controller.abort();
    // Closing the response cancels the server run too; the explicit endpoint records the stop.
    try { if (task.sid) await client.cancel(task.sid); } catch (failure) { report(failure); }
    finally {
      if (run.current === task) {
        run.current = null;
        setRunning(false);
        setTurn((previous) => ({ ...previous, confirm: null, status: "" }));
      }
    }
  }

  async function confirm(decision) {
    if (!sid || !turn.confirm || confirming || session.account.role !== "admin") return;
    const proposal = turn.confirm;
    if (Date.now() >= proposal.expiresAt) return;
    setConfirming(true);
    try {
      await client.confirm(sid, { confirm_id: proposal.confirm_id, decision });
      if (isCurrent()) setTurn((previous) => ({ ...previous, confirm: previous.confirm?.confirm_id === proposal.confirm_id ? null : previous.confirm }));
    } catch (failure) { report(failure); }
    finally { if (isCurrent()) setConfirming(false); }
  }

  async function restore(nextSid) {
    if (!available || run.current || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setLoading(true); setError(null);
    try {
      const history = await client.messages(nextSid, controller.signal);
      if (!isCurrent() || controller.signal.aborted) return;
      setSid(nextSid); setMessages(Array.isArray(history) ? history : history.messages); setTurn(emptyTurn());
    } catch (failure) { report(failure); }
    finally {
      if (operation.current === controller) { operation.current = null; setLoading(false); }
    }
  }

  // target: the conversation to delete, the open one when omitted.
  async function remove(target = sid) {
    if (!target || run.current || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setLoading(true); setError(null);
    try {
      await client.remove(target);
      if (!isCurrent()) return;
      setSessions((previous) => previous.filter((item) => item.session_id !== target));
      if (target === sid) { setSid(null); setMessages([]); setTurn(emptyTurn()); }
    } catch (failure) { report(failure); }
    finally {
      if (operation.current === controller) { operation.current = null; setLoading(false); }
    }
  }

  return {
    available, role: session?.account.role, sid, sessions, prompts, messages, ...turn,
    pendingConfirm: turn.confirm, running, loading, confirming, error, send, stop, confirm, restore, remove,
    newConversation() {
      if (run.current || operation.current) return;
      setSid(null); setMessages([]); setTurn(emptyTurn()); setError(null);
    },
    retry() { setError(null); setLoaded(false); },
  };
}

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Copy, Pencil, Plus, Redo2, RotateCcw, Save, Trash2, Undo2, X } from "lucide-react";
import { Euler, MathUtils, Quaternion } from "three";
import { Button } from "../ui/Button.jsx";
import { Segmented } from "../ui/Segmented.jsx";
import { cx } from "../ui/cx.mjs";
import { SCENE_UNITS_PER_METRE } from "../geo/epsg5186.mjs";
import { CATEGORY_LABELS, kindLabel } from "./sceneEditor.mjs";
import { editorRuntime, modelEditStore, saveModelEdits } from "./modelEditsApi.mjs";

const MODE_OPTIONS = [
  { value: "translate", label: "이동 W" },
  { value: "rotate", label: "회전 E" },
  { value: "scale", label: "크기 R" },
];
const MODE_KEYS = { w: "translate", e: "rotate", r: "scale" };
const SURFACE = "pointer-events-auto rounded-card border border-hairline bg-surface-1 text-body text-ink shadow-popover";
const FIELD = "h-8 w-full min-w-0 rounded-control border border-hairline bg-surface-2 px-2 text-right tabular-nums text-ink";

const isTyping = (target) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
const round = (value, digits) => Number(value.toFixed(digits));
const entryTitle = (entry) => {
  const category = CATEGORY_LABELS[entry.category] ?? entry.category;
  const kind = kindLabel(entry.kind);
  return kind === category ? category : `${category} · ${kind}`;
};

// 편집값(부모 기준 위치·쿼터니언·크기)을 입력 칸 값(미터·도)으로 바꾼다.
function toFields(transform) {
  const euler = new Euler().setFromQuaternion(new Quaternion().fromArray(transform.quaternion), "YXZ");
  return {
    position: transform.position.map((v) => round(v / SCENE_UNITS_PER_METRE, 2)),
    rotation: [euler.x, euler.y, euler.z].map((v) => round(MathUtils.radToDeg(v), 1)),
    scale: transform.scale.map((v) => round(v, 3)),
  };
}

function fromFields(fields) {
  const [x, y, z] = fields.rotation.map((v) => MathUtils.degToRad(v));
  return {
    position: fields.position.map((v) => v * SCENE_UNITS_PER_METRE),
    quaternion: new Quaternion().setFromEuler(new Euler(x, y, z, "YXZ")).toArray(),
    scale: fields.scale,
  };
}

function NumberField({ label, value, step, min, onCommit }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const next = Number(text);
    if (text.trim() === "" || !Number.isFinite(next) || (min !== undefined && next < min)) setText(String(value));
    else if (next !== value) onCommit(next);
  };
  return (
    <label className="flex min-w-0 flex-col gap-1 text-caption text-ink-muted">
      {label}
      <input
        className={FIELD}
        inputMode="decimal"
        type="number"
        step={step}
        min={min}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setText(String(value));
        }}
      />
    </label>
  );
}

function TransformFields({ entry, transform }) {
  const fields = toFields(transform);
  const [lockScale, setLockScale] = useState(true);
  const update = (group, index, value) => {
    const next = { ...fields, [group]: [...fields[group]] };
    if (group === "scale" && lockScale) {
      const ratio = value / fields.scale[index];
      next.scale = fields.scale.map((v) => round(v * ratio, 4));
    } else {
      next[group][index] = value;
    }
    editorRuntime.get()?.commit(entry.id, fromFields(next));
  };
  const row = (title, group, labels, step, min) => (
    <fieldset className="grid grid-cols-[3.5rem_1fr_1fr_1fr] items-end gap-2">
      <legend className="sr-only">{title}</legend>
      <span aria-hidden="true" className="pb-2 text-caption text-ink-muted">{title}</span>
      {labels.map((label, index) => (
        <NumberField key={label} label={label} step={step} min={min} value={fields[group][index]}
          onCommit={(value) => update(group, index, value)} />
      ))}
    </fieldset>
  );
  return (
    <div className="flex flex-col gap-2">
      {row("위치 m", "position", ["X 동", "Y 높이", "Z 남"], 0.1)}
      {row("회전 °", "rotation", ["X", "Y 방위", "Z"], 1)}
      {row("크기 배", "scale", ["X", "Y", "Z"], 0.05, 0.01)}
      <label className="flex items-center gap-2 text-caption text-ink-muted">
        <input type="checkbox" checked={lockScale} onChange={(event) => setLockScale(event.target.checked)} />
        크기 비율 유지
      </label>
    </div>
  );
}

function LibraryPicker({ runtime }) {
  const library = runtime?.library() ?? [];
  const [choice, setChoice] = useState("");
  const selectId = useId();
  const value = choice || library[0]?.prototype || "";
  const categories = [...new Set(library.map((item) => item.category))];
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={selectId} className="text-caption text-ink-muted">추가할 종류 (같은 종류의 기존 객체를 복제)</label>
      <div className="flex gap-2">
        <select id={selectId} className={cx(FIELD.replace("text-right", "text-left"), "flex-1")} value={value} onChange={(event) => setChoice(event.target.value)} disabled={!runtime}>
          {categories.map((category) => (
            <optgroup key={category} label={CATEGORY_LABELS[category] ?? category}>
              {library.filter((item) => item.category === category).map((item) => (
                <option key={item.key} value={item.prototype}>{`${kindLabel(item.kind)} (${item.count})`}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <Button size="sm" icon={<Plus aria-hidden="true" className="h-4 w-4" />} disabled={!runtime || !value}
          disabledReason="모델을 불러오는 중입니다" onClick={() => runtime.addAtView(value)}>
          화면 중앙에 추가
        </Button>
      </div>
    </div>
  );
}

// 관리자 화면(AppMain)의 모델 편집 패널. 켜면 장면 클릭으로 객체를 고르고 기즈모·입력 칸으로 옮기고, 지우고, 추가한다.
// 저장하면 날씨 API(/model/edits)에 올라가 학생 화면을 포함한 모든 화면이 같은 모델을 본다.
export function ModelEditorPanel() {
  const state = useSyncExternalStore(modelEditStore.subscribe, modelEditStore.getState);
  const runtime = useSyncExternalStore(editorRuntime.subscribe, editorRuntime.get);
  useSyncExternalStore(editorRuntime.subscribe, editorRuntime.version);
  const [save, setSave] = useState({ busy: false, message: null, error: false });
  const entry = state.selection && runtime ? runtime.describe(state.selection) : null;
  const { draft } = state;
  const changeCount = Object.keys(draft.transforms).length + draft.removed.length + draft.added.length;

  const doSave = async () => {
    setSave({ busy: true, message: null, error: false });
    const result = await saveModelEdits();
    setSave({ busy: false, message: result.ok ? "저장했습니다" : result.message, error: !result.ok });
  };

  useEffect(() => {
    if (!state.dirty) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.dirty]);

  useEffect(() => {
    if (!state.editing) return undefined;
    const onKey = (event) => {
      if (isTyping(event.target)) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const selection = modelEditStore.getState().selection;
      let handled = true;
      if (mod && key === "z") (event.shiftKey ? modelEditStore.redo : modelEditStore.undo)();
      else if (mod && key === "y") modelEditStore.redo();
      else if (mod && key === "s") doSave();
      else if (mod && key === "d" && selection) editorRuntime.get()?.duplicate(selection);
      else if (!mod && MODE_KEYS[key]) modelEditStore.setMode(MODE_KEYS[key]);
      else if (!mod && (key === "delete" || key === "backspace") && selection) modelEditStore.remove(selection);
      else if (key === "escape") modelEditStore.select(null);
      else handled = false;
      if (handled) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.editing]);

  if (!state.editing) {
    return (
      <div className="pointer-events-none absolute left-4 top-[4.25rem] z-hud">
        <Button className="pointer-events-auto shadow-popover" data-qa="model-editor-toggle"
          icon={<Pencil aria-hidden="true" className="h-4 w-4" />} onClick={() => modelEditStore.setEditing(true)}>
          모델 편집{state.dirty ? " · 저장 안 됨" : ""}
        </Button>
      </div>
    );
  }

  return (
    <section aria-label="모델 편집" data-qa="model-editor-panel"
      className={cx(SURFACE, "absolute bottom-[11.5rem] left-4 top-[4.25rem] z-hud flex w-[22rem] flex-col overflow-hidden")}>
      <header className="flex items-start justify-between gap-2 border-b border-hairline px-4 py-3">
        <div>
          <h2 className="text-title font-semibold">모델 편집</h2>
          <p className="text-caption text-ink-muted" role="status">
            {state.dirty ? `저장하지 않은 변경이 있습니다 · 전체 변경 ${changeCount}건` : `저장된 상태 · 변경 ${changeCount}건 (r${draft.revision})`}
          </p>
        </div>
        <Button size="sm" variant="ghost" iconOnly label="편집 닫기" icon={<X aria-hidden="true" className="h-4 w-4" />}
          onClick={() => modelEditStore.setEditing(false)} />
      </header>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
        <Segmented kind="radio" label="기즈모 모드" options={MODE_OPTIONS} value={state.mode} onChange={modelEditStore.setMode} size="sm" />

        {entry ? (
          <div className="flex flex-col gap-3" data-qa="model-editor-selection">
            <div>
              <p className="font-semibold">{entryTitle(entry)}{entry.added ? " (추가함)" : ""}</p>
              <p className="break-all font-mono text-caption text-ink-muted">{entry.id}</p>
            </div>
            <TransformFields key={entry.id} entry={entry} transform={entry.transform} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<Copy aria-hidden="true" className="h-4 w-4" />} onClick={() => runtime.duplicate(entry.id)}>복제</Button>
              {!entry.added && (
                <Button size="sm" icon={<RotateCcw aria-hidden="true" className="h-4 w-4" />}
                  disabled={!(entry.id in draft.transforms)} disabledReason="옮기거나 바꾼 적이 없습니다"
                  onClick={() => modelEditStore.resetTransform(entry.id)}>원래대로</Button>
              )}
              <Button size="sm" icon={<Trash2 aria-hidden="true" className="h-4 w-4" />} onClick={() => modelEditStore.remove(entry.id)}>삭제</Button>
            </div>
          </div>
        ) : (
          <p className="text-ink-muted">장면에서 객체를 클릭해 고르세요. 건물, 시설물(펜스·벤치·안내판 등), 가로등, 신호등, 나무를 한 개씩 고를 수 있습니다.</p>
        )}

        <LibraryPicker runtime={runtime} />

        {draft.removed.length > 0 && (
          <details className="flex flex-col gap-2">
            <summary className="cursor-pointer text-caption text-ink-muted">{`지운 객체 ${draft.removed.length}개`}</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {draft.removed.map((id) => (
                <li key={id} className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-caption">{id}</span>
                  <Button size="sm" variant="ghost" onClick={() => modelEditStore.restore(id)}>복원</Button>
                </li>
              ))}
            </ul>
          </details>
        )}
        {runtime && runtime.missingPrototypes().length > 0 && (
          <p className="text-caption text-danger">{`원형을 찾지 못해 추가하지 못한 객체: ${runtime.missingPrototypes().join(", ")}`}</p>
        )}
        <p className="text-caption text-ink-muted">단축키: W·E·R 모드, Delete 삭제, ⌘D 복제, ⌘Z 되돌리기, ⌘S 저장, Esc 선택 해제</p>
      </div>

      <footer className="flex flex-col gap-2 border-t border-hairline px-4 py-3">
        {save.message && <p role={save.error ? "alert" : "status"} className={cx("text-caption", save.error ? "text-danger" : "text-ink-muted")}>{save.message}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" iconOnly label="되돌리기" icon={<Undo2 aria-hidden="true" className="h-4 w-4" />}
            disabled={!state.canUndo} onClick={modelEditStore.undo} />
          <Button size="sm" variant="ghost" iconOnly label="다시 실행" icon={<Redo2 aria-hidden="true" className="h-4 w-4" />}
            disabled={!state.canRedo} onClick={modelEditStore.redo} />
          <Button size="sm" variant="ghost" disabled={!state.dirty} onClick={modelEditStore.discard}>변경 취소</Button>
          <Button size="sm" variant="primary" className="ml-auto" icon={<Save aria-hidden="true" className="h-4 w-4" />}
            disabled={!state.dirty} disabledReason="저장할 변경이 없습니다" loading={save.busy} onClick={doSave}>저장</Button>
        </div>
      </footer>
    </section>
  );
}

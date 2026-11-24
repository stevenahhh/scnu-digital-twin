// 캠퍼스 모델 편집 상태(관리자 웹 편집기). three.js 없이 편집 문서와 되돌리기 기록만 다룬다.
// 문서 형식은 날씨 API의 /model/edits(weather/api/model_edits.py)와 같다: transforms는 객체 id -> 부모 노드 기준
// 위치·회전(쿼터니언)·크기, removed는 지운 객체 id, added는 원형(prototype) 객체를 복제해 넣은 객체다.

export const EDIT_MODES = Object.freeze(["translate", "rotate", "scale"]);

const isVector = (value, length) =>
  Array.isArray(value) && value.length === length && value.every((v) => typeof v === "number" && Number.isFinite(v));
const isTransform = (value) =>
  isVector(value?.position, 3) && isVector(value?.quaternion, 4) && isVector(value?.scale, 3);
const pickTransform = ({ position, quaternion, scale }) => ({ position: [...position], quaternion: [...quaternion], scale: [...scale] });

// 서버 응답을 편집 초안으로 읽는다. 모양이 틀린 항목은 버리고, 문서가 아니면 빈 초안이다.
export function parseEditDocument(value) {
  const transforms = {};
  for (const [id, transform] of Object.entries(value?.transforms ?? {})) {
    if (isTransform(transform)) transforms[id] = pickTransform(transform);
  }
  return {
    revision: Number.isInteger(value?.revision) && value.revision >= 0 ? value.revision : 0,
    transforms,
    removed: Array.isArray(value?.removed) ? value.removed.filter((id) => typeof id === "string") : [],
    added: Array.isArray(value?.added)
      ? value.added
        .filter((item) => typeof item?.id === "string" && typeof item.prototype === "string" && isTransform(item))
        .map((item) => ({ id: item.id, prototype: item.prototype, ...pickTransform(item) }))
      : [],
  };
}

const defaultNewId = () => `ADD_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// 편집 상태 저장소. draft는 바꿀 때마다 새 객체라서, 되돌리기는 이전 draft를 그대로 쌓아 둔다.
export function createModelEditStore({ newId = defaultNewId } = {}) {
  const listeners = new Set();
  let saved = parseEditDocument(null);
  let past = [];
  let future = [];
  let state = {
    draft: saved, selection: null, mode: "translate", dirty: false, canUndo: false, canRedo: false, editing: false,
  };

  const emit = (next) => {
    state = { ...state, ...next, canUndo: past.length > 0, canRedo: future.length > 0 };
    listeners.forEach((listener) => listener());
  };
  const change = (draft, extra = {}) => {
    past = [...past, state.draft];
    future = [];
    emit({ draft, dirty: true, ...extra });
  };
  const isAdded = (id) => state.draft.added.some((item) => item.id === id);

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load(document) {
      saved = parseEditDocument(document);
      past = [];
      future = [];
      emit({ draft: saved, dirty: false, selection: null });
    },
    markSaved(document) {
      this.load(document);
    },
    discard() {
      past = [];
      future = [];
      emit({ draft: saved, dirty: false, selection: null });
    },
    // 편집 모드를 끄면 선택도 푼다. 저장하지 않은 초안은 장면에 그대로 남는다.
    setEditing(editing) {
      if (state.editing === editing) return;
      emit({ editing, selection: editing ? state.selection : null });
    },
    select(id) {
      if (state.selection === id) return;
      emit({ selection: id });
    },
    setMode(mode) {
      if (!EDIT_MODES.includes(mode) || state.mode === mode) return;
      emit({ mode });
    },
    commitTransform(id, transform) {
      const value = pickTransform(transform);
      const { draft } = state;
      if (isAdded(id)) {
        change({ ...draft, added: draft.added.map((item) => (item.id === id ? { ...item, ...value } : item)) });
      } else {
        change({ ...draft, transforms: { ...draft.transforms, [id]: value } });
      }
    },
    resetTransform(id) {
      const { draft } = state;
      if (!(id in draft.transforms)) return;
      const transforms = { ...draft.transforms };
      delete transforms[id];
      change({ ...draft, transforms });
    },
    remove(id) {
      const { draft } = state;
      const selection = state.selection === id ? null : state.selection;
      if (isAdded(id)) change({ ...draft, added: draft.added.filter((item) => item.id !== id) }, { selection });
      else if (!draft.removed.includes(id)) change({ ...draft, removed: [...draft.removed, id] }, { selection });
    },
    restore(id) {
      const { draft } = state;
      if (draft.removed.includes(id)) change({ ...draft, removed: draft.removed.filter((item) => item !== id) });
    },
    add(prototype, transform) {
      const id = newId();
      const { draft } = state;
      change({ ...draft, added: [...draft.added, { id, prototype, ...pickTransform(transform) }] }, { selection: id });
      return id;
    },
    undo() {
      if (past.length === 0) return;
      future = [state.draft, ...future];
      const draft = past.at(-1);
      past = past.slice(0, -1);
      emit({ draft, dirty: draft !== saved });
    },
    redo() {
      if (future.length === 0) return;
      past = [...past, state.draft];
      const [draft, ...rest] = future;
      future = rest;
      emit({ draft, dirty: draft !== saved });
    },
    toDocument() {
      const { revision, transforms, removed, added } = state.draft;
      return { revision, transforms, removed, added };
    },
  };
}

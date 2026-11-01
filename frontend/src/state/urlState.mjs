// 공유 링크용 화면 상태 <-> 주소 쿼리. 순수 함수만 둔다(useUrlState가 읽고 쓴다).
// b=BLD_C1 f=6 r=601 t=720 d=2026-10-26 m=live|sim cam=px,py,pz,tx,ty,tz(0.1 단위) p=open|rail tab=...
// 다른 쿼리(model=uni, ui=gallery, sheet= 등)는 손대지 않는다. 비밀 값(API 키)은 담지 않는다.

export const VIEW_PARAM_KEYS = Object.freeze(["b", "f", "r", "t", "d", "m", "cam", "p", "tab"]);
export const VIEW_TABS = Object.freeze(["dashboard", "parking_safety", "energy", "environment"]);
const MODES = Object.freeze({ live: "live", sim: "simulation" });
const PANEL = Object.freeze({ open: true, rail: false });
const MAX_FLOOR = 30;

const isoDate = (text) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? text : null;
};

const round1 = (value) => Math.round(value * 10) / 10;

// 주소 쿼리 -> 화면 상태. 올바른 값만 돌려준다(모르는 건물 id, 범위 밖 시각, 숫자가 아닌 카메라 값은 빠진다).
// knownIds: 고를 수 있는 요소 id(Set 또는 배열). 주지 않으면 BLD_ 형식만 본다.
export function decodeViewState(search, { knownIds = null } = {}) {
  const params = new URLSearchParams(search ?? "");
  const known = knownIds ? new Set(knownIds) : null;
  const state = {};
  const building = params.get("b");
  if (building && /^BLD_[A-Z0-9_]+$/.test(building) && (!known || known.has(building))) state.building = building;
  const floor = params.get("f");
  if (state.building && floor !== null && /^\d{1,2}$/.test(floor) && Number(floor) <= MAX_FLOOR) state.floor = Number(floor);
  const room = params.get("r");
  if (state.floor !== undefined && room !== null && /^\d{1,4}$/.test(room)) state.room = room;
  const minute = params.get("t");
  if (minute !== null && /^\d{1,4}$/.test(minute) && Number(minute) <= 1439) state.minute = Number(minute);
  const date = params.get("d");
  if (date && isoDate(date)) state.date = date;
  const mode = params.get("m");
  if (mode && Object.hasOwn(MODES, mode)) state.mode = MODES[mode];
  const camera = params.get("cam");
  if (camera) {
    const parts = camera.split(",");
    const values = parts.map(Number);
    if (parts.length === 6 && parts.every((part) => part.trim() !== "") && values.every(Number.isFinite)) {
      state.camera = { position: values.slice(0, 3), target: values.slice(3) };
    }
  }
  const panel = params.get("p");
  if (panel && Object.hasOwn(PANEL, panel)) state.panelOpen = PANEL[panel];
  const tab = params.get("tab");
  if (tab && VIEW_TABS.includes(tab)) state.tab = tab;
  return state;
}

// 화면 상태 -> 주소 쿼리 문자열("?..." 또는 ""). base의 다른 쿼리는 그대로 두고, 이 모듈의 키만 새로 쓴다.
export function encodeViewState(state, base = "") {
  const params = new URLSearchParams(base ?? "");
  for (const key of VIEW_PARAM_KEYS) params.delete(key);
  if (state.building) params.set("b", state.building);
  if (state.building && Number.isInteger(state.floor)) params.set("f", String(state.floor));
  if (state.building && Number.isInteger(state.floor) && state.room) params.set("r", String(state.room));
  if (Number.isInteger(state.minute)) params.set("t", String(state.minute));
  if (state.date) params.set("d", state.date);
  const mode = Object.keys(MODES).find((key) => MODES[key] === state.mode);
  if (mode) params.set("m", mode);
  if (state.camera) params.set("cam", [...state.camera.position, ...state.camera.target].map(round1).join(","));
  if (typeof state.panelOpen === "boolean") params.set("p", state.panelOpen ? "open" : "rail");
  if (state.tab) params.set("tab", state.tab);
  const text = params.toString();
  return text ? `?${text}` : "";
}

// 들어온 주소에서 잘못된 화면 키를 지운 쿼리(다른 쿼리는 그대로).
export function normalizeSearch(search, options) {
  return encodeViewState(decodeViewState(search, options), search);
}

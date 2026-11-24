import { authorizedFetch } from "../auth/session.mjs";
import { WEATHER_API_URL } from "../simulation/utils/apiConfig.js";
import { createModelEditStore } from "./modelEditStore.mjs";

const PATH = "/model/edits";

// 화면(학생·관리자)마다 하나뿐인 편집 상태. 3D 장면(ModelEditorScene)과 관리자 패널(ModelEditorPanel)이 함께 본다.
export const modelEditStore = createModelEditStore();

// 캔버스 안의 편집기(ModelEditorScene)가 패널에 내주는 동작: 추가 목록, 화면 중앙에 놓기, 복제. 모델이 뜨기 전에는 null이다.
// version은 장면에 초안을 입힐 때마다 오른다(추가한 객체가 장면에 생긴 뒤 패널이 다시 그려지게).
let runtime = null;
let version = 0;
const runtimeListeners = new Set();
const notify = () => {
  version += 1;
  runtimeListeners.forEach((listener) => listener());
};
export const editorRuntime = {
  get: () => runtime,
  version: () => version,
  set(next) {
    runtime = next;
    notify();
  },
  applied: notify,
  subscribe(listener) {
    runtimeListeners.add(listener);
    return () => runtimeListeners.delete(listener);
  },
};

let loading = null;

// 저장된 편집 내용을 한 번 읽어 온다(누구나 읽을 수 있다). 서버에 닿지 못하면 원래 모델을 그대로 보여 준다.
export function ensureModelEditsLoaded() {
  loading ??= fetch(`${WEATHER_API_URL}${PATH}`, { headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : null))
    .catch((error) => {
      if (!(error instanceof TypeError)) throw error;
      return null;
    })
    .then((document) => {
      if (document) modelEditStore.load(document);
      return document !== null;
    });
  return loading;
}

// 관리자 토큰으로 초안을 저장한다. 실패하면 { ok: false, message }이고 초안은 그대로 남는다.
export async function saveModelEdits() {
  let response;
  try {
    response = await authorizedFetch(`${WEATHER_API_URL}${PATH}`, {
      method: "PUT",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(modelEditStore.toDocument()),
    });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return { ok: false, message: "서버에 연결할 수 없어 저장하지 못했습니다" };
  }
  const body = await response.json().catch(() => null);
  if (response.ok && body) {
    modelEditStore.markSaved(body);
    return { ok: true };
  }
  const detail = body?.detail;
  const message = typeof detail === "string" ? detail : detail?.message;
  return { ok: false, message: message ?? `저장하지 못했습니다 (HTTP ${response.status})` };
}

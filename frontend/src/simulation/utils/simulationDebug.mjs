// 개발자 도구(네트워크 범위, 타임라인, 경로 편집기)는 주소에 ?debug=1(또는 true)이 있거나
// VITE_SIMULATION_DEBUG=true로 빌드했을 때만 보인다. 개발 서버라는 이유만으로는 열리지 않는다.
const ON = new Set(["1", "true"]);

export function simulationDebugEnabled({
  search = globalThis.location?.search ?? "",
  env = import.meta.env?.VITE_SIMULATION_DEBUG,
} = {}) {
  if (ON.has(String(env ?? "").toLowerCase())) return true;
  return ON.has(String(new URLSearchParams(search).get("debug") ?? "").toLowerCase());
}

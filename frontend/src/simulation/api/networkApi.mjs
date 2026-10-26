import { getJson } from "./simulationHttp.mjs";

// 교통망 GeoJSON과 그 검증 결과(디버그 층, 경로 편집기).
export const fetchNetwork = (options) => getJson("/api/simulation/network", options);
export const fetchNetworkQuality = (options) => getJson("/api/simulation/network/quality", options);
export const fetchAgentDetails = (agentId, options) => getJson(`/api/simulation/agents/${encodeURIComponent(agentId)}`, options);

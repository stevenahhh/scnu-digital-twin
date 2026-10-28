// Fixture backends for the visual QA harness, mounted inside the harness-owned Vite server
// (scripts/qa/vite.qa.config.mjs) so a run listens on exactly one port.
//   /__qa/api/*      weather + energy service   (VITE_API_URL)
//   /__qa/vision/*   traffic service            (VITE_VISION_API_URL)
//   /__qa/ws/simulation  WebSocket stub         (VITE_SIMULATION_WS_URL)
//   POST /__qa/control   { mode: "down"|"up", fail: [route], missing: [route], delayMs }
//   `missing` routes answer a real 404 in either mode (the backend has no such element), e.g. an empty popup.
// "down" (the default) drops every request on the floor, which the app sees as a network
// failure, the same class of error as the refused connections in the audit capture run.
import { createHash } from "node:crypto";

export const FIXTURE_PREFIX = "/__qa";

const POPUP_BASE = {
  zone_id: "zone_D",
  element_type: "building",
  timestamp: "20261025T1900",
  data_note: {
    assumption_level: "estimated",
    material_source: "estimated_surface_library_v1",
    message: "현재 재질/복사 정보는 추정 기반 시뮬레이션 값이며, 추후 실측/정밀 모델로 교체될 수 있습니다.",
  },
  thermal: {
    local_temp: 17.4, feels_like: 16.2, utci: 15.8, wbgt: 13.1,
    risk_level: "낮음", stress_category: "열 스트레스 없음", risk_color: "#4CAF50", risk_score: 0,
  },
  factors: {
    shade: { level: "보통", value: 0.42 },
    vegetation: { level: "낮음", value: 0.12 },
    wind: { level: "보통", value: 0.51 },
    radiation: { level: "낮음", value: 0.08 },
    material_heat: { level: "보통", value: 0.47 },
  },
  material: {
    surface_type: "concrete", albedo: 0.22, surface_emissivity: 0.91, thermal_conductivity: 1.35,
    volumetric_heat_capacity: 2050000, moisture_availability: 0.04,
  },
  delta: { temp: 0.6, utci: 0.4, label: "기준 기온 대비 +0.6°C" },
  reasons: ["기온 17.4°C, 쾌적한 기온 (추정)", "복사열 낮음, 일몰 이후 (추정)"],
  base_weather: { temperature: 16.8, humidity: 62.0, wind_speed: 1.8 },
};

function freshness() {
  return {
    weather: {
      source: "live",
      observed_at: "2026-10-25T19:00:00+09:00",
      fetched_at: "2026-10-25T19:02:10+09:00",
      age_seconds: 40,
      stale: false,
    },
    forecast: null,
    air_quality: null,
  };
}

export function environmentPayload() {
  const weather_timeline = Array.from({ length: 6 }, (_, index) => ({
    time: `2026-10-25T${String((19 + index) % 24).padStart(2, "0")}:00:00+09:00`,
    temperature: Math.round((16.8 - index * 0.6) * 10) / 10,
    humidity: 62 + index,
    wind_speed: 1.8,
    sky_status: "맑음",
  }));
  return {
    base_weather: { temperature: 16.8, humidity: 62.0, wind_speed: 1.8, precipitation: 0, sky_status: "맑음" },
    summary: { sky_status: "맑음", air_quality_status: "좋음" },
    weather_timeline,
    freshness: freshness(),
  };
}

export function popupPayload(elementId) {
  return { ...POPUP_BASE, element_id: elementId, name: elementId, freshness: freshness() };
}

export const TRAFFIC_PAYLOAD = Object.freeze({
  is_running: true,
  vehicle_count: 12,
  pedestrian_count: 31,
  in_count: 7,
  out_count: 5,
  timestamp: "2026-10-25T19:00:00+09:00",
});

const RANKINGS = {
  date: "2026-05-18",
  weather_preset: "clear",
  assumptions: {
    annualization_days: 365, weights: { annualized_yield: 0.3 }, demand_quality: "predicted",
    weather_source: "scenario", comparability: "same date and deterministic weather preset only",
  },
  rankings: [
    {
      scenario_id: "D4-s", building_id: "D4", building_name: "D4 / 공대 3호관", building_status: "simulated",
      status: "ranked", rank: 1, score: 0.71, total_generation_energy_kwh: 40, capacity_kwp: 7.056,
      exclusion_reason: null,
      component_scores: { annualized_yield: 0.8, roof_utilization: 0.3, self_sufficiency: 0.2, grid_reduction: 0.2, constraints: 1 },
      metrics: { annualized_kwh_per_kwp: 2070, roof_utilization_ratio: 0.022, self_sufficiency_ratio: 0.04, grid_reduction_ratio: 0.04, constraint_violation_count: 0 },
    },
    {
      scenario_id: null, building_id: "C1", building_name: "C1 / 도서관", building_status: "incomplete",
      status: "excluded", rank: null, score: null, total_generation_energy_kwh: null, capacity_kwp: null,
      exclusion_reason: "missing_roof_metadata", component_scores: null, metrics: null,
    },
  ],
};

function installationPlan(buildingId) {
  const id = `${buildingId}-plan-1`;
  return {
    id, building_id: buildingId, name: "남향 기준안",
    created_at: "2026-08-04T10:00:00+09:00", updated_at: "2026-08-04T10:00:00+09:00",
    arrays: [{
      id: "array-1", installation_plan_id: id, roof_id: `${buildingId}-roof-west`, roof_zone_id: `${buildingId}-roof-west-main`,
      module_id: "module-default-441wp", origin_x_m: 10, origin_y_m: 12, rows: 2, columns: 8,
      azimuth_deg: 180, tilt_deg: 25, orientation: "portrait", module_width_m: 1.05, module_length_m: 2.1,
      module_efficiency_percent: 20, module_nominal_power_wp: 441, inter_panel_gap_m: 0.02,
    }],
  };
}

// Roof geometry for the editor; ids match installationPlan() so the plan opens in the roof editor.
function buildingRoofs(buildingId) {
  return {
    id: buildingId,
    roofs: [{
      id: `${buildingId}-roof-west`,
      zones: [{
        id: `${buildingId}-roof-west-main`,
        polygon_meters: [{ x_meters: 0, y_meters: 0 }, { x_meters: 40, y_meters: 0 }, { x_meters: 40, y_meters: 30 }, { x_meters: 0, y_meters: 30 }],
      }],
      obstacles: [],
    }],
  };
}

// Returns [status, body] for a service path (prefix already stripped), or null for "no fixture".
export function resolveFixture(service, path) {
  const [pathname] = path.split("?");
  if (service === "vision") return pathname === "/api/traffic" ? [200, TRAFFIC_PAYLOAD] : null;
  if (pathname === "/environment/full") return [200, environmentPayload()];
  let match = pathname.match(/^\/microclimate\/elements\/([^/]+)\/popup$/);
  if (match) return [200, popupPayload(decodeURIComponent(match[1]))];
  if (pathname === "/energy/rankings") return [200, RANKINGS];
  match = pathname.match(/^\/energy\/buildings\/([^/]+)\/installation-plans$/);
  if (match) {
    const plan = installationPlan(decodeURIComponent(match[1]));
    return [200, [{ id: plan.id, building_id: plan.building_id, name: plan.name, array_count: 1, updated_at: plan.updated_at, is_representative: true }]];
  }
  match = pathname.match(/^\/energy\/buildings\/([^/]+)\/representative-plan$/);
  if (match) {
    const buildingId = decodeURIComponent(match[1]);
    return [200, { building_id: buildingId, installation_plan_id: `${buildingId}-plan-1`, selected_at: "2026-08-04T10:00:00+09:00" }];
  }
  match = pathname.match(/^\/energy\/installation-plans\/([^/]+)-plan-1$/);
  if (match) return [200, installationPlan(decodeURIComponent(match[1]))];
  match = pathname.match(/^\/energy\/buildings\/([^/]+)$/);
  if (match) return [200, buildingRoofs(decodeURIComponent(match[1]))];
  return null;
}

export function createFixtureState() {
  return { mode: "down", fail: [], missing: [], delayMs: 0, requests: [], inFlight: new Map(), nextId: 0 };
}

function routeMatches(route, path) {
  return path === route || path.startsWith(`${route}?`) || path.startsWith(`${route}/`);
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("access-control-allow-origin", "*");
  res.end(JSON.stringify(body));
}

// Connect-style middleware. Returns true when the request was handled.
export function handleFixtureRequest(state, req, res) {
  const url = req.url ?? "";
  if (!url.startsWith(`${FIXTURE_PREFIX}/`)) return false;
  if (url === `${FIXTURE_PREFIX}/control`) {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (req.method === "POST") {
        const next = JSON.parse(raw || "{}");
        state.mode = next.mode === "up" ? "up" : "down";
        state.fail = Array.isArray(next.fail) ? next.fail : [];
        state.missing = Array.isArray(next.missing) ? next.missing : [];
        state.delayMs = Number(next.delayMs) || 0;
        state.requests = [];
      }
      sendJson(res, 200, { mode: state.mode, fail: state.fail, missing: state.missing, delayMs: state.delayMs, requests: state.requests, inFlightSince: [...state.inFlight.values()] });
    });
    return true;
  }
  const match = url.match(/^\/__qa\/(api|vision)(\/.*)$/);
  if (!match) return false;
  const [, service, path] = match;
  state.requests.push({ service, path, at: Date.now() });
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "*");
    res.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE");
    res.end();
    return true;
  }
  if (state.missing.some((route) => routeMatches(route, path))) {
    sendJson(res, 404, { detail: { code: "not_found", message_ko: "해당 요소의 데이터가 없습니다" } });
    return true;
  }
  if (state.mode === "down") {
    req.socket.destroy();
    return true;
  }
  const respond = () => {
    if (state.fail.some((route) => routeMatches(route, path))) {
      sendJson(res, 503, { detail: { code: "weather_upstream_unavailable", message_ko: "기상청 응답 지연으로 최신 기상 데이터를 가져오지 못했습니다" } });
      return;
    }
    const fixture = resolveFixture(service, path);
    if (fixture) sendJson(res, fixture[0], fixture[1]);
    else sendJson(res, 404, { detail: { code: "not_found", message_ko: "픽스처가 없는 경로입니다" } });
  };
  if (state.delayMs > 0) {
    // Delayed answers are tracked until sent, so a capture can wait for the ones a state's steps started.
    const id = state.nextId++;
    state.inFlight.set(id, Date.now());
    setTimeout(() => { state.inFlight.delete(id); respond(); }, state.delayMs);
  } else respond();
  return true;
}

function wsTextFrame(text) {
  const payload = Buffer.from(text);
  const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}

// Upgrade handler for the simulation WebSocket stub: accept, send one idle frame, keep open.
export function handleFixtureUpgrade(state, req, socket) {
  if (!(req.url ?? "").startsWith(`${FIXTURE_PREFIX}/ws/simulation`)) return false;
  if (state.mode === "down") {
    socket.destroy();
    return true;
  }
  const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`, "", ""].join("\r\n"));
  socket.write(wsTextFrame(JSON.stringify({ status: "idle" })));
  // Answer a client close frame (opcode 0x8) so the close handshake completes.
  socket.on("data", (chunk) => {
    if ((chunk[0] & 0x0f) === 0x8) socket.end(Buffer.from([0x88, 0x00]));
  });
  socket.on("error", () => socket.destroy());
  return true;
}

export function qaFixturesPlugin() {
  const state = createFixtureState();
  return {
    name: "qa-fixtures",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!handleFixtureRequest(state, req, res)) next();
      });
      server.httpServer?.on("upgrade", (req, socket) => {
        handleFixtureUpgrade(state, req, socket);
      });
    },
  };
}

export async function setFixtures(baseUrl, { mode = "down", fail = [], missing = [], delayMs = 0 } = {}) {
  const response = await fetch(`${baseUrl}${FIXTURE_PREFIX}/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode, fail, missing, delayMs }),
  });
  return response.json();
}

// Waits (bounded) until every delayed fixture answer started at or before `since` has been sent. Later requests
// (polling) are not waited for. Returns { settled, ms }.
export async function waitFixturesAnswered(baseUrl, since, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const response = await fetch(`${baseUrl}${FIXTURE_PREFIX}/control`);
    const pending = ((await response.json()).inFlightSince ?? []).filter((at) => at <= since);
    if (pending.length === 0) return { settled: true, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeoutMs) return { settled: false, ms: Date.now() - t0 };
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

export async function readFixtureRequests(baseUrl) {
  const response = await fetch(`${baseUrl}${FIXTURE_PREFIX}/control`);
  return (await response.json()).requests;
}

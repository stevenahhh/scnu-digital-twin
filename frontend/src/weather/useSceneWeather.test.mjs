import assert from "node:assert/strict";
import test from "node:test";
import {
  NEUTRAL_SCENE_WEATHER,
  OPEN_METEO_URL,
  SCENE_WEATHER_DEFAULT_TEXT,
  describeSceneWeather,
  fetchOpenMeteo,
  mapSceneWeather,
  parseOpenMeteoCurrent,
  sceneWeatherFromProject,
} from "./useSceneWeather.mjs";

const openMeteoBody = {
  current: { time: "2026-10-24T15:00", cloud_cover: 75, precipitation: 0, weather_code: 3, visibility: 24140, is_day: 1 },
};

test("the Open-Meteo request is keyless and asks for the fields the sky needs", () => {
  const url = new URL(OPEN_METEO_URL);
  assert.equal(url.origin, "https://api.open-meteo.com");
  assert.equal(url.searchParams.get("latitude"), "34.9700");
  assert.equal(url.searchParams.get("longitude"), "127.4764");
  assert.deepEqual(url.searchParams.get("current").split(","), ["cloud_cover", "precipitation", "weather_code", "visibility", "is_day"]);
  assert.equal(url.searchParams.has("apikey"), false);
});

test("the project feed is used when base_weather carries the PTY-derived cloud cover", () => {
  const observation = sceneWeatherFromProject({ base_weather: { temperature: 20, cloud_cover: 0.9, precipitation_type: 1 } });
  assert.deepEqual(observation, { source: "project", cloudCover: 0.9, precipitation: 1.5, snow: false, visibility: null, isDay: null });
  assert.equal(sceneWeatherFromProject({ base_weather: { cloud_cover: 0.2, precipitation_type: 3 } }).snow, true);
  assert.equal(sceneWeatherFromProject({ base_weather: { temperature: 20 } }), null);
  assert.equal(sceneWeatherFromProject({ base_weather: null }), null);
  assert.equal(sceneWeatherFromProject(null), null);
});

test("Open-Meteo current conditions parse into the same observation shape", () => {
  assert.deepEqual(parseOpenMeteoCurrent(openMeteoBody), {
    source: "open-meteo",
    cloudCover: 0.75,
    precipitation: 0,
    snow: false,
    visibility: 24140,
    isDay: true,
  });
  assert.equal(parseOpenMeteoCurrent({ current: { cloud_cover: 100, weather_code: 73 } }).snow, true);
  assert.equal(parseOpenMeteoCurrent({ base_weather: null }), null);
  assert.equal(parseOpenMeteoCurrent(null), null);
});

test("scene mapping: clear sky leaves the lighting rig untouched", () => {
  assert.deepEqual(mapSceneWeather(null), NEUTRAL_SCENE_WEATHER);
  const clear = mapSceneWeather({ cloudCover: 0, precipitation: 0, visibility: 24140 });
  assert.deepEqual(clear, { sunIntensityScale: 1, fogDensityScale: 1, turbidityDelta: 0, ambientScale: 1 });
});

test("scene mapping: cloud cover dims the sun and raises turbidity, rain dims ambient, low visibility thickens fog", () => {
  const overcast = mapSceneWeather({ cloudCover: 1, precipitation: 0, visibility: null });
  assert.ok(Math.abs(overcast.sunIntensityScale - 0.4) < 1e-9);
  assert.equal(overcast.turbidityDelta, 6);
  assert.equal(overcast.fogDensityScale, 1);

  const rain = mapSceneWeather({ cloudCover: 0.5, precipitation: 4, visibility: null });
  assert.ok(Math.abs(rain.ambientScale - 0.7) < 1e-9);
  assert.ok(rain.fogDensityScale > 1, "rain without a visibility reading assumes reduced visibility");

  const fog = mapSceneWeather({ cloudCover: 0.5, precipitation: 0, visibility: 500 });
  assert.ok(Math.abs(fog.fogDensityScale - 1200 / (500 * 0.6242171526)) < 1e-9);
  const denseFog = mapSceneWeather({ cloudCover: 0.5, precipitation: 0, visibility: 50 });
  assert.equal(denseFog.fogDensityScale, 4, "fog far distance is clamped at 300 units");
});

test("sky descriptions are labelled as estimates and never as observations", () => {
  const fallback = describeSceneWeather(parseOpenMeteoCurrent(openMeteoBody));
  assert.equal(fallback.sky, "흐림");
  assert.equal(fallback.estimated, true);
  assert.match(fallback.text, /추정/);
  assert.match(fallback.text, /Open-Meteo/);
  assert.match(fallback.text, /2\.5 km/);
  assert.doesNotMatch(fallback.text, /관측|observed/);

  const project = describeSceneWeather({ source: "project", cloudCover: 0.1, precipitation: 0, snow: false });
  assert.equal(project.sky, "맑음");
  assert.match(project.text, /추정/);
  assert.doesNotMatch(project.text, /관측/);

  assert.equal(describeSceneWeather({ source: "project", cloudCover: 0.3, precipitation: 0 }).sky, "구름 조금");
  assert.equal(describeSceneWeather({ source: "project", cloudCover: 0.6, precipitation: 0 }).sky, "구름 많음");
  assert.equal(describeSceneWeather({ source: "project", cloudCover: 1, precipitation: 1.5, snow: false }).sky, "비");
  assert.equal(describeSceneWeather({ source: "project", cloudCover: 1, precipitation: 1.5, snow: true }).sky, "눈");
  assert.deepEqual(describeSceneWeather(null), { sky: null, source: null, estimated: false, text: SCENE_WEATHER_DEFAULT_TEXT });
});

test("fetchOpenMeteo returns the parsed observation and null on any failure", async () => {
  const calls = [];
  const okFetch = async (url, init) => {
    calls.push({ url, aborted: init.signal.aborted });
    return { ok: true, json: async () => openMeteoBody };
  };
  const observation = await fetchOpenMeteo(okFetch);
  assert.equal(observation.cloudCover, 0.75);
  assert.equal(calls[0].url, OPEN_METEO_URL);
  assert.equal(calls[0].aborted, false);

  assert.equal(await fetchOpenMeteo(async () => ({ ok: false, status: 500, json: async () => ({}) })), null);
  assert.equal(await fetchOpenMeteo(async () => { throw new TypeError("Failed to fetch"); }), null);
  assert.equal(await fetchOpenMeteo(async () => ({ ok: true, json: async () => ({ unexpected: true }) })), null);
});

test("fetchOpenMeteo aborts the request when the caller's signal aborts", async () => {
  const controller = new AbortController();
  let seenSignal = null;
  const pendingFetch = (url, init) => new Promise((_, reject) => {
    seenSignal = init.signal;
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
  const result = fetchOpenMeteo(pendingFetch, { signal: controller.signal });
  controller.abort();
  assert.equal(await result, null);
  assert.equal(seenSignal.aborted, true);
});

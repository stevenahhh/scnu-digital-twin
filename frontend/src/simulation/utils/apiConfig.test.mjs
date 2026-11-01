import test from "node:test";
import assert from "node:assert/strict";
import { resolveServiceEndpoints } from "./apiConfig.js";

test("VITE_API_URL takes precedence over VITE_WEATHER_API_URL", () => {
  assert.deepEqual(
    resolveServiceEndpoints({
      VITE_API_URL: "https://api.example.com/",
      VITE_WEATHER_API_URL: "https://weather.example.com",
    }),
    {
      WEATHER_API_URL: "https://api.example.com",
      VISION_API_URL: "http://127.0.0.1:8001",
      SIMULATION_API_URL: "http://127.0.0.1:8002",
      SIMULATION_WS_URL: "ws://127.0.0.1:8002/ws/simulation",
    }
  );
});

test("VITE_WEATHER_API_URL remains supported without VITE_API_URL", () => {
  assert.equal(
    resolveServiceEndpoints({ VITE_WEATHER_API_URL: "https://weather.example.com/" })
      .WEATHER_API_URL,
    "https://weather.example.com"
  );
});

test("uses service defaults when environment values are absent", () => {
  assert.deepEqual(resolveServiceEndpoints(), {
    WEATHER_API_URL: "http://127.0.0.1:8000",
    VISION_API_URL: "http://127.0.0.1:8001",
    SIMULATION_API_URL: "http://127.0.0.1:8002",
    SIMULATION_WS_URL: "ws://127.0.0.1:8002/ws/simulation",
  });
});

test("trims trailing slashes from configured service URLs", () => {
  assert.deepEqual(
    resolveServiceEndpoints({
      VITE_API_URL: "https://api.example.com///",
      VITE_VISION_API_URL: "https://vision.example.com/",
      VITE_SIMULATION_API_URL: "https://simulation.example.com///",
      VITE_SIMULATION_WS_URL: "wss://simulation.example.com/ws/simulation///",
    }),
    {
      WEATHER_API_URL: "https://api.example.com",
      VISION_API_URL: "https://vision.example.com",
      SIMULATION_API_URL: "https://simulation.example.com",
      SIMULATION_WS_URL: "wss://simulation.example.com/ws/simulation",
    }
  );
});

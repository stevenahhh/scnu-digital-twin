// Shared settings for the campus-model source fetchers. VITE_VWORLD_API_KEY is read from the
// environment or frontend/.env only; it is never written anywhere.
import path from "node:path";
import { fileURLToPath } from "node:url";

const GEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND = path.resolve(GEN, "../..");
export const DATA = path.join(GEN, "data");
export const CACHE = path.join(GEN, ".cache");
export const BBOX = { west: 127.4715, south: 34.964, east: 127.488, north: 34.9765 };
export const USER_AGENT = "scnu-digital-twin campus-model generator";
export const TIMEOUT_MS = 30000;

export async function vworldKey() {
  if (process.env.VITE_VWORLD_API_KEY) return process.env.VITE_VWORLD_API_KEY;
  const envFile = Bun.file(path.join(FRONTEND, ".env"));
  if (await envFile.exists()) {
    const match = (await envFile.text()).match(/^VITE_VWORLD_API_KEY\s*=\s*"?([^"\s]+)/m);
    if (match) return match[1];
  }
  throw new Error("VITE_VWORLD_API_KEY is not set (environment or frontend/.env)");
}

export async function fetchJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`VWorld HTTP ${response.status}`);
  return response.json();
}

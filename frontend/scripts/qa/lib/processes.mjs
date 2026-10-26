// Child-process ownership for the harness: one Vite dev server per run, killed as a process group.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FRONTEND_DIR = fileURLToPath(new URL("../../../", import.meta.url));
const VITE_BIN = path.join(FRONTEND_DIR, "node_modules", "vite", "bin", "vite.js");
const QA_CONFIG = fileURLToPath(new URL("../vite.qa.config.mjs", import.meta.url));

const owned = new Set();

export function serviceEnv(baseUrl) {
  const wsBase = baseUrl.replace(/^http/, "ws");
  return {
    VITE_API_URL: `${baseUrl}/__qa/api`,
    VITE_VISION_API_URL: `${baseUrl}/__qa/vision`,
    VITE_SIMULATION_API_URL: `${baseUrl}/__qa/simulation`,
    VITE_SIMULATION_WS_URL: `${wsBase}/__qa/ws/simulation`,
  };
}

function killGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The group is already gone.
  }
}

export function killAll() {
  for (const child of owned) killGroup(child, "SIGKILL");
  owned.clear();
}

let hooksInstalled = false;
function installExitHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  process.on("exit", killAll);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      killAll();
      process.exit(130);
    });
  }
}

async function waitForHttp(url, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`vite exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.status === 200) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`vite did not answer 200 on ${url} within ${timeoutMs} ms`);
}

// Starts Vite on host:port with the fixture plugin and the service URLs pointed at it.
export async function startVite({ port, host = "127.0.0.1", extraEnv = {}, log = () => {} }) {
  installExitHooks();
  const baseUrl = `http://${host}:${port}`;
  const child = spawn("node",
    [VITE_BIN, "--config", QA_CONFIG, "--host", host, "--port", String(port), "--strictPort"], {
      cwd: FRONTEND_DIR,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...serviceEnv(baseUrl), ...extraEnv, BROWSER: "none" },
    });
  owned.add(child);
  child.stdout.on("data", (chunk) => log(String(chunk)));
  child.stderr.on("data", (chunk) => log(String(chunk)));
  await waitForHttp(`${baseUrl}/`, child, 60000);
  return {
    baseUrl,
    async stop() {
      killGroup(child, "SIGTERM");
      await new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode) return resolve();
        const timer = setTimeout(() => { killGroup(child, "SIGKILL"); resolve(); }, 3000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
      owned.delete(child);
    },
  };
}

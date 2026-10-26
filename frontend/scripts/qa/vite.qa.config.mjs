// Vite config used only by the visual QA harness: the product config plus the fixture backends.
import baseConfig from "../../vite.config.js";
import { qaFixturesPlugin } from "./lib/fixtures.mjs";

export default (env) => {
  const base = typeof baseConfig === "function" ? baseConfig(env) : baseConfig;
  return {
    ...base,
    plugins: [...(base.plugins ?? []), qaFixturesPlugin()],
    // No watcher and no HMR: editing the worktree during a run must not restart Vite or reload the page.
    server: { ...(base.server ?? {}), watch: null, hmr: false },
    // Crawl every source module up front so a cold dependency cache cannot trigger a full page
    // reload in the middle of a scenario chain.
    optimizeDeps: { ...(base.optimizeDeps ?? {}), entries: ["index.html", "index-vworld.html", "src/**/*.{jsx,mjs}", "!src/**/*.test.*"] },
  };
};

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("energy API clients", () => {
  it("use the weather origin from apiConfig, honouring the deprecated alias and trimming slashes", async () => {
    vi.stubEnv("VITE_API_URL", "");
    vi.stubEnv("VITE_WEATHER_API_URL", "http://alias.test/");
    vi.resetModules();
    const [{ createBuildingAnalysisClient }, { createEnergyDashboardClient }, { createInstallationPlanClient }, { createCampusComparisonClient }] = await Promise.all([
      import("./analysis/analysisApi.mjs"),
      import("./dashboard/energyDashboardApi.mjs"),
      import("./installations/installationPlanApi.mjs"),
      import("./campus/CampusComparisonPanel.jsx"),
    ]);
    const urls = [];
    const recordingFetch = async (url) => {
      urls.push(String(url));
      throw new Error("request recorded");
    };

    await Promise.allSettled([
      createBuildingAnalysisClient(undefined, recordingFetch).listScenarios("D4"),
      createEnergyDashboardClient(undefined, recordingFetch).load({ buildingId: "D4", date: "2026-05-18" }),
      createInstallationPlanClient(undefined, recordingFetch).list("D4"),
      createCampusComparisonClient(undefined, recordingFetch).load({ date: "2026-05-18", weatherPreset: "clear" }),
    ]);

    expect(urls.length).toBeGreaterThanOrEqual(4);
    for (const url of urls) expect(url.startsWith("http://alias.test/energy/")).toBe(true);
  });
});

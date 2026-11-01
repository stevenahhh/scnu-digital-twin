import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

// The dev branch keeps Legacy and VWorld entry points separate. Both render the shared panel shell (src/panel/),
// whose energy tab owns the energy feature boundary; the entry itself never calls the energy API.
test("AppVWorld exposes an energy tab and a dedicated feature boundary", async () => {
  const [app, panel, tabs, energyTab] = await Promise.all([
    read("../../../AppVWorld.jsx"),
    read("../../../panel/DashboardPanel.jsx"),
    read("../../../panel/DashboardTabContent.jsx"),
    read("../../../panel/EnergyTab.jsx"),
  ]);
  assert.match(app, /<DashboardShell/);
  assert.match(app, /<DashboardTabContent/);
  assert.match(tabs, /<EnergyTab/);
  assert.match(panel, /value: "energy", label: "에너지"/);
  assert.match(energyTab, /<EnergyDashboard/);
  for (const source of [app, tabs, energyTab]) {
    assert.doesNotMatch(source, /calculateMayPvOutput|fetch\([^\n]*\/energy|monthlyOutput|solarResult|roofRatio/);
  }
});

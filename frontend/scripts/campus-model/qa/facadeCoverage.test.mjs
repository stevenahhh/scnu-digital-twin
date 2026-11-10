import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { facadeCoverage } from "./facadeCoverage.mjs";

test("coverage lists an omitted building even when another building has a grid", () => {
  const report = facadeCoverage({
    buildings: ["BLD_A", "BLD_B"],
    reviews: { BLD_A: { estimated: true, fallbackReason: "Unseen rear wall" } },
    grids: new Map([["BLD_A", { walls: new Map([["W00", { cells: [] }]]) }]]),
    entrances: [],
  });
  assert.deepEqual(report.missingBuildings, ["BLD_B"]);
  assert.equal(report.buildings[0].gridCount, 1);
});

test("coverage requires an explicit estimated fallback, not an empty reason", () => {
  const report = facadeCoverage({
    buildings: ["BLD_A", "BLD_B"],
    reviews: {
      BLD_A: { estimated: true, fallbackReason: " " },
      BLD_B: { estimated: true, fallbackReason: "Rear wing absent from the available views" },
    },
    grids: new Map(),
    entrances: [],
  });
  assert.deepEqual(report.missingBuildings, ["BLD_A"]);
  assert.equal(report.buildings[1].status, "fallback");
});

test("a partial grid cannot hide a blank or unmarked fallback reason", () => {
  const report = facadeCoverage({
    buildings: ["BLD_A", "BLD_B"],
    reviews: {
      BLD_A: { estimated: true, fallbackReason: " " },
      BLD_B: { estimated: false, fallbackReason: "Rear wall is not observed" },
    },
    grids: new Map(["BLD_A", "BLD_B"].map(id => [id, { walls: new Map([["W00", { cells: [] }]]) }])),
    entrances: [],
  });
  assert.deepEqual(report.missingBuildings, ["BLD_A", "BLD_B"]);
});

test("entrance report names shifted and ungridded doors without treating them as aligned", () => {
  const entry = { id: "CANOPY-A", anchor: { building: "BLD_A", wall: "W00", sM: 5 }, widthM: 2 };
  const report = facadeCoverage({
    buildings: ["BLD_A"],
    reviews: { BLD_A: { estimated: true, fallbackReason: "Rear not observed" } },
    grids: new Map([["BLD_A", { walls: new Map([["W00", {
      cells: [{ kind: "door", entrance: entry, s0M: 4, s1M: 8, look: { windowCentre: 0.5 } }],
    }]]) }]]),
    entrances: [entry, { ...entry, id: "CANOPY-B", anchor: { ...entry.anchor, wall: "W01" } }],
  });
  assert.deepEqual(report.entrances.map(e => [e.id, e.status, e.deltaSM]), [
    ["CANOPY-A", "mismatch", 1], ["CANOPY-B", "ungridded", null],
  ]);
});

test("door texture centre, not the containing bay centre, is compared with the canopy", () => {
  const entry = { id: "CANOPY-A", anchor: { building: "BLD_A", wall: "W00", sM: 4.2 }, widthM: 1 };
  const report = facadeCoverage({
    buildings: ["BLD_A"],
    reviews: { BLD_A: { estimated: true, fallbackReason: "Rear not observed" } },
    grids: new Map([["BLD_A", { walls: new Map([["W00", {
      cells: [{ kind: "door", entrance: entry, s0M: 3, s1M: 7, look: { windowCentre: 0.3 } }],
    }]]) }]]),
    entrances: [entry],
  });
  assert.equal(report.entrances[0].deltaSM, 0);
  assert.equal(report.entrances[0].status, "aligned");
});

test("shipped curation covers every loaded footprint and aligns the E3 canopy door", () => {
  const run = spawnSync("bun", [fileURLToPath(new URL("./facadeCoverage.mjs", import.meta.url))],
    { encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(run.error);
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.deepEqual(report.missingBuildings, []);
  const door = report.entrances.find(e => e.id === "SD-E5-C1");
  assert.equal(door.status, "aligned");
  assert.ok(door.deltaSM <= 0.3);
});

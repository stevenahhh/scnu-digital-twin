import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compileFacadeGrid, gridCellsOnEdge } from "./facadeGrid.mjs";
import { tmToScene } from "../../../src/geo/epsg5186.mjs";

const read = name => JSON.parse(readFileSync(new URL(`../data/buildings/${name}`, import.meta.url), "utf8"));

test("E3 upper cells match both independent VR structural counts on the saved GIS wall", () => {
  const doc = read("facades/BLD_E3.json");
  // The production source-model loader uses Bun.file; exercise it in its actual runtime.
  const loaded = spawnSync("bun", ["--eval", `import { loadTmFootprints } from ${JSON.stringify(new URL("./footprints.mjs", import.meta.url).href)}; console.log(JSON.stringify(await loadTmFootprints()));`],
    { encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(loaded.error);
  assert.equal(loaded.status, 0, loaded.stderr);
  const footprints = JSON.parse(loaded.stdout);
  const grid = compileFacadeGrid(doc, footprints.BLD_E3, read("entrances.json").records);
  for (const record of read("facade-counts.json").records) {
    const wall = grid.walls.get(record.wall);
    const cells = gridCellsOnEdge(grid, tmToScene(...wall.A), tmToScene(...wall.B)).filter(c => c.storey === 3 && c.bay >= 0);
    for (const observation of record.observations) {
      const ordinary = observation.centralOrdinaryGroups + observation.flankingOrdinaryGroups;
      assert.equal(cells.filter(c => c.kind === "window").length, ordinary, observation.scene);
      assert.equal(cells.filter(c => c.kind === "glazing").length, observation.doubleWidthGlazingGroups * 2, observation.scene);
      assert.equal(cells.length, ordinary + observation.doubleWidthGlazingGroups * 2, observation.scene);
    }
    assert.equal(doc.estimated, true);
    assert.equal(record.lod4.totalBayCount, null, "incomplete LOD4 reading must not become a certified whole-wall count");
  }
});

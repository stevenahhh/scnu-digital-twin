import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readBearing } from "./vrWallHit.mjs";

const stations = JSON.parse(readFileSync(new URL("../../perf/vr-stations.json", import.meta.url), "utf8"));
const station = stations.find(record => record.scene === "scene_e5");

// Independent GIS footprint vertices and manually read 2048 px panorama columns,
// 2026-11-03, task-18a-scene-e5-resection evidence. No E3 canopy is a control.
// E8 is the pink building in face f; the orange building marked E2 is in face l.
const landmarks = [
  { id: "E8 south outer corner W06", face: "f", col: 862, point: [243594.434492082, 263677.7096649145] },
  { id: "E8 north front corner W17", face: "f", col: 1367, point: [243605.91390844085, 263737.0528876398] },
  { id: "E8 north rear silhouette W16", face: "f", col: 1439, point: [243575.82190571396, 263742.8114178026] },
  { id: "E2 east silhouette W13", face: "l", col: 198, point: [243800.97511190939, 263687.9842567277] },
  { id: "E2 north front corner W12", face: "l", col: 302, point: [243782.00236389317, 263692.6749318973] },
  { id: "E5 front north corner W25", face: "f", col: 1664, point: [243674.94365486258, 263747.3456261981] },
  { id: "E5 inner courtyard corner W28", face: "f", col: 475, point: [243666.04097302616, 263695.4589668264] },
];

for (const landmark of landmarks) {
  test(`scene_e5 places ${landmark.id} within the 1.5 degree bearing gate`, () => {
    const ray = readBearing(station, landmark);
    assert.equal(ray.tier, "T2");
    const expected = Math.atan2(landmark.point[0] - ray.origin[0], landmark.point[1] - ray.origin[1]) * 180 / Math.PI;
    const residual = ((expected - ray.bearingDeg + 540) % 360) - 180;
    assert.ok(Math.abs(residual) <= 1.5, `${landmark.id}: ${residual.toFixed(6)} deg`);
  });
}

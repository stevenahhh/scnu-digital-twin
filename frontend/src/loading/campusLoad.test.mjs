import assert from "node:assert/strict";
import test from "node:test";
import { approach, createCampusLoad, overallProgress, revealSeconds } from "./campusLoad.mjs";

const MB = 1024 * 1024;

test("download progress follows the bytes and stays below the parse stage", () => {
  const half = overallProgress({ bytesLoaded: 25 * MB, bytesTotal: 50 * MB, downloadedAt: null, sceneReady: false }, 1000);
  const most = overallProgress({ bytesLoaded: 49 * MB, bytesTotal: 50 * MB, downloadedAt: null, sceneReady: false }, 1000);
  assert.ok(half > 0.3 && half < most);
  assert.ok(most < 0.8);
});

test("an unknown size still moves forward and never claims the download finished", () => {
  const small = overallProgress({ bytesLoaded: 5 * MB, bytesTotal: 0, downloadedAt: null, sceneReady: false }, 0);
  const large = overallProgress({ bytesLoaded: 500 * MB, bytesTotal: 0, downloadedAt: null, sceneReady: false }, 0);
  assert.ok(small > 0 && small < large && large < 0.8);
});

test("the parse stage approaches but does not reach 1 until the scene is ready", () => {
  const state = { bytesLoaded: 50 * MB, bytesTotal: 50 * MB, downloadedAt: 1000, sceneReady: false };
  const early = overallProgress(state, 1100);
  const late = overallProgress(state, 600000);
  assert.ok(early >= 0.78 && early < late && late < 1);
  assert.equal(overallProgress({ ...state, sceneReady: true }, 1100), 1);
});

test("approach is independent of the frame rate", () => {
  let coarse = 0;
  coarse = approach(coarse, 1, 0.1, 0.3);
  let fine = 0;
  for (let i = 0; i < 10; i += 1) fine = approach(fine, 1, 0.01, 0.3);
  assert.ok(Math.abs(coarse - fine) < 1e-9);
});

test("the reveal takes longer on a larger screen, inside its bounds, and is short with reduced motion", () => {
  assert.ok(revealSeconds(1440, 900, false) > revealSeconds(390, 844, false));
  assert.ok(revealSeconds(8000, 8000, false) <= 1.4);
  assert.ok(revealSeconds(100, 100, false) >= 0.7);
  assert.ok(revealSeconds(1440, 900, true) < 0.3);
});

test("the store reports bytes, readiness and a failure, and a retry starts over", () => {
  const load = createCampusLoad(() => 5000);
  let calls = 0;
  load.subscribe(() => { calls += 1; });
  load.reportBytes(10, 20);
  load.reportDownloaded();
  assert.equal(load.getState().downloadedAt, 5000);
  assert.equal(load.getState().bytesLoaded, 20);
  load.markSceneReady();
  assert.equal(load.getState().settled, true);
  load.markSceneGone();
  assert.equal(load.getState().settled, false);
  load.markFailed();
  assert.equal(load.getState().settled, true);
  load.restart();
  assert.deepEqual(load.getState(), { bytesLoaded: 0, bytesTotal: 0, downloadedAt: null, sceneReady: false, failed: false, settled: false });
  assert.equal(calls, 6);
});

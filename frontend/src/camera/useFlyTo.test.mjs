import assert from "node:assert/strict";
import test from "node:test";
import { BoxGeometry, Mesh, MeshBasicMaterial, PlaneGeometry, Scene } from "three";
import { createFlyTo, createSceneLookups, isFlyToEvent, prefersReducedMotion, FLY_TO_START_EVENT } from "./useFlyTo.mjs";

function fakeClock() {
  let time = 1000;
  const frames = [];
  return {
    now: () => time,
    requestFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelFrame: (id) => {
      frames[id - 1] = null;
    },
    advance(ms) {
      time += ms;
      const pending = frames.splice(0, frames.length).filter(Boolean);
      for (const callback of pending) callback();
    },
    pendingFrames: () => frames.filter(Boolean).length,
  };
}

const from = { position: [0, 0, 0], target: [0, 0, 0] };
const to = { position: [100, 200, 300], target: [10, 20, 30] };

test("flies with quadratic in-out timing and lands exactly on the target after the duration", () => {
  const clock = fakeClock();
  const engine = createFlyTo({ ...clock, durationMs: 800 });
  const applied = [];
  let finished = 0;
  engine.start({ from, to, apply: (view) => applied.push(view), onFinish: () => finished++ });
  assert.equal(engine.isActive(), true);
  assert.equal(applied.length, 0, "nothing is applied before the first frame");

  clock.advance(400);
  assert.deepEqual(applied.at(-1), { position: [50, 100, 150], target: [5, 10, 15] });
  assert.equal(finished, 0);

  clock.advance(200);
  const atThreeQuarters = applied.at(-1).position[0];
  assert.ok(atThreeQuarters > 75 && atThreeQuarters < 100, `eased-out progress at t=0.75 was ${atThreeQuarters}`);

  clock.advance(250);
  assert.deepEqual(applied.at(-1), to);
  assert.equal(finished, 1);
  assert.equal(engine.isActive(), false);
  assert.equal(clock.pendingFrames(), 0);
});

test("cancel stops the flight, notifies onCancel and leaves no pending frame", () => {
  const clock = fakeClock();
  const engine = createFlyTo({ ...clock, durationMs: 800 });
  const applied = [];
  let cancelled = 0;
  engine.start({ from, to, apply: (view) => applied.push(view), onCancel: () => cancelled++ });
  clock.advance(100);
  assert.equal(engine.cancel(), true);
  assert.equal(cancelled, 1);
  assert.equal(engine.isActive(), false);
  const appliedBefore = applied.length;
  clock.advance(1000);
  assert.equal(applied.length, appliedBefore);
  assert.equal(engine.cancel(), false, "a second cancel is a no-op");
});

test("a new flight cancels the one in progress", () => {
  const clock = fakeClock();
  const engine = createFlyTo({ ...clock, durationMs: 800 });
  let firstCancelled = 0;
  let secondFinished = 0;
  engine.start({ from, to, apply: () => {}, onCancel: () => firstCancelled++ });
  clock.advance(100);
  engine.start({ from: to, to: from, apply: () => {}, onFinish: () => secondFinished++ });
  assert.equal(firstCancelled, 1);
  clock.advance(900);
  assert.equal(secondFinished, 1);
});

test("reduced motion jumps straight to the target without animating", () => {
  const clock = fakeClock();
  const engine = createFlyTo({ ...clock, durationMs: 800 });
  const applied = [];
  let finished = 0;
  engine.start({ from, to, apply: (view) => applied.push(view), reducedMotion: true, onFinish: () => finished++ });
  assert.deepEqual(applied, [to]);
  assert.equal(finished, 1);
  assert.equal(engine.isActive(), false);
  assert.equal(clock.pendingFrames(), 0);
});

test("prefersReducedMotion reads the media query and defaults to false without matchMedia", () => {
  const queries = [];
  const matchMedia = (query) => {
    queries.push(query);
    return { matches: true };
  };
  assert.equal(prefersReducedMotion(matchMedia), true);
  assert.deepEqual(queries, ["(prefers-reduced-motion: reduce)"]);
  assert.equal(prefersReducedMotion(() => ({ matches: false })), false);
  assert.equal(prefersReducedMotion(undefined), false);
});

test("fly-to start events are distinguishable from user interaction", () => {
  assert.equal(isFlyToEvent({ ...FLY_TO_START_EVENT }), true);
  assert.equal(isFlyToEvent({ type: "start" }), false);
  assert.equal(isFlyToEvent(undefined), false);
});

test("scene lookups resolve BLD_* bounds and terrain height, and are empty without a scene", () => {
  assert.deepEqual(createSceneLookups(null), {});
  const scene = new Scene();
  const building = new Mesh(new BoxGeometry(10, 20, 30), new MeshBasicMaterial());
  building.name = "BLD_TEST";
  building.position.set(100, 10, -50);
  const terrain = new Mesh(new PlaneGeometry(400, 400), new MeshBasicMaterial());
  terrain.name = "Topography_3";
  terrain.rotation.x = -Math.PI / 2;
  terrain.position.y = 12;
  scene.add(building, terrain);
  scene.updateMatrixWorld(true);
  const { boundsOf, groundAt } = createSceneLookups(scene);
  assert.deepEqual(boundsOf("BLD_TEST"), { min: [95, 0, -65], max: [105, 20, -35] });
  assert.equal(boundsOf("BLD_MISSING"), null);
  assert.ok(Math.abs(groundAt(50, 50) - 12) < 1e-6);
  assert.equal(groundAt(900, 900), null, "outside the terrain");
});

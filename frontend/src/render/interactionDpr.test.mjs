import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANVAS_DPR, INTERACTION_RESTORE_MS, canvasDpr, createInteractionDpr } from "./interactionDpr.mjs";
import { SETTLE_MS } from "../labels/motionSettle.mjs";

function fakeTimers() {
  const timers = new Map();
  let nextId = 1;
  return {
    setTimer(callback, ms) {
      const id = nextId++;
      timers.set(id, { callback, ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    fireAll() {
      const due = [...timers.values()];
      timers.clear();
      due.forEach((t) => t.callback());
      return due.map((t) => t.ms);
    },
    pending: () => timers.size,
  };
}

describe("canvasDpr", () => {
  it("uses the R3F [1, 2] range while idle", () => {
    assert.deepEqual(canvasDpr(false, 2), CANVAS_DPR);
  });

  it("scales the clamped device pixel ratio by 0.75 while interacting", () => {
    assert.equal(canvasDpr(true, 2), 1.5);
    assert.equal(canvasDpr(true, 3), 1.5);
    assert.equal(canvasDpr(true, 1), 0.75);
  });
});

describe("createInteractionDpr", () => {
  it("restores after the shared settle time (--motion-settle), not a constant of its own", () => {
    assert.equal(INTERACTION_RESTORE_MS, SETTLE_MS);
  });

  it("lowers on start and restores the settle time after end", () => {
    const timers = fakeTimers();
    const changes = [];
    const dpr = createInteractionDpr({ ...timers, onChange: (v) => changes.push(v) });
    dpr.start();
    dpr.start();
    assert.deepEqual(changes, [true]);
    dpr.end();
    assert.equal(dpr.isLowered(), true);
    assert.deepEqual(timers.fireAll(), [INTERACTION_RESTORE_MS]);
    assert.deepEqual(changes, [true, false]);
  });

  it("a new drag before the restore keeps the lowered ratio without flicker", () => {
    const timers = fakeTimers();
    const changes = [];
    const dpr = createInteractionDpr({ ...timers, onChange: (v) => changes.push(v) });
    dpr.start();
    dpr.end();
    dpr.start();
    assert.equal(timers.pending(), 0);
    assert.deepEqual(changes, [true]);
  });

  it("end without start does nothing", () => {
    const timers = fakeTimers();
    const changes = [];
    createInteractionDpr({ ...timers, onChange: (v) => changes.push(v) }).end();
    assert.equal(timers.pending(), 0);
    assert.deepEqual(changes, []);
  });
});

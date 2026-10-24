import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAnimationWindow, isLiveTraffic, resolveFrameloop } from "./useDemandLoop.mjs";

function fakeClock() {
  let time = 0;
  const timers = new Map();
  let nextId = 1;
  return {
    now: () => time,
    setTimer(callback, ms) {
      const id = nextId++;
      timers.set(id, { at: time + ms, callback });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      const end = time + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        time = due[1].at;
        due[1].callback();
      }
      time = end;
    },
    pending: () => timers.size,
  };
}

describe("resolveFrameloop", () => {
  it("idles on demand when nothing animates", () => {
    assert.equal(resolveFrameloop({}), "demand");
  });

  it("runs always while live traffic or an animation window is active", () => {
    assert.equal(resolveFrameloop({ liveTraffic: true }), "always");
    assert.equal(resolveFrameloop({ animating: true }), "always");
  });

  it("stops the loop while hidden or while a modal canvas is open, even with live traffic", () => {
    assert.equal(resolveFrameloop({ hidden: true, liveTraffic: true, animating: true }), "never");
    assert.equal(resolveFrameloop({ modalOpen: true, liveTraffic: true }), "never");
  });
});

describe("isLiveTraffic", () => {
  it("is live only for a running simulation with agents", () => {
    const agents = new Map([["car-1", {}]]);
    assert.equal(isLiveTraffic({ status: "running", entities: agents }), true);
    assert.equal(isLiveTraffic({ status: "running", entities: new Map() }), false);
    assert.equal(isLiveTraffic({ status: "paused", entities: agents }), false);
  });
});

describe("createAnimationWindow", () => {
  it("reports active once and settles after the duration", () => {
    const clock = fakeClock();
    const changes = [];
    const win = createAnimationWindow({ ...clock, onChange: (v) => changes.push(v) });
    win.extend(1000);
    win.extend(500);
    assert.deepEqual(changes, [true]);
    clock.advance(999);
    assert.equal(win.isActive(), true);
    clock.advance(1);
    assert.equal(win.isActive(), false);
    assert.deepEqual(changes, [true, false]);
    assert.equal(clock.pending(), 0);
  });

  it("extends the deadline when a later request outlasts the first", () => {
    const clock = fakeClock();
    const changes = [];
    const win = createAnimationWindow({ ...clock, onChange: (v) => changes.push(v) });
    win.extend(1000);
    clock.advance(800);
    win.extend(1000);
    clock.advance(999);
    assert.equal(win.isActive(), true);
    clock.advance(1);
    assert.equal(win.isActive(), false);
    assert.deepEqual(changes, [true, false]);
  });

  it("dispose clears the timer and releases the active state", () => {
    const clock = fakeClock();
    const changes = [];
    const win = createAnimationWindow({ ...clock, onChange: (v) => changes.push(v) });
    win.extend(1000);
    win.dispose();
    assert.equal(clock.pending(), 0);
    assert.deepEqual(changes, [true, false]);
    win.extend(200);
    clock.advance(200);
    assert.deepEqual(changes, [true, false, true, false]);
  });
});

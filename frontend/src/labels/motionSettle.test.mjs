import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SETTLE_MS, SETTLE_STILL_FRAMES, createMotionSettle } from "./motionSettle.mjs";

function clock() {
  let t = 0;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe("createMotionSettle", () => {
  it("is settled until a motion starts, and not settled before end", () => {
    const c = clock();
    const settle = createMotionSettle({ now: c.now });
    assert.deepEqual(settle.poll(), { settled: true });
    settle.start();
    assert.equal(settle.isActive(), true);
    assert.deepEqual(settle.poll(), { settled: false, waitMs: null });
  });

  it("settles after the time threshold and three consecutive still frames", () => {
    const c = clock();
    const settle = createMotionSettle({ now: c.now });
    settle.start();
    settle.noteFrame(true);
    settle.end();
    c.advance(SETTLE_MS - 1);
    assert.deepEqual(settle.poll(), { settled: false, waitMs: 1 });
    c.advance(1);
    assert.deepEqual(settle.poll(), { settled: false, framesNeeded: SETTLE_STILL_FRAMES });
    settle.noteFrame(false);
    settle.noteFrame(false);
    assert.deepEqual(settle.poll(), { settled: false, framesNeeded: 1 });
    settle.noteFrame(false);
    assert.deepEqual(settle.poll(), { settled: true });
    assert.equal(settle.isActive(), false);
  });

  it("under load (frames longer than the threshold) keeps waiting while damping still moves the camera", () => {
    const c = clock();
    const settle = createMotionSettle({ now: c.now });
    settle.start();
    settle.end();
    // 400 ms frames: each one exceeds the 150 ms threshold, but the camera is still easing on every frame.
    for (let frame = 0; frame < 10; frame += 1) {
      c.advance(400);
      assert.equal(settle.poll().settled, false, `frame ${frame} before the move`);
      settle.noteFrame(true);
      c.advance(1);
      assert.equal(settle.poll().settled, false, `frame ${frame} after the move`);
    }
    // damping stops: three still frames later it settles.
    for (let frame = 0; frame < SETTLE_STILL_FRAMES; frame += 1) {
      c.advance(400);
      assert.equal(settle.poll().settled, false);
      settle.noteFrame(false);
    }
    assert.deepEqual(settle.poll(), { settled: true });
  });

  it("a movement resets the still-frame count", () => {
    const c = clock();
    const settle = createMotionSettle({ now: c.now });
    settle.start();
    settle.end();
    settle.noteFrame(false);
    settle.noteFrame(false);
    settle.noteFrame(true);
    settle.noteFrame(false);
    c.advance(SETTLE_MS);
    assert.deepEqual(settle.poll(), { settled: false, framesNeeded: 2 });
  });

  it("a new start re-arms it and ignores the previous end", () => {
    const c = clock();
    const settle = createMotionSettle({ now: c.now, settleMs: () => 200, stillFrames: 1 });
    settle.start();
    settle.end();
    settle.start();
    c.advance(1000);
    settle.noteFrame(false);
    assert.deepEqual(settle.poll(), { settled: false, waitMs: null });
    settle.end();
    c.advance(200);
    assert.deepEqual(settle.poll(), { settled: true });
  });

  it("end without a start is ignored", () => {
    const settle = createMotionSettle({ now: clock().now });
    settle.end();
    assert.deepEqual(settle.poll(), { settled: true });
  });
});

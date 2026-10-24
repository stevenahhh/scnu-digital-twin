import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachBenchBridge, attachCanvasLifecycle } from "./canvasLifecycle.mjs";

function fakeState() {
  const internal = { frames: 0 };
  const state = {
    invalidations: 0,
    gl: { domElement: new EventTarget() },
    get: () => ({ internal }),
    internal,
  };
  state.invalidate = () => {
    state.invalidations += 1;
    internal.frames = 1;
  };
  return state;
}

function fakeWindow(bench) {
  const frames = new Map();
  let nextId = 1;
  return {
    __bench: bench,
    requestAnimationFrame(callback) {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    step() {
      const due = [...frames.values()];
      frames.clear();
      due.forEach((callback) => callback());
    },
    pending: () => frames.size,
  };
}

describe("attachCanvasLifecycle", () => {
  it("prevents the default on context loss and redraws once on restore", () => {
    const state = fakeState();
    const detach = attachCanvasLifecycle(state, { win: {} });
    const lost = new Event("webglcontextlost", { cancelable: true });
    state.gl.domElement.dispatchEvent(lost);
    assert.equal(lost.defaultPrevented, true);
    state.gl.domElement.dispatchEvent(new Event("webglcontextrestored"));
    assert.equal(state.invalidations, 1);
    detach();
    state.gl.domElement.dispatchEvent(new Event("webglcontextrestored"));
    assert.equal(state.invalidations, 1);
  });
});

describe("attachBenchBridge", () => {
  it("invalidates every frame only while measuring and drops the queued frame when measuring ends", () => {
    const bench = { measuring: false, view: null };
    const state = fakeState();
    const win = fakeWindow(bench);
    attachBenchBridge(bench, state, win);

    win.step();
    assert.equal(state.invalidations, 0);

    bench.measuring = true;
    assert.equal(state.invalidations, 1);
    win.step();
    win.step();
    assert.equal(state.invalidations, 3);

    bench.measuring = false;
    assert.equal(bench.measuring, false);
    assert.equal(state.internal.frames, 0);
    assert.equal(win.pending(), 0);
    win.step();
    assert.equal(state.invalidations, 3);
  });

  it("draws one frame when the bench changes the view", () => {
    const bench = { measuring: false, view: null };
    const state = fakeState();
    attachBenchBridge(bench, state, fakeWindow(bench));
    const view = { name: "overview" };
    bench.view = view;
    assert.equal(bench.view, view);
    assert.equal(state.invalidations, 1);
  });

  it("detaching restores plain properties with the latest values", () => {
    const bench = { measuring: false, view: null };
    const state = fakeState();
    const detach = attachBenchBridge(bench, state, fakeWindow(bench));
    bench.view = { name: "d4" };
    detach();
    assert.equal(Object.getOwnPropertyDescriptor(bench, "view").value.name, "d4");
    bench.measuring = true;
    assert.equal(state.invalidations, 1);
  });
});

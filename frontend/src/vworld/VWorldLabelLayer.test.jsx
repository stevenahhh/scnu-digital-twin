/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VWorldLabelLayer } from "./VWorldLabelLayer.jsx";

afterEach(cleanup);

// vitest(jsdom) runs from frontend/ (scripts/run-tests.mjs); import.meta.url is not a file URL there.
const GLB = readFileSync(path.resolve(process.cwd(), "public/campus-buildings.glb"));
// Copy into an ArrayBuffer of this (jsdom) realm, like fetch().arrayBuffer() returns in the browser.
const loadGlb = () => {
  const copy = new Uint8Array(GLB.byteLength);
  copy.set(GLB);
  return Promise.resolve(copy.buffer);
};

function event() {
  const listeners = new Set();
  return {
    addEventListener: (fn) => listeners.add(fn),
    removeEventListener: (fn) => listeners.delete(fn),
    raise: () => [...listeners].forEach((fn) => fn()),
    get size() { return listeners.size; },
  };
}

// Fake Cesium/scene: identity model matrix, camera 400 m above the campus looking down; every anchor that projects goes on a
// spread-out grid inside a 1440 x 900 canvas so nothing collides.
function fakeMap() {
  class Cartesian3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    static subtract(a, b, out) { out.x = a.x - b.x; out.y = a.y - b.y; out.z = a.z - b.z; return out; }
    static dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
    static distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  }
  const slot = new Map();
  const Cesium = {
    Cartesian3,
    Matrix4: { IDENTITY: "i", multiplyByPoint: (_m, p, out) => Object.assign(out, p), getTranslation: (_m, out) => out },
    Cartographic: { fromCartesian: () => ({ longitude: 0, latitude: 0, height: 0 }) },
    SceneTransforms: {
      wgs84ToWindowCoordinates: (_scene, p) => {
        const key = `${p.x},${p.y}`;
        if (!slot.has(key)) slot.set(key, slot.size);
        const i = slot.get(key);
        return { x: 100 + (i % 6) * 220, y: 120 + Math.floor(i / 6) * 140 };
      },
    },
  };
  const scene = {
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 1440, bottom: 900, width: 1440, height: 900 }) },
    postRender: event(),
    requestRender: vi.fn(),
    camera: {
      positionWC: new Cartesian3(0, 0, 400),
      directionWC: new Cartesian3(0, 0, -1),
      positionCartographic: { height: 400 },
      pitch: -Math.PI / 4,
      moveStart: event(),
      moveEnd: event(),
    },
  };
  return { Cesium, scene };
}

const visibleChips = (container) =>
  [...container.querySelectorAll("[data-label-slot]")].filter((slot) => slot.style.visibility === "visible");

describe("VWorldLabelLayer", () => {
  it("renders the shared label layer from the campus GLB anchors and lays chips out on each map render", async () => {
    const { Cesium, scene } = fakeMap();
    const { container } = render(<VWorldLabelLayer Cesium={Cesium} scene={scene} getModelMatrix={() => "m"} loadGlb={loadGlb} />);
    await waitFor(() => expect(container.querySelector('[data-qa="campus-label-layer"]')).not.toBeNull());
    expect(scene.postRender.size).toBe(1);
    act(() => scene.postRender.raise());
    const shown = visibleChips(container);
    expect(shown.length).toBeGreaterThan(0);
    expect(container.querySelector('[data-label-slot="BLD_C1"] button[data-qa="campus-label"]')).not.toBeNull();
  });

  it("selects through onSelectEntry with the registry entry, marks the selected chip and clears on Escape", async () => {
    const { Cesium, scene } = fakeMap();
    const onSelectEntry = vi.fn();
    const onClear = vi.fn();
    const props = { Cesium, scene, getModelMatrix: () => "m", loadGlb, onSelectEntry, onClear };
    const view = render(<VWorldLabelLayer {...props} />);
    await waitFor(() => expect(view.container.querySelector('[data-label-slot="BLD_C1"] button')).not.toBeNull());
    act(() => scene.postRender.raise());
    fireEvent.click(view.container.querySelector('[data-label-slot="BLD_C1"] button'), { detail: 0 });
    expect(onSelectEntry).toHaveBeenCalledWith(expect.objectContaining({ elementId: "BLD_C1", displayName: "도서관" }), expect.anything());
    view.rerender(<VWorldLabelLayer {...props} selectedId="BLD_C1" />);
    expect(view.container.querySelector('[data-label-slot="BLD_C1"] button').getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("fades while the camera moves, hides every chip while hidden, and detaches from the map on unmount", async () => {
    const { Cesium, scene } = fakeMap();
    const props = { Cesium, scene, getModelMatrix: () => "m", loadGlb };
    const view = render(<VWorldLabelLayer {...props} />);
    await waitFor(() => expect(view.container.querySelector('[data-qa="campus-label-layer"]')).not.toBeNull());
    act(() => scene.postRender.raise());
    act(() => scene.camera.moveStart.raise());
    expect(view.container.querySelector('[data-qa="campus-label-layer"]').dataset.motion).toBe("true");
    view.rerender(<VWorldLabelLayer {...props} hidden />);
    act(() => scene.postRender.raise());
    expect(visibleChips(view.container)).toHaveLength(0);
    view.unmount();
    expect(scene.postRender.size).toBe(0);
    expect(scene.camera.moveStart.size).toBe(0);
  });

  it("fades while the camera pose changes between renders even without camera.moveStart, and settles 150 ms after it stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { Cesium, scene } = fakeMap();
      const { container } = render(<VWorldLabelLayer Cesium={Cesium} scene={scene} getModelMatrix={() => "m"} loadGlb={loadGlb} />);
      await waitFor(() => expect(container.querySelector('[data-qa="campus-label-layer"]')).not.toBeNull());
      const layer = () => container.querySelector('[data-qa="campus-label-layer"]');
      act(() => scene.postRender.raise());
      expect(layer().dataset.motion).toBe("false");
      // The SDK drags the camera: only the pose changes.
      scene.camera.positionWC = new Cesium.Cartesian3(5, 0, 400);
      act(() => scene.postRender.raise());
      expect(layer().dataset.motion).toBe("true");
      act(() => {
        vi.advanceTimersByTime(160);
      });
      expect(layer().dataset.motion).toBe("false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays faded while the pointer is held on the map, even when the camera has stopped, and settles 150 ms after release", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { Cesium, scene } = fakeMap();
      const canvas = document.createElement("canvas");
      canvas.getBoundingClientRect = scene.canvas.getBoundingClientRect;
      scene.canvas = canvas;
      const { container } = render(<VWorldLabelLayer Cesium={Cesium} scene={scene} getModelMatrix={() => "m"} loadGlb={loadGlb} />);
      await waitFor(() => expect(container.querySelector('[data-qa="campus-label-layer"]')).not.toBeNull());
      const layer = () => container.querySelector('[data-qa="campus-label-layer"]');
      act(() => scene.postRender.raise());
      fireEvent.pointerDown(canvas);
      expect(layer().dataset.motion).toBe("true");
      // The SDK reports the end of the camera move while the button is still down: the fade stays.
      act(() => {
        scene.camera.moveEnd.raise();
        vi.advanceTimersByTime(400);
        scene.postRender.raise();
      });
      expect(layer().dataset.motion).toBe("true");
      fireEvent.pointerUp(window);
      act(() => {
        vi.advanceTimersByTime(160);
      });
      expect(layer().dataset.motion).toBe("false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides every chip while the camera is at globe distance (before the map flies to the campus)", async () => {
    const { Cesium, scene } = fakeMap();
    scene.camera.positionCartographic.height = 1_700_000;
    const { container } = render(<VWorldLabelLayer Cesium={Cesium} scene={scene} getModelMatrix={() => "m"} loadGlb={loadGlb} />);
    await waitFor(() => expect(container.querySelector('[data-qa="campus-label-layer"]')).not.toBeNull());
    act(() => scene.postRender.raise());
    expect(visibleChips(container)).toHaveLength(0);
  });

  it("renders nothing when the anchors cannot be loaded", async () => {
    const { Cesium, scene } = fakeMap();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = () => Promise.reject(new Error("offline"));
    const { container } = render(<VWorldLabelLayer Cesium={Cesium} scene={scene} getModelMatrix={() => "m"} loadGlb={failing} />);
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(container.querySelector('[data-qa="campus-label-layer"]')).toBeNull();
    expect(scene.postRender.size).toBe(0);
    warn.mockRestore();
  });
});

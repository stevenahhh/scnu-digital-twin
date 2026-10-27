/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampusLabelLayer } from "./CampusLabelLayer.jsx";
import { HOLD_MS, resolveLabelBand } from "./labelBands.mjs";

afterEach(cleanup);

const AREA = { left: 0, top: 0, right: 1440, bottom: 900, width: 1440, height: 900 };
const FAR = resolveLabelBand({ distance: 368, pitchDegrees: 45 });
const NEAR = resolveLabelBand({ distance: 98, pitchDegrees: 40 });
// jsdom has no layout: every chip measures 80 x 24 inside a 32 px tall button.
const measure = () => ({ width: 80, height: 24, hitWidth: 80, hitHeight: 32 });

function entry(id, overrides = {}) {
  return { elementId: id, displayName: `건물 ${id}`, shortName: null, code: null, tier: 1, group: null, estimatedName: false, hasData: true, ...overrides };
}

// A fake camera projection: anchors on a 6 x 4 grid, far apart so nothing collides; distance grows with the index.
function project(entries) {
  return new Map(entries.map((e, i) => [e.elementId, { x: 120 + (i % 6) * 200, y: 150 + Math.floor(i / 6) * 180, depth: 100 + i, distance: 100 + i }]));
}

function mount(entries, props = {}) {
  const controllerRef = createRef();
  const view = render(<CampusLabelLayer entries={entries} controllerRef={controllerRef} measure={measure} {...props} />);
  const update = (frame) =>
    act(() => {
      controllerRef.current.update({ points: project(entries), area: AREA, chrome: [], occluder: null, band: FAR, now: 0, motion: false, ...frame });
    });
  const visibleSlots = () => [...view.container.querySelectorAll("[data-label-slot]")].filter((slot) => slot.style.visibility === "visible");
  return { ...view, controllerRef, update, visibleSlots };
}

describe("CampusLabelLayer", () => {
  it("is one pointer-transparent overlay and shows at most the band's cap of chips", () => {
    const entries = Array.from({ length: 20 }, (_, i) => entry(`BLD_X${String(i).padStart(2, "0")}`));
    const { container, update, visibleSlots } = mount(entries);
    update();
    const layer = container.querySelector('[data-qa="campus-label-layer"]');
    expect(layer.className).toMatch(/\bpointer-events-none\b/);
    expect(layer.className).toMatch(/\babsolute\b/);
    expect(layer.className).toMatch(/\binset-0\b/);
    // far band: tier 1 capped at 8 landmarks.
    expect(visibleSlots()).toHaveLength(FAR.tierCaps[1]);
    // hidden chips stay out of hit testing.
    const hidden = [...container.querySelectorAll("[data-label-slot]")].filter((slot) => slot.style.visibility !== "visible");
    expect(hidden.every((slot) => slot.style.pointerEvents === "none")).toBe(true);
    // ...and out of the Tab order: a parked chip is never focused off screen.
    expect(hidden.every((slot) => slot.inert === true)).toBe(true);
    expect(visibleSlots().every((slot) => slot.inert !== true)).toBe(true);
  });

  it("writes each shown slot's anchor y as data-anchor-top and clears it when the slot hides", () => {
    const entries = Array.from({ length: 20 }, (_, i) => entry(`BLD_X${String(i).padStart(2, "0")}`));
    const { container, update, visibleSlots } = mount(entries);
    update();
    const points = project(entries);
    const shown = visibleSlots();
    expect(shown.length).toBeGreaterThan(0);
    for (const slot of shown) {
      expect(slot.dataset.anchorTop).toBe(String(Math.round(points.get(slot.dataset.labelSlot).y)));
      expect(slot.dataset.anchorLeft).toBe(String(Math.round(points.get(slot.dataset.labelSlot).x)));
    }
    const hidden = [...container.querySelectorAll("[data-label-slot]")].filter((slot) => slot.style.visibility !== "visible");
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.every((slot) => slot.dataset.anchorTop === undefined)).toBe(true);
    update({ hidden: true });
    expect([...container.querySelectorAll("[data-label-slot]")].every((slot) => slot.dataset.anchorTop === undefined)).toBe(true);
  });

  it("orders the chips in the DOM (= Tab order) by priority: tier, then data, then distance", () => {
    const entries = [
      entry("BLD_FAR2", { tier: 2 }),
      entry("BLD_NODATA", { tier: 1, hasData: false }),
      entry("BLD_LAND_B", { tier: 1 }),
      entry("BLD_LAND_A", { tier: 1 }),
    ];
    const { container, update, visibleSlots } = mount(entries);
    // near band shows tiers 1-3 as chips; distances follow the array index.
    update({ band: NEAR });
    const visible = visibleSlots().map((slot) => slot.dataset.labelSlot);
    expect(visible).toEqual(["BLD_LAND_B", "BLD_LAND_A", "BLD_NODATA", "BLD_FAR2"]);
    const buttons = [...container.querySelectorAll('[data-qa="campus-label"]')].map((button) => button.dataset.elementId);
    expect(buttons.slice(0, 4)).toEqual(visible);
  });

  it("keeps the selected chip first, pressed, announced, and dims the others", () => {
    const entries = [entry("BLD_A"), entry("BLD_B"), entry("BLD_C", { displayName: "도서관" })];
    const { container, update, visibleSlots } = mount(entries, { selectedId: "BLD_C" });
    update();
    expect(visibleSlots()[0].dataset.labelSlot).toBe("BLD_C");
    const selected = container.querySelector('[data-element-id="BLD_C"]');
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    expect(selected.dataset.state).toBe("selected");
    expect(container.querySelector('[data-element-id="BLD_A"]').dataset.state).toBe("dimmed");
    expect(container.querySelector('[data-qa="label-live"]').textContent).toBe("선택: 도서관");
  });

  it("fades the layer while the camera moves and tracks anchors without changing which chips are shown", () => {
    const entries = Array.from({ length: 12 }, (_, i) => entry(`BLD_M${String(i).padStart(2, "0")}`));
    const { container, controllerRef, update, visibleSlots } = mount(entries);
    update();
    const layer = container.querySelector('[data-qa="campus-label-layer"]');
    expect(layer.className).toMatch(/data-\[motion=true\]:opacity-40/);
    const before = visibleSlots().map((slot) => slot.dataset.labelSlot);

    act(() => controllerRef.current.setMotion(true));
    expect(layer.dataset.motion).toBe("true");
    // During motion every anchor moves 50 px right; a closer camera would re-rank, but the shown set is frozen.
    const moved = new Map([...project(entries)].map(([id, p]) => [id, { ...p, x: p.x + 50, distance: 1000 - p.distance }]));
    const first = visibleSlots()[0];
    const x0 = Number(/translate3d\((-?\d+)px/.exec(first.style.transform)[1]);
    update({ points: moved, motion: true, now: 1000 });
    expect(visibleSlots().map((slot) => slot.dataset.labelSlot)).toEqual(before);
    expect(Number(/translate3d\((-?\d+)px/.exec(first.style.transform)[1])).toBe(x0 + 50);

    act(() => controllerRef.current.setMotion(false));
    expect(layer.dataset.motion).toBe("false");
  });

  it("asks for one more layout pass once the 300 ms hold has passed, so waiting chips appear without camera input", () => {
    vi.useFakeTimers();
    try {
      const onRequestPass = vi.fn();
      const entries = [entry("BLD_A"), entry("BLD_B")];
      const { update, visibleSlots } = mount(entries, { onRequestPass });
      // first pass: CityModel dropped both anchors (under the open panel), nothing shown
      update({ points: new Map(), now: 0 });
      expect(visibleSlots()).toHaveLength(0);
      // panel closes: the chips now wait 300 ms for their slot (same band, hysteresis holds them)
      update({ now: 10 });
      expect(visibleSlots()).toHaveLength(0);
      onRequestPass.mockClear();
      act(() => vi.advanceTimersByTime(HOLD_MS + 16));
      expect(onRequestPass).toHaveBeenCalledTimes(1);
      update({ now: 10 + HOLD_MS });
      expect(visibleSlots()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a chip whose anchor is at the screen edge, slid inward with a leader ending in an anchor dot", () => {
    const entries = [entry("BLD_EDGE")];
    const { container, update, visibleSlots } = mount(entries);
    update({ points: new Map([["BLD_EDGE", { x: 3, y: 400, depth: 100, distance: 100 }]]) });
    expect(visibleSlots().map((slot) => slot.dataset.labelSlot)).toEqual(["BLD_EDGE"]);
    // 80 px chip clamped to the 8 px edge margin: its button starts at x = 8.
    expect(visibleSlots()[0].style.transform).toMatch(/^translate3d\(8px,/);
    const leader = container.querySelector('[data-qa="label-leader"]');
    expect(leader.style.visibility).toBe("visible");
    const dot = leader.querySelector('[data-qa="label-anchor-dot"]');
    expect([dot.getAttribute("cx"), dot.getAttribute("cy")]).toEqual(["3", "400"]);
  });

  it("keeps chips inside the 8 px edge margin while the camera moves, without hiding them", () => {
    const entries = [entry("BLD_MOVE")];
    const { update, visibleSlots } = mount(entries);
    update({ points: new Map([["BLD_MOVE", { x: 300, y: 400, depth: 100, distance: 100 }]]) });
    expect(visibleSlots()).toHaveLength(1);
    // The anchor slides off the left edge mid-drag: the chip stays visible, pinned at x = 8, with a leader to the anchor.
    update({ motion: true, points: new Map([["BLD_MOVE", { x: -200, y: 400, depth: 100, distance: 100 }]]) });
    expect(visibleSlots()).toHaveLength(1);
    expect(visibleSlots()[0].style.transform).toMatch(/^translate3d\(8px,/);
  });

  it("keeps a moving chip 12 px clear of the HUD", () => {
    const entries = [entry("BLD_TOP")];
    const { update, visibleSlots } = mount(entries);
    const hud = { left: 0, top: 0, right: 1440, bottom: 60 };
    update({ chrome: [hud], points: new Map([["BLD_TOP", { x: 300, y: 400, depth: 100, distance: 100 }]]) });
    // Mid-drag the anchor slides up under the HUD: the chip is not hidden, it sits 12 px below the HUD.
    update({ motion: true, chrome: [hud], points: new Map([["BLD_TOP", { x: 300, y: 20, depth: 100, distance: 100 }]]) });
    const y = Number(visibleSlots()[0].style.transform.match(/translate3d\([^,]+,\s*(-?\d+)px/)[1]);
    expect(y).toBeGreaterThanOrEqual(hud.bottom + 12);
  });

  it("rewrites every chip when the camera stops, even when the settled layout equals the one before the move", () => {
    const entries = [entry("BLD_BACK")];
    const { update, visibleSlots } = mount(entries);
    const home = new Map([["BLD_BACK", { x: 300, y: 400, depth: 100, distance: 100 }]]);
    update({ points: home });
    const settled = visibleSlots()[0].style.transform;
    // Mid-move the anchor slides off the edge: the chip is pinned to the 8 px margin...
    update({ motion: true, points: new Map([["BLD_BACK", { x: -200, y: 400, depth: 100, distance: 100 }]]) });
    expect(visibleSlots()[0].style.transform).toMatch(/^translate3d\(8px,/);
    // ...and back home the same layout puts it back where it was.
    update({ points: home });
    expect(visibleSlots()[0].style.transform).toBe(settled);
  });

  it("marks an estimated name with the glyph, a dashed chip and 명칭 추정 in the accessible name", () => {
    const entries = [entry("BLD_SCNU_R1", { displayName: "부속 시설", estimatedName: true, tier: 3, code: null })];
    const { container, update } = mount(entries);
    update({ band: NEAR });
    const button = container.querySelector('[data-element-id="BLD_SCNU_R1"]');
    expect(button.querySelector('[data-qa="label-estimated-glyph"]')).toBeTruthy();
    expect(button.getAttribute("aria-label")).toBe("부속 시설, 명칭 추정");
  });

  it("names chips by code and full name, shows the one display name (not the preset short name), and passes keyboard clicks through with detail 0", () => {
    const onSelect = vi.fn();
    const entries = [entry("BLD_D4", { displayName: "공과대학 3호관", shortName: "공대 3호관", code: "D4" })];
    const { container, update } = mount(entries, { onSelect });
    update();
    const button = container.querySelector('[data-element-id="BLD_D4"]');
    expect(button.getAttribute("aria-label")).toBe("D4 공과대학 3호관");
    expect(button.textContent).toContain("공과대학 3호관");
    expect(button.textContent).not.toContain("공대 3호관");
    expect(button.closest("[data-label-slot]").dataset.occluded).toBe("false");
    fireEvent.click(button, { detail: 0 });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe("BLD_D4");
    expect(onSelect.mock.calls[0][1].detail).toBe(0);
  });

  it("clears the selection on Escape and hides every chip when the layer is hidden", () => {
    const onClear = vi.fn();
    const entries = [entry("BLD_A"), entry("BLD_B")];
    const { update, visibleSlots } = mount(entries, { selectedId: "BLD_A", onClear });
    update();
    expect(visibleSlots().length).toBe(2);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClear).toHaveBeenCalledTimes(1);
    update({ hidden: true });
    expect(visibleSlots()).toHaveLength(0);
  });

  it("folds a group into one cluster chip in the far band and hides chips under the panel", () => {
    const onSelectCluster = vi.fn();
    const entries = [
      entry("BLD_Dormitory_Building", { displayName: "학생생활관 1동", group: "dormitory" }),
      entry("BLD_Dormitory_Building.001", { displayName: "학생생활관 2동", group: "dormitory" }),
      entry("BLD_P", { displayName: "패널 밑" }),
    ];
    const { container, update, visibleSlots } = mount(entries, { onSelectCluster });
    const points = project(entries);
    // the third anchor sits under the panel rect
    const occluder = { left: 300, top: 0, right: 700, bottom: 900 };
    points.set("BLD_P", { x: 500, y: 400, depth: 50, distance: 50 });
    update({ points, occluder });
    const shown = visibleSlots().map((slot) => slot.dataset.labelSlot);
    expect(shown).toEqual(["GROUP_dormitory"]);
    const cluster = container.querySelector('[data-cluster="dormitory"]');
    expect(cluster.textContent).toContain("학생생활관 2동");
    fireEvent.click(cluster, { detail: 0 });
    expect(onSelectCluster.mock.calls[0][0].members).toEqual(["BLD_Dormitory_Building", "BLD_Dormitory_Building.001"]);
  });
});

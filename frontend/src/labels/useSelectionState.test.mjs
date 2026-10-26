import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INITIAL_SELECTION,
  isProximitySuspended,
  resolveSelectionTitle,
  selectionReducer,
} from "./useSelectionState.mjs";

const run = (...actions) => actions.reduce(selectionReducer, INITIAL_SELECTION);

describe("selectionReducer", () => {
  it("suspends proximity after a click, a preset or a search selection", () => {
    for (const source of ["click", "preset", "search"]) {
      const state = run({ type: "select", elementId: "BLD_C1", source });
      assert.equal(isProximitySuspended(state), true, source);
    }
  });

  it("does not suspend proximity for its own or a list selection, nor when nothing is selected", () => {
    assert.equal(isProximitySuspended(run({ type: "select", elementId: "BLD_C1", source: "proximity" })), false);
    assert.equal(isProximitySuspended(run({ type: "select", elementId: "BLD_C1", source: "list" })), false);
    assert.equal(isProximitySuspended(INITIAL_SELECTION), false);
  });

  it("releases proximity once the user starts a drag, keeping the selected building", () => {
    const state = run({ type: "select", elementId: "BLD_C1", source: "click" }, { type: "dragStart" });
    assert.deepEqual(state, { elementId: "BLD_C1", source: "drag" });
    assert.equal(isProximitySuspended(state), false);
  });

  it("releases proximity when the selection is cleared", () => {
    const state = run({ type: "select", elementId: "BLD_C1", source: "click" }, { type: "clear" });
    assert.deepEqual(state, INITIAL_SELECTION);
    assert.equal(isProximitySuspended(state), false);
  });

  it("a drag with nothing user-selected changes nothing", () => {
    const proximity = run({ type: "select", elementId: "BLD_E5", source: "proximity" });
    assert.equal(selectionReducer(proximity, { type: "dragStart" }), proximity);
  });

  it("confirm keeps the clicked anchor id (a proxy) and only sets the source", () => {
    const state = run(
      { type: "select", elementId: "BLD_SCNU_A6", source: "click" },
      { type: "confirm", elementId: "BLD_A6", source: "click" },
    );
    assert.deepEqual(state, { elementId: "BLD_SCNU_A6", source: "click" });
    assert.deepEqual(run({ type: "confirm", elementId: "BLD_E1", source: "click" }), { elementId: "BLD_E1", source: "click" });
  });

  it("an empty select clears", () => {
    assert.deepEqual(run({ type: "select", elementId: "BLD_C1", source: "click" }, { type: "select", elementId: "" }), INITIAL_SELECTION);
  });
});

describe("resolveSelectionTitle", () => {
  const registry = new Map([
    ["BLD_C1", { elementId: "BLD_C1", dataElementId: "BLD_C1", displayName: "도서관", tier: 1 }],
    ["BLD_SCNU_A6", { elementId: "BLD_SCNU_A6", dataElementId: "BLD_A6", displayName: "학생생활관 창조관", tier: 2 }],
    ["ZONE_library", { elementId: "ZONE_library", dataElementId: null, displayName: "도서관 일대", tier: 0 }],
  ]);
  const elementNames = new Map([["BLD_E1", "학생회관"]]);

  it("uses the registry name of the selected anchor", () => {
    assert.equal(resolveSelectionTitle(registry, "BLD_C1", elementNames), "도서관");
    assert.equal(resolveSelectionTitle(registry, "BLD_SCNU_A6", elementNames), "학생생활관 창조관");
  });

  it("finds the building behind a popup element id", () => {
    assert.equal(resolveSelectionTitle(registry, "BLD_A6", elementNames), "학생생활관 창조관");
  });

  it("falls back to the common element name before the registry exists, and to null", () => {
    assert.equal(resolveSelectionTitle(null, "BLD_E1", elementNames), "학생회관");
    assert.equal(resolveSelectionTitle(registry, "BLD_UNKNOWN", elementNames), null);
    assert.equal(resolveSelectionTitle(registry, null, elementNames), null);
  });
});

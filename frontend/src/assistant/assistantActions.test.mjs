import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAssistantAction, assistantContext } from "./assistantActions.mjs";
import { CAMERA_PRESETS } from "../camera/cameraPresets.mjs";

function dashboard(role = "student") {
  const calls = [];
  return {
    calls, role,
    flow: { selectFromUrl: (id) => calls.push(["select", id]) },
    camera: {
      flyToBuilding: (id) => calls.push(["fly", id]),
      selectPreset: (preset) => calls.push(["preset", preset]),
      goHome: () => calls.push(["home"]),
    },
    panelState: { reveal: () => calls.push(["reveal"]) },
    setActiveTab: (tab) => calls.push(["tab", tab]),
    clock: {
      snapToNow: () => calls.push(["live"]),
      setSceneMinuteOfDay: (minute) => calls.push(["minute", minute]),
    },
  };
}

test("focus selects the building before flying to it", () => {
  const ui = dashboard();
  applyAssistantAction({ action: "focus", target: "BLD_D4" }, ui);
  assert.deepEqual(ui.calls, [["select", "BLD_D4"], ["fly", "BLD_D4"]]);
});

test("the server's eight preset ids resolve to real camera presets", () => {
  const ids = ["overview", "gate", "d4", "engineering", "library", "life-science", "headquarters", "humanities"];
  assert.deepEqual(CAMERA_PRESETS.map(({ id }) => id), ids);
  for (const preset of CAMERA_PRESETS) {
    const ui = dashboard();
    applyAssistantAction({ action: "view", target: preset.id }, ui);
    assert.deepEqual(ui.calls, [["preset", preset]]);
  }
});

test("home and scene time actions use the dashboard camera and clock", () => {
  for (const [event, expected] of [
    [{ action: "home" }, [["home"]]],
    [{ action: "time", target: "live" }, [["live"]]],
    [{ action: "time", target: "09:35" }, [["minute", 575]]],
    [{ action: "time", target: "23:59" }, [["minute", 1439]]],
  ]) {
    const ui = dashboard();
    applyAssistantAction(event, ui);
    assert.deepEqual(ui.calls, expected);
  }
});

test("tab actions reveal permitted panels for each role", () => {
  for (const role of ["student", "admin"]) {
    for (const target of ["building", "status", "energy", "simulation"]) {
      const ui = dashboard(role);
      const allowed = role === "admin" || ["building", "status"].includes(target);
      assert.equal(applyAssistantAction({ action: "tab", target }, ui), allowed);
      assert.deepEqual(ui.calls, allowed ? [["tab", target], ["reveal"]] : []);
    }
  }
});

test("malformed or unknown client actions never call dashboard methods", () => {
  for (const event of [null, {}, { action: "focus", target: "RD_1" }, { action: "view", target: "missing" }, { action: "time", target: "24:00" }, { action: "tab", target: "assistant" }, { action: "write" }]) {
    const ui = dashboard();
    assert.equal(applyAssistantAction(event, ui), false);
    assert.deepEqual(ui.calls, []);
  }
});

test("message context reports KST time, current selection, view and scene clock", () => {
  const state = { selection: { selectedId: "BLD_D4" }, activeTab: "status", flow: { buildingViewMode: "campus" }, clock: { mode: "simulation", sceneMinuteOfDay: 575 } };
  assert.deepEqual(assistantContext(state, new Date("2026-11-25T00:32:00Z")), {
    t: "2026-11-25T09:32+09:00", sel: "BLD_D4", tab: "status", view: "campus", clock: "09:35",
  });
  assert.equal(assistantContext({ ...state, clock: { mode: "live" } }).clock, "live");
});

import assert from "node:assert/strict";
import test from "node:test";
import { TAB_ROLES, openPanel, openTab, pickTabValue, tabCandidates } from "./tabs.mjs";

test("roles list the contract C4 value first and the dev-era value as the fallback", () => {
  assert.deepEqual(tabCandidates("environment"), ["simulation", "environment"]);
  assert.deepEqual(tabCandidates("home"), ["status", "dashboard"]);
  assert.deepEqual(tabCandidates("parking"), ["status", "parking_safety"]);
  assert.deepEqual(tabCandidates("energy"), ["energy"]);
  assert.deepEqual(TAB_ROLES.building, ["building"]);
});

test("a literal dev-era value resolves to itself first, then through its role", () => {
  assert.deepEqual(tabCandidates("dashboard"), ["dashboard", "status"]);
  assert.deepEqual(tabCandidates("parking_safety"), ["parking_safety", "status"]);
  assert.deepEqual(tabCandidates("unknown_tab"), ["unknown_tab"]);
});

test("pickTabValue takes the first candidate the page carries", () => {
  const dev = ["dashboard", "parking_safety", "energy", "environment"];
  const next = ["building", "status", "energy", "simulation"];
  assert.equal(pickTabValue("environment", dev), "environment");
  assert.equal(pickTabValue("environment", next), "simulation");
  assert.equal(pickTabValue("parking", dev), "parking_safety");
  assert.equal(pickTabValue("parking", next), "status");
  assert.equal(pickTabValue("building", dev), null);
});

// A fake browser: `page` is the panel state panelState() reads, `visible` the selectors center() finds.
function fakeCtx({ page, visible }) {
  const taps = [];
  return {
    taps,
    b: {
      run: async () => page,
      center: async (selector) => (visible.includes(selector) ? [10, 10] : null),
      tap: async (selector) => {
        taps.push(selector);
        return { ok: true, action: `click ${selector}` };
      },
    },
  };
}

test("openPanel clicks the current tab's hook, not 패널 열기, when the rail shows it", async () => {
  const ctx = fakeCtx({
    page: { values: ["dashboard", "energy"], active: "dashboard", open: false },
    visible: ["[data-qa=dashboard-tab-dashboard]", '[aria-label="패널 열기"]'],
  });
  const action = await openPanel(ctx);
  assert.deepEqual(ctx.taps, ["[data-qa=dashboard-tab-dashboard]"]);
  assert.match(action, /via click \[data-qa=dashboard-tab-dashboard\]/);
});

test("openPanel falls back to 패널 열기 when no tab hook is visible (phone sheet at peek)", async () => {
  const ctx = fakeCtx({ page: { values: ["dashboard"], active: "dashboard", open: false, detent: "peek" }, visible: ['[aria-label="패널 열기"]'] });
  const action = await openPanel(ctx);
  assert.deepEqual(ctx.taps, ['[aria-label="패널 열기"]']);
  assert.match(action, /fallback/);
});

test("openPanel does nothing when the panel is open, and reports a missing hook", async () => {
  const open = fakeCtx({ page: { values: ["dashboard"], active: "dashboard", open: true }, visible: [] });
  assert.equal(await openPanel(open), "panel already open");
  assert.deepEqual(open.taps, []);
  const none = fakeCtx({ page: { values: [], active: null, open: false }, visible: [] });
  assert.match(await openPanel(none), /^NOT FOUND/);
});

test("openTab taps the resolved value and fails loudly when no candidate exists", async () => {
  const ctx = fakeCtx({ page: { values: ["dashboard", "environment"], active: "dashboard", open: true }, visible: ["[data-qa=dashboard-tab-environment]"] });
  const picked = await openTab(ctx, "environment");
  assert.equal(picked.ok, true);
  assert.equal(picked.value, "environment");
  assert.deepEqual(ctx.taps, ["[data-qa=dashboard-tab-environment]"]);
  const missing = await openTab(ctx, "building");
  assert.equal(missing.ok, false);
  assert.match(missing.action, /NOT FOUND tab building/);
});

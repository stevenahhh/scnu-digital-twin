// Hook-based panel navigation. Every tab pick goes through a role, and each role lists the tab values it may carry:
// the contract C4 value first (`building`, `status`, `energy`, `simulation`), then the dev-era value it replaces. A state
// keeps working while todo 4 renames the tabs, and it fails loudly (NOT FOUND) when neither value is in the page.
// The panel opens through the current tab's own `[data-qa^=dashboard-tab-]` hook (the desktop rail icon or the panel tab),
// with the `패널 열기` button only as the fallback for a shell that has no visible tab hook (the phone sheet at peek).
import { sleep } from "./browser.mjs";

export const TAB_ROLES = Object.freeze({
  building: Object.freeze(["building"]),
  // S09 dashboard -> status: the home/overview tab.
  home: Object.freeze(["status", "dashboard"]),
  // S13 parking_safety -> status: parking and safety cards move into 현황.
  parking: Object.freeze(["status", "parking_safety"]),
  energy: Object.freeze(["energy"]),
  // S08 environment -> simulation: the environment simulation tab.
  environment: Object.freeze(["simulation", "environment"]),
  // IS-26/IS-27: the tab that hosts the traffic simulation panel (contract C5), wherever it lives.
  traffic: Object.freeze(["simulation", "parking_safety", "status"]),
});

// A dev-era tab value used literally (checks written against the old tab ids) resolves through the role it maps to.
const VALUE_ROLE = Object.freeze({ dashboard: "home", parking_safety: "parking", environment: "environment", energy: "energy", status: "home", simulation: "environment", building: "building" });

export const PANEL_OPEN_FALLBACK = '[aria-label="패널 열기"]';

// Candidate tab values for a role name or a literal tab value (the literal itself first).
export function tabCandidates(name) {
  if (TAB_ROLES[name]) return [...TAB_ROLES[name]];
  const role = VALUE_ROLE[name];
  return role ? [...new Set([name, ...TAB_ROLES[role]])] : [name];
}

// The first candidate that the page carries, or null.
export function pickTabValue(name, presentValues) {
  return tabCandidates(name).find((value) => presentValues.includes(value)) ?? null;
}

export const tabSelector = (value) => `[data-qa=dashboard-tab-${value}]`;

// Page facts the navigation needs: the tab values present, the active one, and whether the panel shows its content.
export async function panelState(b) {
  return b.run(() => {
    const tabs = [...document.querySelectorAll("[data-qa^=dashboard-tab-]")];
    const values = [...new Set(tabs.map((el) => el.getAttribute("data-qa").replace("dashboard-tab-", "")))];
    const activeEl = tabs.find((el) => el.getAttribute("aria-selected") === "true") ?? tabs.find((el) => el.getAttribute("aria-current") === "page");
    const panel = document.querySelector("[data-qa=dashboard-panel]");
    const detent = panel?.getAttribute("data-detent") ?? null;
    const open = panel ? (detent ? detent !== "peek" : panel.getAttribute("data-open") === "true") : false;
    return { values, active: activeEl ? activeEl.getAttribute("data-qa").replace("dashboard-tab-", "") : null, open, detent };
  });
}

// Opens the panel on its current tab. Returns the action taken (for the state's action log).
export async function openPanel(ctx) {
  const state = await panelState(ctx.b);
  if (state.open) return "panel already open";
  if (state.active && await ctx.b.center(tabSelector(state.active))) {
    const result = await ctx.b.tap(tabSelector(state.active));
    await sleep(1200);
    return `open panel via ${result.action}`;
  }
  if (await ctx.b.center(PANEL_OPEN_FALLBACK)) {
    const result = await ctx.b.tap(PANEL_OPEN_FALLBACK);
    await sleep(1200);
    return `open panel via fallback ${result.action}`;
  }
  return "NOT FOUND panel open hook (no visible current tab, no 패널 열기)";
}

// Selects the tab for a role (or literal value), opening the panel first when the tab hook is not reachable.
// Returns { ok, value, action }.
export async function openTab(ctx, name) {
  let state = await panelState(ctx.b);
  const value = pickTabValue(name, state.values);
  if (!value) return { ok: false, value: null, action: `NOT FOUND tab ${name} (candidates ${tabCandidates(name).join("/")}; page has ${state.values.join(",") || "none"})` };
  const selector = tabSelector(value);
  const actions = [];
  if (state.active === value && state.open) return { ok: true, value, action: `tab ${value} already selected` };
  if (!(await ctx.b.center(selector))) {
    actions.push(await openPanel(ctx));
    state = await panelState(ctx.b);
    if (state.active === value && state.open) return { ok: true, value, action: actions.join("; ") };
  }
  const result = await ctx.b.tap(selector);
  actions.push(result.action);
  return { ok: result.ok, value, action: actions.join("; ") };
}

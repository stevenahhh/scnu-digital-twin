import assert from "node:assert/strict";
import test from "node:test";
import { decodeViewState, encodeViewState, normalizeSearch } from "./urlState.mjs";

const KNOWN = ["BLD_C1", "BLD_D4"];

test("round trip keeps every field", () => {
  const state = {
    building: "BLD_D4", floor: 6, room: "601", minute: 720, date: "2026-10-26", mode: "simulation",
    camera: { position: [10.2, 260, -30.5], target: [0, 0, 1.1] }, panelOpen: true, tab: "energy",
  };
  const search = encodeViewState(state);
  assert.deepEqual(decodeViewState(search, { knownIds: KNOWN }), state);
});

test("invalid fields are dropped and only valid ones come back", () => {
  const decoded = decodeViewState("?b=BLD_NOPE&t=9999&cam=NaN,1,2,3,4,5&tab=evil&d=2026-02-30&m=fake&p=x&f=6", { knownIds: KNOWN });
  assert.deepEqual(decoded, {});
  assert.deepEqual(decodeViewState("?b=BLD_C1&t=1439&d=2026-10-26", { knownIds: KNOWN }), { building: "BLD_C1", minute: 1439, date: "2026-10-26" });
  assert.deepEqual(decodeViewState("?cam=1,2,3,4,5", {}), {});
  assert.deepEqual(decodeViewState("?cam=1,2,,4,5,6", {}), {});
});

test("pre-redesign tab values open the tab their content moved to", () => {
  assert.deepEqual(decodeViewState("?tab=dashboard"), { tab: "status" });
  assert.deepEqual(decodeViewState("?tab=parking_safety"), { tab: "status" });
  assert.deepEqual(decodeViewState("?tab=environment"), { tab: "simulation" });
  assert.deepEqual(decodeViewState("?tab=constructor"), {});
});

test("unrelated params such as model=uni are preserved untouched", () => {
  const next = encodeViewState({ building: "BLD_C1", minute: 60 }, "?model=uni&ui=gallery&sheet=half&b=BLD_D4");
  const params = new URLSearchParams(next);
  assert.equal(params.get("model"), "uni");
  assert.equal(params.get("ui"), "gallery");
  assert.equal(params.get("sheet"), "half");
  assert.equal(params.get("b"), "BLD_C1");
  assert.equal(normalizeSearch("?model=uni&b=BLD_NOPE&t=9999&tab=evil", { knownIds: KNOWN }), "?model=uni");
});

test("camera is written at 0.1 precision", () => {
  const search = encodeViewState({ camera: { position: [1.234, -5.678, 100.04], target: [0.05, 0, -0.04] } });
  assert.equal(new URLSearchParams(search).get("cam"), "1.2,-5.7,100,0.1,0,0");
});

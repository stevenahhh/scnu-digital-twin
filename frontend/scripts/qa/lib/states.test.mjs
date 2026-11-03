import assert from "node:assert/strict";
import test from "node:test";
import { CHAIN_IDS, S17_SUBSTATES, STATES, STATE_IDS, VWORLD_STATE_IDS, parseStateList } from "./states.mjs";

test("state table holds S01..S17 in order, each with steps", () => {
  assert.deepEqual(STATES.map((state) => state.id), STATE_IDS);
  assert.equal(STATE_IDS.length, 17);
  for (const state of STATES) {
    assert.equal(typeof state.steps, "function", state.id);
    assert.match(state.name, /^[A-Za-z0-9-]+$/, state.id);
    if (state.after) assert.equal(typeof state.after, "function", state.id);
  }
  assert.deepEqual(CHAIN_IDS, STATE_IDS.slice(0, 15));
  assert.deepEqual(VWORLD_STATE_IDS, STATE_IDS.slice(0, 12));
  assert.deepEqual(S17_SUBSTATES, ["S01", "S04", "S06", "S08", "S13"]);
  assert.equal(STATES.find((state) => state.id === "S16").forcedTheme, "light");
  assert.equal(typeof STATES.find((state) => state.id === "S11").after, "function", "S11 releases the held drag after capture");
});

test("state lists accept ranges, lists and GALLERY; unknown ids throw", () => {
  assert.deepEqual(parseStateList("S01..S17"), STATE_IDS);
  assert.deepEqual(parseStateList("S11,S01,S04"), ["S01", "S04", "S11"]);
  assert.deepEqual(parseStateList("S03..S05"), ["S03", "S04", "S05"]);
  assert.deepEqual(parseStateList("GALLERY"), ["GALLERY"]);
  assert.deepEqual(parseStateList(undefined), STATE_IDS);
  assert.throws(() => parseStateList("S18"), /unknown state/);
  assert.throws(() => parseStateList("S05..S02"), /unknown state range/);
});

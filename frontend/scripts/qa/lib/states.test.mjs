import assert from "node:assert/strict";
import test from "node:test";
import { CHAIN_IDS, MAIN_ONLY_STATE_IDS, S17_SKIPPED_IDS, S17_SUBSTATES, STATES, STATE_IDS, VWORLD_STATE_IDS, parseStateList } from "./states.mjs";

test("state table holds S01..S17 plus S09E, S12E, S18 (ideal-state 6.1), each with steps", () => {
  assert.deepEqual(STATES.map((state) => state.id), STATE_IDS);
  assert.equal(STATE_IDS.length, 20);
  assert.deepEqual(STATE_IDS.slice(17), ["S09E", "S12E", "S18"]);
  for (const state of STATES) {
    assert.equal(typeof state.steps, "function", state.id);
    assert.match(state.name, /^[A-Za-z0-9-]+$/, state.id);
    if (state.after) assert.equal(typeof state.after, "function", state.id);
  }
  // S18 forks from S01, S09E from S09 and S12E from S12; each is replayed only when requested (optional).
  assert.deepEqual(CHAIN_IDS, ["S01", "S18", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S09E", "S10", "S11", "S12", "S12E", "S13", "S14", "S15"]);
  for (const id of ["S09E", "S12E", "S18"]) assert.equal(STATES.find((state) => state.id === id).optional, true, id);
  // VWorld replays every chained state but the Main-only roof editor, including S13, S14 and the new states.
  assert.deepEqual(MAIN_ONLY_STATE_IDS, ["S15", "S16"]);
  assert.deepEqual(VWORLD_STATE_IDS, CHAIN_IDS.filter((id) => id !== "S15"));
  for (const id of ["S13", "S14", "S09E", "S12E", "S18"]) assert.ok(VWORLD_STATE_IDS.includes(id), id);
  for (const id of ["S09", "S10", "S11", "S12", "S09E", "S12E", "S18"]) assert.ok(S17_SKIPPED_IDS.includes(id), id);
  assert.deepEqual(S17_SUBSTATES, ["S01", "S04", "S06", "S08", "S13"]);
  assert.equal(STATES.find((state) => state.id === "S16").forcedTheme, "light");
  assert.equal(typeof STATES.find((state) => state.id === "S11").after, "function", "S11 releases the held drag after capture");
});

test("state lists accept ranges, lists and GALLERY; unknown ids throw", () => {
  assert.deepEqual(parseStateList("S01..S17"), STATE_IDS.slice(0, 17));
  assert.deepEqual(parseStateList("S18,S09E"), ["S09E", "S18"]);
  assert.deepEqual(parseStateList("S11,S01,S04"), ["S01", "S04", "S11"]);
  assert.deepEqual(parseStateList("S03..S05"), ["S03", "S04", "S05"]);
  assert.deepEqual(parseStateList("GALLERY"), ["GALLERY"]);
  assert.deepEqual(parseStateList(undefined), STATE_IDS);
  assert.throws(() => parseStateList("S19"), /unknown state/);
  assert.throws(() => parseStateList("S05..S02"), /unknown state range/);
});

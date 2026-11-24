import assert from "node:assert/strict";
import test from "node:test";
import { createModelEditStore, parseEditDocument } from "./modelEditStore.mjs";

const moved = { position: [1, 2, 3], quaternion: [0, 0, 0, 1], scale: [2, 2, 2] };
const turned = { position: [1, 2, 3], quaternion: [0, 1, 0, 0], scale: [1, 1, 1] };
const saved = { version: 1, revision: 4, updated_at: "2026-11-24T00:00:00Z", updated_by: "admin",
  transforms: { OC0101: moved }, removed: ["SD-1"], added: [] };

test("a server document reads into a draft and anything malformed falls back to an empty one", () => {
  assert.deepEqual(parseEditDocument(saved), { revision: 4, transforms: { OC0101: moved }, removed: ["SD-1"], added: [] });
  assert.deepEqual(parseEditDocument(null), { revision: 0, transforms: {}, removed: [], added: [] });
  const broken = parseEditDocument({ revision: 2, transforms: { A: { position: [1] }, B: moved }, removed: ["X", 3], added: [{ id: "ADD_1" }] });
  assert.deepEqual(broken, { revision: 2, transforms: { B: moved }, removed: ["X"], added: [] });
});

test("moves, removals and additions build the document to save, and undo/redo walk them back", () => {
  const store = createModelEditStore({ newId: () => "ADD_t1" });
  store.load(saved);
  store.commitTransform("OC0102", turned);
  store.remove("OC0101");
  const id = store.add("Trees_pine#2", moved);
  assert.equal(id, "ADD_t1");
  assert.equal(store.getState().selection, "ADD_t1");
  assert.deepEqual(store.toDocument(), {
    revision: 4,
    transforms: { OC0101: moved, OC0102: turned },
    removed: ["SD-1", "OC0101"],
    added: [{ id: "ADD_t1", prototype: "Trees_pine#2", ...moved }],
  });
  assert.equal(store.getState().dirty, true);

  store.undo();
  store.undo();
  assert.deepEqual(store.getState().draft.removed, ["SD-1"]);
  assert.deepEqual(store.getState().draft.added, []);
  store.redo();
  assert.deepEqual(store.getState().draft.removed, ["SD-1", "OC0101"]);
});

test("removing an added object drops it, restoring brings a removed one back, reset drops the move", () => {
  const store = createModelEditStore({ newId: () => "ADD_x" });
  store.load(saved);
  store.add("OC0101", moved);
  store.commitTransform("ADD_x", turned);
  assert.deepEqual(store.getState().draft.added, [{ id: "ADD_x", prototype: "OC0101", ...turned }]);
  store.remove("ADD_x");
  assert.deepEqual(store.getState().draft.added, []);
  assert.equal(store.getState().selection, null);
  store.restore("SD-1");
  assert.deepEqual(store.getState().draft.removed, []);
  store.resetTransform("OC0101");
  assert.deepEqual(store.getState().draft.transforms, {});
});

test("saving clears the dirty flag and takes the server revision; a new change starts a fresh history", () => {
  const store = createModelEditStore();
  store.load(saved);
  store.commitTransform("OC0101", turned);
  store.markSaved({ ...saved, revision: 5, transforms: { OC0101: turned } });
  const state = store.getState();
  assert.equal(state.dirty, false);
  assert.equal(state.draft.revision, 5);
  assert.equal(state.canUndo, false);
  store.discard();
  assert.deepEqual(store.getState().draft.transforms, { OC0101: turned });
});

test("listeners hear every change and a no-op selection does not notify", () => {
  const store = createModelEditStore();
  let calls = 0;
  const stop = store.subscribe(() => { calls += 1; });
  store.select("A");
  store.select("A");
  store.setMode("rotate");
  stop();
  store.setMode("scale");
  assert.equal(calls, 2);
  assert.equal(store.getState().mode, "scale");
});

test("leaving edit mode drops the selection but keeps the unsaved draft", () => {
  const store = createModelEditStore();
  store.setEditing(true);
  store.commitTransform("OC0101", moved);
  store.select("OC0101");
  store.setEditing(false);
  assert.equal(store.getState().selection, null);
  assert.equal(store.getState().dirty, true);
  assert.deepEqual(store.getState().draft.transforms, { OC0101: moved });
});

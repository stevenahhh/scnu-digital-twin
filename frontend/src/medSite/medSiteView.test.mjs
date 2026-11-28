// The scene switch between the campus and the planned medical-school site: one shared flag that notifies its
// subscribers only when it changes.
import assert from "node:assert/strict";
import test from "node:test";
import { createMedSiteView } from "./medSiteView.mjs";

test("starts on the campus and notifies on each real change", () => {
  const view = createMedSiteView();
  let calls = 0;
  const stop = view.subscribe(() => { calls += 1; });
  assert.equal(view.isActive(), false);
  view.setActive(true);
  view.setActive(true);
  assert.equal(view.isActive(), true);
  assert.equal(calls, 1);
  view.toggle();
  assert.equal(view.isActive(), false);
  assert.equal(calls, 2);
  stop();
  view.toggle();
  assert.equal(calls, 2);
});

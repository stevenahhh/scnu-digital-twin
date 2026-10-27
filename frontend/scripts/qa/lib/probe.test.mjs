import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { pageProbeSource } from "./probe.mjs";

// Markup shaped like CampusLabelLayer + SceneLabel output: a leader svg before each slot, the slot div, the chip button
// with the code as a StatusBadge, the name, and the hover value (hidden until hover).
function page({ leaderVisible }) {
  const dom = new JSDOM(`<!doctype html><body><div data-qa="campus-label-layer">
    <svg data-qa="label-leader" style="visibility:${leaderVisible ? "visible" : "hidden"}"><line></line><circle data-qa="label-anchor-dot"></circle></svg>
    <div data-label-slot="BLD_C1" data-anchor-top="420">
      <button data-qa="campus-label" aria-pressed="true"><span data-qa="label-chip">
        <span data-qa="status-badge">C1</span>
        <span>도서관</span>
        <span data-qa="label-value" class="hidden">추정 21.0°C</span>
      </span></button>
    </div>
    <button data-qa="campus-label" id="plain"><span data-qa="label-chip"><span>학생생활관 5동</span></span></button>
  </div></body>`, { runScripts: "outside-only" });
  dom.window.eval(pageProbeSource());
  return dom.window;
}

test("chipName drops the code badge and the hidden value, chips without a code keep their text", () => {
  const window = page({ leaderVisible: false });
  const [library, plain] = window.document.querySelectorAll("button[data-qa=campus-label]");
  assert.equal(window.__qa.chipName(library), "도서관");
  assert.equal(window.__qa.chipName(plain), "학생생활관 5동");
  // The raw chip text still carries the code: the reason chipByText("도서관") never matched before.
  assert.match(library.textContent.replace(/\s+/g, " ").trim(), /^C1 도서관/);
});

test("leaderOf finds the slot's sibling leader only while it is shown", () => {
  const hidden = page({ leaderVisible: false });
  assert.equal(hidden.__qa.leaderOf(hidden.document.querySelector("button")), null);
  const shown = page({ leaderVisible: true });
  assert.equal(shown.__qa.leaderOf(shown.document.querySelector("button"))?.getAttribute("data-qa"), "label-leader");
  // A chip outside a slot (no layer leader) has none.
  assert.equal(shown.__qa.leaderOf(shown.document.getElementById("plain")), null);
});

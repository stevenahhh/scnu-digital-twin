import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { contrastAgainst, meanLuminance, pageProbeSource } from "./probe.mjs";

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


test("contrast is measured against the dominant backdrop, not the anti-aliased glyph edges", () => {
  // 20 x 10 px of #5e6ad2 with a white glyph stroke and a ring of half-blended edge pixels around it.
  const width = 20; const height = 10; const pixels = new Uint8Array(width * height * 4);
  const put = (x, y, [r, g, b]) => { const i = (y * width + x) * 4; pixels.set([r, g, b, 255], i); };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) put(x, y, [94, 106, 210]);
  for (let x = 2; x < 18; x += 1) { put(x, 5, [255, 255, 255]); put(x, 4, [175, 180, 232]); put(x, 6, [175, 180, 232]); }
  const ratio = contrastAgainst({ width, height, channels: 4, pixels }, { x: 0, y: 0, w: width, h: height }, 1, "rgb(255, 255, 255)");
  assert.ok(Math.abs(ratio - 4.69) < 0.05, `ratio ${ratio}`);
});

test("meanLuminance stays the plain mean of the box", () => {
  const width = 2; const height = 1; const pixels = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]);
  const mean = meanLuminance({ width, height, channels: 4, pixels }, { x: 0, y: 0, w: 2, h: 1 }, 1);
  const black = meanLuminance({ width: 1, height: 1, channels: 4, pixels: new Uint8Array([0, 0, 0, 255]) }, { x: 0, y: 0, w: 1, h: 1 }, 1);
  const white = meanLuminance({ width: 1, height: 1, channels: 4, pixels: new Uint8Array([255, 255, 255, 255]) }, { x: 0, y: 0, w: 1, h: 1 }, 1);
  assert.ok(mean > black && mean < white);
});

test("activeTab reads the desktop rail's icon-only tab (aria-current, aria-label) as the open section", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <button data-qa="dashboard-tab-dashboard" aria-label="기본 현황" aria-current="page"><svg></svg></button>
    <button data-qa="dashboard-tab-energy" aria-label="에너지"><svg></svg></button>
  </body>`, { runScripts: "outside-only" });
  dom.window.eval(pageProbeSource());
  assert.equal(dom.window.__qa.activeTab(), "기본 현황");
});

test("activeTab names a selected tab with no visible text (collapsed panel) by its text content", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <div style="display:none"><button data-qa="dashboard-tab-dashboard" role="tab" aria-selected="true">기본 현황</button></div>
  </body>`, { runScripts: "outside-only" });
  dom.window.eval(pageProbeSource());
  assert.equal(dom.window.__qa.activeTab(), "기본 현황");
});

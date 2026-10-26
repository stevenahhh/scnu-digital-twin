import assert from "node:assert/strict";
import test from "node:test";

import { DASH_BY_KIND, LINE_WIDTH_M_BY_KIND, crossingWidthWarning, dashPieces, lineWidthFor, stopLineWidth } from "./markings.mjs";

test("line widths follow the statute per kind", () => {
  assert.equal(lineWidthFor("centre_line_yellow"), 0.15);
  assert.equal(lineWidthFor("edge_line"), 0.15);
  assert.equal(lineWidthFor("lane_line_solid"), 0.125);
  assert.equal(lineWidthFor("lane_line_dashed"), 0.125);
  assert.equal(lineWidthFor("parking_line"), 0.1);
  assert.equal(LINE_WIDTH_M_BY_KIND.kerb_no_parking, 0.15);
});

test("stop lines are clamped into the urban 0.30-0.45 m range and flagged", () => {
  assert.deepEqual(stopLineWidth(0.6), { width: 0.45, clamped: true, defaulted: false });
  assert.deepEqual(stopLineWidth(0.2), { width: 0.3, clamped: true, defaulted: false });
  assert.deepEqual(stopLineWidth(1.2), { width: 0.45, clamped: true, defaulted: false });
  assert.deepEqual(stopLineWidth(0.38), { width: 0.38, clamped: false, defaulted: false });
  assert.deepEqual(stopLineWidth(undefined), { width: 0.4, clamped: false, defaulted: true });
});

test("an estimated 16 m lane dash becomes two 3 m dashes with 5 m gaps and a remainder", () => {
  assert.deepEqual(DASH_BY_KIND.lane_line_dashed, [3, 5]);
  const pieces = dashPieces(16, "lane_line_dashed");
  assert.deepEqual(pieces, [[0, 3], [8, 11]]);
  assert.ok(16 - pieces.at(-1)[1] > 0, "a remainder is left undrawn");
  assert.deepEqual(dashPieces(12, "centre_line_yellow"), [[0, 3], [6, 9]]);
});

test("crossing width warnings below 4.0 m and at 6.0 m or more without a split, none at 4.5 m", () => {
  assert.equal(crossingWidthWarning("Z1", 3.5), "crossing Z1 width 3.50 m < 4.0 m (설치 기준, 경고)");
  assert.equal(crossingWidthWarning("Z2", 3.0), "crossing Z2 width 3.00 m < 4.0 m (설치 기준, 경고)");
  assert.match(crossingWidthWarning("Z3", 6.5), /width 6\.50 m >= 6\.0 m without a split/);
  assert.equal(crossingWidthWarning("Z3", 6.5, { split: true }), null);
  assert.equal(crossingWidthWarning("Z4", 4.5), null);
});

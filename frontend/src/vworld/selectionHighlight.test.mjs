import assert from "node:assert/strict";
import test from "node:test";
import { DIM_MODULATE, createVWorldSelectionHighlight } from "./selectionHighlight.mjs";

function fakeCesium() {
  class Color { constructor(r, g, b, a) { Object.assign(this, { r, g, b, a }); } withAlpha(a) { return Object.assign(new Color(this.r, this.g, this.b, a), { hex: this.hex }); } }
  Color.WHITE = new Color(1, 1, 1, 1);
  Color.fromCssColorString = (hex) => Object.assign(new Color(0, 0, 0, 1), { hex });
  class Cartesian3 { constructor(x, y, z) { Object.assign(this, { x, y, z }); } }
  return {
    // Cesium의 실제 열거값(HIGHLIGHT·REPLACE·MIX)만 둔다: 없는 이름을 쓰면 undefined가 되어 아래 검사가 실패한다.
    Color, Cartesian3, ColorBlendMode: Object.freeze({ HIGHLIGHT: 0, REPLACE: 1, MIX: 2 }),
    Matrix4: class { static multiply(a, b) { return { a, b }; } static fromTranslation(t) { return { t }; } },
    Primitive: class { constructor(o) { this.options = o; } },
    GeometryInstance: class { constructor(o) { Object.assign(this, o); } },
    BoxGeometry: { fromDimensions: (o) => o },
    PerInstanceColorAppearance: class { static VERTEX_FORMAT = "vf"; constructor(o) { this.options = o; } },
    ColorGeometryInstanceAttribute: { fromColor: (c) => c },
  };
}

function setup({ matrix = "m" } = {}) {
  const added = [];
  const scene = { primitives: { add: (p) => (added.push(p), p), remove: (p) => added.splice(added.indexOf(p), 1) }, requestRender: () => {} };
  const model = { color: null };
  const boxById = new Map([["BLD_C1", [[0, 0, 0], [10, 20, 30]]], ["BLD_A1", [[50, 0, 0], [60, 5, 10]]]]);
  const highlight = createVWorldSelectionHighlight({ Cesium: fakeCesium(), scene, getModel: () => model, getModelMatrix: () => matrix, boxById });
  return { highlight, added, model };
}

test("a selection dims the whole overlay by DIM_ALPHA and boxes the selected building in the accent", () => {
  const { highlight, added, model } = setup();
  highlight.set({ selectedId: "BLD_C1" });
  assert.equal(model.colorBlendMode, 0);
  assert.equal(model.color.r, DIM_MODULATE);
  assert.equal(added.length, 1);
  const box = added[0].options.geometryInstances;
  // Box size in model-local axes (glTF z, x, y): 30, 10, 20 plus the small margin.
  assert.deepEqual([box.geometry.dimensions.x, box.geometry.dimensions.y, box.geometry.dimensions.z], [30.6, 10.6, 20.4]);
  assert.equal(box.attributes.color.hex, "#5e6ad2");
});

test("hover adds a hover-colour box, clearing restores the overlay, nothing draws before the model matrix exists", () => {
  const { highlight, added, model } = setup();
  highlight.set({ hoveredId: "BLD_A1" });
  assert.equal(added.length, 1);
  assert.equal(model.color.r, 1);
  highlight.set({});
  assert.equal(added.length, 0);
  const early = setup({ matrix: null });
  early.highlight.set({ selectedId: "BLD_C1" });
  assert.equal(early.added.length, 0);
});

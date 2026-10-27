import { DIM_ALPHA, HOVER_HEX, SELECTION_HEX } from "../ui/sceneTokens.mjs";
import { sceneToModelLocal } from "./labelProjection.mjs";

// VWorld 캠퍼스 오버레이의 선택·호버 표시(Legacy CityModel과 같은 뜻): 선택이 있으면 오버레이 전체를 DIM_ALPHA만큼 어둡게 하고
// (화면 값 기준), 고른 건물은 경계 상자에 강조색 반투명 상자, 마우스를 올린 건물은 호버 색 상자를
// 겹친다. SDK 모델에는 건물별 재질이 없어(feature id 없음) 상자를 덧그린다. 상자는 오버레이 modelMatrix를 그대로 쓴다.
export const SELECTION_FILL_ALPHA = 0.5;
export const HOVER_FILL_ALPHA = 0.24;
// Cesium Model.color를 ColorBlendMode.HIGHLIGHT로 두면 모델 색에 곱한다(Legacy의 dimLinearChannel과 같은 결과).
// Cesium에는 HIGHLIGHT·REPLACE·MIX만 있다: 없는 이름(MODULATE)을 쓰면 undefined가 들어가 모델 전체가 검게 그려졌다.
export const DIM_MODULATE = 1 - DIM_ALPHA;

function boxPrimitive(Cesium, matrix, [min, max], hex, alpha) {
  const center = sceneToModelLocal([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]);
  const size = sceneToModelLocal([max[0] - min[0], max[1] - min[1], max[2] - min[2]]);
  const placement = Cesium.Matrix4.multiply(matrix, Cesium.Matrix4.fromTranslation(new Cesium.Cartesian3(...center)), new Cesium.Matrix4());
  return new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: Cesium.BoxGeometry.fromDimensions({
        // 지붕에 묻히지 않게 조금 키운다.
        dimensions: new Cesium.Cartesian3(size[0] + 0.6, size[1] + 0.6, size[2] + 0.4),
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      }),
      modelMatrix: placement,
      attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(hex).withAlpha(alpha)) },
    }),
    appearance: new Cesium.PerInstanceColorAppearance({ translucent: true, closed: true }),
    asynchronous: false,
  });
}

// boxById: Map(앵커 요소 id -> [min, max], 모델 좌표). getModel: 캠퍼스 오버레이 모델(없으면 null).
export function createVWorldSelectionHighlight({ Cesium, scene, getModel, getModelMatrix, boxById }) {
  let shown = [];
  let key = "";
  const clear = () => {
    for (const primitive of shown) scene.primitives.remove(primitive);
    shown = [];
  };
  const set = ({ selectedId = null, hoveredId = null } = {}) => {
    const matrix = getModelMatrix();
    const model = getModel();
    const next = `${selectedId}|${hoveredId}|${matrix ? "m" : ""}`;
    if (next === key) return;
    key = next;
    if (model) {
      model.colorBlendMode = Cesium.ColorBlendMode.HIGHLIGHT;
      model.color = selectedId ? new Cesium.Color(DIM_MODULATE, DIM_MODULATE, DIM_MODULATE, 1) : Cesium.Color.WHITE;
    }
    clear();
    if (!matrix) return;
    if (selectedId && boxById.has(selectedId)) shown.push(scene.primitives.add(boxPrimitive(Cesium, matrix, boxById.get(selectedId), SELECTION_HEX, SELECTION_FILL_ALPHA)));
    if (hoveredId && hoveredId !== selectedId && boxById.has(hoveredId)) {
      shown.push(scene.primitives.add(boxPrimitive(Cesium, matrix, boxById.get(hoveredId), HOVER_HEX, HOVER_FILL_ALPHA)));
    }
    scene.requestRender?.();
  };
  const dispose = () => {
    clear();
    const model = getModel();
    if (model && !model.isDestroyed?.()) model.color = Cesium.Color.WHITE;
    key = "";
  };
  return { set, dispose };
}

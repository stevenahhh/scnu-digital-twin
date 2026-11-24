import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { TransformControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { Box3, Box3Helper, BufferAttribute, BufferGeometry, Color, Matrix3, Object3D, Points, PointsMaterial, Raycaster, Vector2, Vector3 } from "three";
import { SELECTION_HEX } from "../ui/sceneTokens.mjs";
import { SCENE_UNITS_PER_METRE } from "../geo/epsg5186.mjs";
import { useFlyTo } from "../camera/useFlyTo.mjs";
import { createSceneEditor, recenterView } from "./sceneEditor.mjs";
import { editorRuntime, ensureModelEditsLoaded, modelEditStore } from "./modelEditsApi.mjs";

const CLICK_SLOP_PX = 5;
// 정점 모드에서 클릭이 정점을 고르는 화면 거리(px).
const VERTEX_PICK_PX = 16;
// 지면을 누른 클릭이 가느다란 시설물(난간·볼라드)을 고르는 반경: 1.5 m.
const NEAR_PICK_RADIUS = 1.5 * SCENE_UNITS_PER_METRE;
const DUPLICATE_OFFSET = 3 * SCENE_UNITS_PER_METRE;
const DOWN = new Vector3(0, -1, 0);
// 땅을 눌렀는데 근처에 작은 객체가 있으면 그쪽을 고른다(바닥 조각은 넓어서 다시 고르기 쉽다).
const SURFACE_CATEGORIES = new Set(["ground", "marking"]);

// 고정 그림자 지도(ShadowBaker)는 모델이 움직여도 다시 그리지 않는다. 편집이 장면에 반영되면 한 번 다시 굽는다.
function refreshShadows(gl, root) {
  gl.shadowMap.needsUpdate = true;
  root.traverse((object) => {
    if (object.isLight && object.castShadow && object.shadow) object.shadow.needsUpdate = true;
  });
}

// 캠퍼스 모델에 저장된 편집 내용을 입히고(학생·관리자 화면 모두), 관리자가 편집 모드를 켜면 고르기·기즈모를 연다.
// scene은 CityModel이 그리는 캠퍼스 GLB 장면이다. 이 컴포넌트는 재중심화 그룹 밖(월드 좌표)에 둔다: 선택 상자가 월드 좌표다.
export function ModelEditorScene({ scene, controlsRef }) {
  const { camera, gl, invalidate, scene: root } = useThree();
  const state = useSyncExternalStore(modelEditStore.subscribe, modelEditStore.getState);
  // 추가한 객체는 초안을 입힌 뒤(아래 effect)에야 entries에 생긴다. 그때 다시 그려 기즈모를 붙인다.
  useSyncExternalStore(editorRuntime.subscribe, editorRuntime.version);
  const editor = useMemo(() => createSceneEditor(scene), [scene]);
  const gizmoRef = useRef(null);
  const beforeRef = useRef(null);
  // 끌기 시작 때의 편집값과 모드. 끌리지 않는 채널(이동 중의 회전 등)은 이 값에서 다시 시작해 바닥 규칙이 누적되지 않게 한다.
  const dragStartRef = useRef(null);
  const { flyTo } = useFlyTo({ controlsRef });
  const [helper] = useState(() => {
    const box = new Box3Helper(new Box3(), new Color(SELECTION_HEX));
    box.raycast = () => {};
    return box;
  });
  const selected = state.editing && state.selection ? editor.entries.get(state.selection) ?? null : null;
  // 정점 모드: 고른 객체의 손잡이(같은 자리 정점 묶음)를 점으로 그리고, 고른 손잡이에 기즈모를 단다.
  const vertexState = state.vertexMode && selected && !selected.members ? editor.vertexState(selected.id) : null;
  const [vertexPick, setVertexPick] = useState(null);
  const [vertexHandle] = useState(() => new Object3D());
  const [vertexPoints] = useState(() => {
    const points = new Points(new BufferGeometry(), new PointsMaterial({ color: new Color(SELECTION_HEX), size: 6, sizeAttenuation: false, depthTest: false }));
    points.renderOrder = 10;
    points.raycast = () => {};
    return points;
  });
  const vertexDragRef = useRef(null);
  const worldOfGroup = (group) => new Vector3(...group.current).applyMatrix4(vertexState.node.matrixWorld);
  const drawVertices = () => {
    vertexPoints.visible = vertexState !== null;
    if (!vertexState) return;
    vertexState.node.updateWorldMatrix(true, false);
    const array = new Float32Array(vertexState.groups.length * 3);
    vertexState.groups.forEach((group, i) => worldOfGroup(group).toArray(array, i * 3));
    vertexPoints.geometry.setAttribute("position", new BufferAttribute(array, 3));
    vertexPoints.geometry.computeBoundingSphere();
    if (vertexPick !== null && vertexState.groups[vertexPick]) vertexHandle.position.copy(worldOfGroup(vertexState.groups[vertexPick]));
    invalidate();
  };

  useEffect(() => {
    ensureModelEditsLoaded();
  }, []);

  useEffect(() => {
    if (editor.apply(state.draft)) refreshShadows(gl, root);
    editorRuntime.applied();
    invalidate();
  }, [editor, state.draft, gl, root, invalidate]);

  useEffect(() => setVertexPick(null), [selected?.id, state.vertexMode]);
  useEffect(drawVertices, [vertexState, vertexPick, state.draft]);

  useEffect(() => {
    helper.visible = selected !== null;
    if (selected) editor.boundsOf(selected.id, helper.box);
    invalidate();
  }, [editor, helper, selected, state.draft, invalidate]);

  // 고른 객체로 카메라 중심을 옮긴다. 보는 방향과 거리(줌)는 그대로다.
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    const controls = controlsRef.current;
    if (!selectedId || !controls?.object) return;
    const center = editor.boundsOf(selectedId, new Box3()).getCenter(new Vector3()).toArray();
    flyTo({ id: "edit-focus", ...recenterView({ position: controls.object.position.toArray(), target: controls.target.toArray() }, center) });
  }, [selectedId, editor, controlsRef, flyTo]);

  // 화면 중앙(궤도 중심) 바로 밑의 지면. 편집 객체가 아닌 첫 표면이다.
  const groundUnder = (point) => {
    const ray = new Raycaster(new Vector3(point.x, point.y + 500, point.z), DOWN);
    ray.layers.enableAll();
    const hit = ray.intersectObject(scene, true).find((h) => h.object.visible && editor.pick([h]) === null && !h.object.userData.pickProxy);
    return hit ? hit.point : point;
  };

  useEffect(() => {
    editorRuntime.set({
      library: () => editor.library(),
      missingPrototypes: () => editor.missingPrototypes(),
      addAtView(prototype) {
        const target = controlsRef.current?.target ?? new Vector3();
        const point = groundUnder(target);
        return modelEditStore.add(prototype, editor.constrain(prototype, editor.placement(prototype, point.toArray()), { tilt: false }));
      },
      // 입력 칸에서 고친 값도 바닥 아래로는 내려가지 않는다(입력한 회전은 그대로 둔다).
      commit(id, transform) {
        modelEditStore.commitTransform(id, editor.constrain(id, transform, { tilt: false }));
      },
      duplicate(id) {
        const entry = editor.entries.get(id);
        const prototype = entry.prototype ?? id;
        const world = entry.target.getWorldPosition(new Vector3());
        world.x += DUPLICATE_OFFSET;
        const current = editor.readTransform(id);
        const placed = editor.placement(prototype, world.toArray());
        return modelEditStore.add(prototype, editor.constrain(prototype, { ...placed, quaternion: current.quaternion, scale: current.scale }, { tilt: false }));
      },
      describe: (id) => {
        const entry = editor.entries.get(id);
        return entry ? { id, kind: entry.kind, category: entry.category, added: entry.added === true, transform: entry.transform } : null;
      },
    });
    return () => editorRuntime.set(null);
  }, [editor, controlsRef]);

  // 편집 모드의 클릭: 누른 곳과 놓은 곳이 가까우면 그 자리 물체를 고른다. 기즈모를 잡은 누르기는 기즈모가 처리한다.
  useEffect(() => {
    if (!state.editing) return undefined;
    const canvas = gl.domElement;
    const raycaster = new Raycaster();
    raycaster.layers.enableAll();
    const ndc = new Vector2();
    let down = null;
    const onDown = (event) => {
      down = event.button === 0 && !gizmoRef.current?.axis ? { x: event.clientX, y: event.clientY } : null;
    };
    const onUp = (event) => {
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_SLOP_PX) return;
      down = null;
      const rect = canvas.getBoundingClientRect();
      ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (vertexState) {
        let best = null;
        let bestPx = VERTEX_PICK_PX;
        const p = new Vector3();
        vertexState.groups.forEach((group, i) => {
          p.copy(worldOfGroup(group)).project(camera);
          if (p.z > 1) return;
          const px = Math.hypot(((p.x + 1) / 2) * rect.width + rect.left - event.clientX, ((1 - p.y) / 2) * rect.height + rect.top - event.clientY);
          if (px < bestPx) { best = i; bestPx = px; }
        });
        if (best !== null) {
          setVertexPick(best);
          return;
        }
      }
      const hits = raycaster.intersectObject(scene, true);
      const ground = hits.find((hit) => hit.object.layers.mask !== 0 && hit.object.visible);
      const picked = editor.pick(hits);
      const near = ground ? editor.pickNear(ground.point.toArray(), NEAR_PICK_RADIUS) : null;
      const onSurface = picked === null || SURFACE_CATEGORIES.has(editor.entries.get(picked)?.category);
      modelEditStore.select(onSurface && near ? near : picked);
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
    };
  }, [state.editing, gl, camera, editor, scene, vertexState]);

  // 기즈모를 끄는 동안 궤도 조작을 멈춘다(drei는 makeDefault 조작기만 멈춘다).
  useEffect(() => {
    const gizmo = gizmoRef.current;
    if (!gizmo) return undefined;
    const onDragging = (event) => {
      if (controlsRef.current) controlsRef.current.enabled = !event.value;
    };
    gizmo.addEventListener("dragging-changed", onDragging);
    return () => {
      gizmo.removeEventListener("dragging-changed", onDragging);
      if (controlsRef.current) controlsRef.current.enabled = true;
    };
  }, [selected, vertexPick, controlsRef]);

  return (
    <>
      <primitive object={helper} />
      <primitive object={vertexPoints} />
      <primitive object={vertexHandle} />
      {vertexState && vertexPick !== null && (
        <TransformControls
          ref={gizmoRef}
          object={vertexHandle}
          mode="translate"
          size={0.6}
          onMouseDown={() => {
            vertexDragRef.current = { start: vertexHandle.position.clone(), group: vertexState.groups[vertexPick] };
          }}
          onObjectChange={() => {
            const drag = vertexDragRef.current;
            if (!drag) return;
            // 월드 이동량을 객체 노드 좌표로 돌려 미리 보기에 입힌다.
            const toNode = new Matrix3().setFromMatrix4(vertexState.node.matrixWorld).invert();
            drag.offset = vertexHandle.position.clone().sub(drag.start).applyMatrix3(toNode).toArray();
            editor.previewVertices(selected.id, [...(state.draft.vertices[selected.id] ?? []), { ...vertexState.keyOf(drag.group), offset: drag.offset }]);
            editor.boundsOf(selected.id, helper.box);
            drawVertices();
          }}
          onMouseUp={() => {
            const drag = vertexDragRef.current;
            vertexDragRef.current = null;
            if (drag?.offset && drag.offset.some((v) => Math.abs(v) > 1e-9)) {
              modelEditStore.moveVertex(selected.id, vertexState.keyOf(drag.group), drag.offset);
              refreshShadows(gl, root);
            }
          }}
        />
      )}
      {selected && !vertexState && (
        <TransformControls
          ref={gizmoRef}
          object={selected.target}
          mode={state.mode}
          size={0.8}
          onMouseDown={() => {
            const start = editor.readTransform(selected.id);
            beforeRef.current = JSON.stringify(start);
            dragStartRef.current = { start, mode: state.mode };
          }}
          onObjectChange={() => {
            const drag = dragStartRef.current;
            if (!drag) {
              editor.sync(selected.id);
            } else {
              const live = editor.readTransform(selected.id);
              const raw = {
                position: drag.mode === "translate" ? live.position : drag.start.position,
                quaternion: drag.mode === "rotate" ? live.quaternion : drag.start.quaternion,
                scale: drag.mode === "scale" ? live.scale : drag.start.scale,
              };
              editor.preview(selected.id, editor.constrain(selected.id, raw, { tilt: drag.mode === "translate" }));
            }
            editor.boundsOf(selected.id, helper.box);
          }}
          onMouseUp={() => {
            dragStartRef.current = null;
            const after = editor.readTransform(selected.id);
            if (JSON.stringify(after) !== beforeRef.current) {
              modelEditStore.commitTransform(selected.id, after);
              refreshShadows(gl, root);
            }
          }}
        />
      )}
    </>
  );
}

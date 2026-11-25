// 캠퍼스 모델 장면에 편집 초안(modelEditStore)을 입힌다. 편집 단위는 두 가지다.
// - 노드: 생성기가 객체마다 만든 노드(extras.editable = { id, kind, category }, GLTFLoader가 userData로 옮긴다).
//   노드의 위치·회전·크기가 곧 편집값이고, 원점은 객체 바닥 중심이다.
// - 나무 인스턴스: Trees_<종> 아래 인스턴스 메시(줄기·수관)의 같은 번호. id는 `Trees_<종>#<번호>`이고 편집값은
//   첫 인스턴스 메시 안에서의 그 인스턴스 행렬이다. 다른 멤버(수관)는 원래 상대 위치를 지킨다.
// 따라다니는 것(follower): 가로등의 빛 웅덩이 인스턴스(Lamps_pools.userData.lampIds), 건물의 선택 대리 프리즘(BLD_SCNU_*).
// 원래 월드 변환에서 객체가 움직인 만큼(월드 기준 차이) 같이 움직인다.
import { Box3, Color, Group, InstancedMesh, Matrix4, Object3D, Quaternion, Raycaster, Vector3 } from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { selectSupportPoints, settleOnGround } from "./groundContact.mjs";
import { applyVertexMoves, createVertexState } from "./vertexEditor.mjs";

const KIND_LABELS = Object.freeze({
  building: "건물", entrance: "출입구", fence: "펜스", bench: "벤치", planter: "화단", hedge: "생울타리",
  hedge_text: "생울타리 글자", signboard: "안내판", bollard: "볼라드", handrail: "난간", bin: "쓰레기통",
  bike_rack: "자전거 거치대", bike_stands: "자전거 보관대", bus_stop_shelter: "버스 정류장", low_wall: "낮은 담",
  garden_wall: "정원 담장", retaining_wall: "옹벽", pergola: "퍼걸러", gazebo: "정자", pavilion_hip: "팔작 정자",
  pavilion_octagon: "팔각정", stadium_seating: "관람석", reviewing_stand: "구령대", footbridge: "보도교",
  sports_goal: "골대", sports_hoop: "농구 골대", floodlight_pole: "조명탑", traffic_signal_pole: "신호등",
  sign_pole: "표지 기둥", trash_station: "분리수거장", terminal_shelter: "승강장", canopy_shelter_row: "차양 쉼터",
  gate_sign: "정문 글자", gate_canopy: "정문 캐노피", pond_basin: "연못", terraced_steps: "계단식 단",
  led_screen: "LED 전광판", paving_path: "포장 보도", manhole: "맨홀", storm_grate: "빗물받이",
  traffic_island: "교통섬", wheel_stop: "주차 휠스톱", "plaza_structure/fountain": "분수",
  "plaza_structure/planter": "광장 화단", "plaza_structure/parasol": "파라솔", "plaza_structure/kiosk": "매점 부스",
  "plaza_structure/pond": "광장 연못", "plaza_structure/stepped_terrace": "계단식 테라스",
  "plaza_structure/sculpture": "조형물", "plaza_structure/outdoor_steps": "야외 계단",
  "street_lamp/arterial": "가로등(간선도로)", "street_lamp/campusRoad": "가로등(교내도로)", "street_lamp/path": "가로등(보행로)",
  ginkgo: "은행나무", broadleaf: "활엽수", pine: "소나무", metasequoia: "메타세쿼이아", conifer: "침엽수",
  shrub: "관목", canopy: "캐노피 나무",
  asphalt: "아스팔트", pavers: "보도블록", plaza: "광장 포장", walkway: "보행로", apron: "건물 앞 포장", lot: "주차장",
  red_road: "붉은 포장", bicycle: "자전거도로", sports: "운동장 바닥", hump: "과속방지턱", gutter: "측구", tactile: "점자블록",
  parking: "주차 구획선", lane_line_solid: "차선(실선)", lane_line_dashed: "차선(점선)", kerb_no_parking: "주정차 금지선",
  centre_line_yellow: "중앙선", edge_line: "길가장자리선", speed_bump: "과속방지턱 표시", guide_line: "유도선", crosswalk: "횡단보도",
  stop_line: "정지선", arrow: "화살표", diamond: "횡단보도 예고", text: "노면 글자", area: "빗금 구역", chevron: "갈매기 표시",
});

export const CATEGORY_LABELS = Object.freeze({
  building: "건물", entrance: "출입구", furniture: "시설물", lamp: "가로등", signal: "신호등", wheel_stop: "휠스톱", tree: "나무",
  ground: "바닥 포장", marking: "노면 표시",
});

export const kindLabel = (kind) => KIND_LABELS[kind] ?? kind;

const TREE_GROUP = /^Trees_(.+)$/;
const ZERO = new Matrix4().makeScale(0, 0, 0);
// 미리 보기를 입힌 상태 표시: 다음 apply는 이동 목록이 같아도 반드시 다시 입힌다.
const PREVIEWED = Symbol("previewed");
// 바닥 규칙(groundContact)을 적용하지 않는 범주: 바닥 자신(포장·노면 표시)과, 경사지에 기초가 묻힌 채로 서 있는 건물·출입구.
// 땅을 누른 클릭이 고를 수 있는 작은 객체의 범주. 건물·나무·바닥 조각은 레이로만 고른다.
// 겹친 바닥 층을 한 표면으로 보는 깊이(장면 단위, 약 0.3 m)와, 그 안에서 먼저 고르는 순서(작을수록 먼저).
const COPLANAR_DEPTH = 0.2;
const PICK_RANK = Object.freeze({ marking: 1, ground: 2 });
const NEAR_PICK_CATEGORIES = new Set(["furniture", "lamp", "signal", "wheel_stop"]);
const FREE_CATEGORIES = new Set(["ground", "marking", "building", "entrance"]);
// 발이 이 폭(장면 단위, 약 0.8 m)보다 좁은 객체(기둥, 볼라드, 나무)는 기울이지 않고 올리기만 한다. 기둥은 비탈에서도 곧게 선다.
const TILT_SPAN_MIN = 0.5;
// 지지점을 고를 때 볼 정점 수의 상한(큰 건물도 한 번에 계산할 수 있도록 간격을 두고 본다).
const SUPPORT_VERTEX_SAMPLE = 60000;
// 바닥을 찾는 레이의 시작 높이: 캠퍼스에서 가장 높은 건물보다 충분히 위(장면 단위).
const RAY_HEADROOM = 1000;
// 이보다 인덱스가 많은 메시는 바닥 레이에 쓰기 전에 경계 상자 트리(three-mesh-bvh)를 만든다.
const BVH_MIN_INDICES = 3000;
// 생성기 피벗의 반올림 오차보다 크고, 아무리 작은 시설물보다는 작은 거리(장면 단위).
const PIVOT_EPSILON = 0.01;

const toTransform = (object) => ({
  position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(),
});
const compose = (t, target = new Matrix4()) =>
  target.compose(new Vector3().fromArray(t.position), new Quaternion().fromArray(t.quaternion), new Vector3().fromArray(t.scale));
const decompose = (matrix) => {
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  matrix.decompose(position, quaternion, scale);
  return { position: position.toArray(), quaternion: quaternion.toArray(), scale: scale.toArray() };
};
const sameTransform = (a, b) => ["position", "quaternion", "scale"].every((key) => a[key].every((v, i) => v === b[key][i]));
const applyTo = (object, t) => {
  object.position.fromArray(t.position);
  object.quaternion.fromArray(t.quaternion);
  object.scale.fromArray(t.scale);
  object.updateMatrix();
};
const touchInstances = (mesh) => {
  mesh.instanceMatrix.needsUpdate = true;
  mesh.boundingSphere = null;
  mesh.boundingBox = null;
};

// 지운 객체는 그리지도, 레이캐스트로 고르지도 않는다(three의 Raycaster는 visible이 아니라 레이어를 본다).
function setRemovedLayers(object, removed) {
  object.traverse((child) => {
    if (child.userData.editLayerMask === undefined) child.userData.editLayerMask = child.layers.mask;
    child.layers.mask = removed ? 0 : child.userData.editLayerMask;
  });
}

const worldOf = (parent, local) => new Matrix4().multiplyMatrices(parent.matrixWorld, local);

// 노드 바닥 중심이 노드 원점에서 떨어져 있으면 그 차이를 되돌리는 행렬(노드 좌표), 아니면 null.
function basePivotOffset(node) {
  node.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(node);
  if (box.isEmpty()) return null;
  const base = node.worldToLocal(new Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2));
  return base.length() > PIVOT_EPSILON ? new Matrix4().makeTranslation(-base.x, -base.y, -base.z) : null;
}

// useGLTF는 장면을 캐시해 다시 마운트해도 같은 객체를 준다. 편집기를 새로 만들 때는 이전 편집기가 바꾼 것을 되돌려 원래 모델에서
// 시작한다: 처음 본 변환·인스턴스 행렬을 userData에 두고, 복제해 넣은 객체는 떼어 낸다.
function restoreOriginalModel(scene) {
  const copies = [];
  scene.traverse((object) => {
    if (object.userData.editAdded) {
      copies.push(object);
      return;
    }
    if (object.isInstancedMesh && (TREE_GROUP.test(object.parent?.name ?? "") || object.userData.lampIds)) {
      if (object.userData.editOriginalMatrices) object.instanceMatrix.array.set(object.userData.editOriginalMatrices);
      else object.userData.editOriginalMatrices = object.instanceMatrix.array.slice();
      touchInstances(object);
    }
    if (object.userData.editOriginalGeometry) {
      object.geometry = object.userData.editOriginalGeometry;
      object.raycast = object.userData.editOriginalRaycast;
      delete object.userData.editOriginalGeometry;
      delete object.userData.editOriginalRaycast;
    }
    if (object.userData.editable?.id || object.userData.pickProxy) {
      object.userData.editOriginal ??= toTransform(object);
      applyTo(object, object.userData.editOriginal);
      object.visible = object.userData.pickProxy ? object.visible : true;
      setRemovedLayers(object, false);
    }
  });
  for (const copy of copies) copy.removeFromParent();
  scene.updateMatrixWorld(true);
}

// 조상 중 하나라도 숨겨져 있으면 보이지 않는 물체다. 선택 대리 프리즘은 원래 안 그리지만 고를 수 있다.
function isPickable(object) {
  if (object.userData.pickProxy) return true;
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

export function createSceneEditor(scene) {
  restoreOriginalModel(scene);
  const entries = new Map();
  const originals = [];
  const proxies = new Map();
  const pools = new Map();
  let missing = [];

  scene.traverse((object) => {
    if (object.userData.pickProxy) proxies.set(object.name, object);
    if (object.isInstancedMesh && Array.isArray(object.userData.lampIds)) {
      object.userData.lampIds.forEach((id, index) => pools.set(id, { mesh: object, index }));
    }
  });

  const followerOf = (object) => ({ object, world: object.matrixWorld.clone() });
  const poolFollower = ({ mesh, index }) => {
    const local = new Matrix4();
    mesh.getMatrixAt(index, local);
    return { mesh, index, world: worldOf(mesh, local) };
  };

  const idOfHit = ({ object, instanceId }) => {
    if (object.isInstancedMesh && object.userData.editInstanceGroup) {
      const id = `${object.userData.editInstanceGroup}#${instanceId}`;
      return entries.has(id) ? id : null;
    }
    let node = object;
    while (node && node.userData.editId === undefined) node = node.parent;
    return node && entries.has(node.userData.editId) ? node.userData.editId : null;
  };

  const register = (entry) => {
    entries.set(entry.id, entry);
    return entry;
  };

  // 편집값의 원점은 객체 바닥 중심이다. 생성기가 분리한 시설물은 노드 원점이 이미 그곳이지만, BLD_* 노드는 변환이 단위 행렬이고
  // 정점이 장면 좌표라 원점이 장면 중심이다(노드 변환과 이름은 바꾸지 않는다). 그런 노드는 바닥 중심에 피벗(빈 Object3D)을
  // 두고 피벗을 편집한다. 노드 = 피벗 × unpivot.
  const nodeEntry = ({ node, unpivot = basePivotOffset(node), ...entry }) => {
    let target = node;
    if (unpivot) {
      target = new Object3D();
      target.name = `${entry.id} pivot`;
      target.userData.editAdded = true;
      node.parent.add(target);
      applyTo(target, decompose(node.matrix.clone().multiply(unpivot.clone().invert())));
    }
    return { ...entry, node, target, unpivot, removed: false };
  };
  const placeNode = (entry, transform) => {
    applyTo(entry.target, transform);
    if (entry.unpivot) applyTo(entry.node, decompose(compose(transform).multiply(entry.unpivot)));
  };

  scene.traverse((object) => {
    const editable = object.userData.editable;
    if (editable?.id) {
      object.userData.editId = editable.id;
      const followers = [];
      const proxy = proxies.get(editable.id);
      if (proxy) {
        proxy.userData.editId = editable.id;
        followers.push(followerOf(proxy));
      }
      if (pools.has(editable.id)) followers.push(poolFollower(pools.get(editable.id)));
      const entry = nodeEntry({ id: editable.id, kind: editable.kind, category: editable.category, node: object, followers });
      entry.original = toTransform(entry.target);
      entry.transform = entry.original;
      originals.push(register(entry));
      return;
    }
    const species = TREE_GROUP.exec(object.name)?.[1];
    if (!species) return;
    const members = object.children.filter((child) => child.isInstancedMesh);
    if (members.length === 0) return;
    for (const mesh of members) mesh.userData.editInstanceGroup = object.name;
    const [primary] = members;
    for (let index = 0; index < primary.count; index += 1) {
      const matrices = members.map((mesh) => {
        const m = new Matrix4();
        mesh.getMatrixAt(index, m);
        return m;
      });
      const inverse = matrices[0].clone().invert();
      const original = decompose(matrices[0]);
      originals.push(register(instanceEntry({
        id: `${object.name}#${index}`, kind: species, category: "tree", original, transform: original, removed: false,
        primary, members: members.map((mesh, k) => ({ mesh, index, relative: inverse.clone().multiply(matrices[k]) })),
      })));
    }
  });

  // 인스턴스 편집용 손잡이(TransformControls가 붙을 Object3D)는 고를 때 처음 만든다. 나무 수천 그루에 미리 만들지 않는다.
  function instanceEntry(entry) {
    let handle = null;
    Object.defineProperty(entry, "target", {
      get() {
        if (!handle) {
          handle = new Object3D();
          handle.name = `${entry.id} handle`;
          handle.userData.editAdded = true;
          applyTo(handle, entry.transform);
          entry.primary.add(handle);
        }
        return handle;
      },
    });
    return Object.assign(entry, { followers: [], hasHandle: () => handle !== null });
  }

  const moveFollowers = (entry, before, after) => {
    if (entry.followers.length === 0) return;
    const parent = entry.target.parent;
    parent.updateWorldMatrix(true, false);
    const delta = worldOf(parent, compose(after)).multiply(worldOf(parent, compose(before)).invert());
    for (const follower of entry.followers) {
      const world = delta.clone().multiply(follower.world);
      if (follower.object) {
        const local = follower.object.parent.matrixWorld.clone().invert().multiply(world);
        applyTo(follower.object, decompose(local));
        setRemovedLayers(follower.object, entry.removed);
      } else {
        const local = follower.mesh.matrixWorld.clone().invert().multiply(world);
        follower.mesh.setMatrixAt(follower.index, entry.removed ? ZERO : local);
        touchInstances(follower.mesh);
      }
    }
  };

  const setEntry = (entry, transform, removed) => {
    if (sameTransform(entry.transform, transform) && entry.removed === removed) return false;
    entry.transform = transform;
    entry.removed = removed;
    if (entry.members) {
      const handle = compose(transform);
      for (const member of entry.members) {
        member.mesh.setMatrixAt(member.index, removed ? ZERO : handle.clone().multiply(member.relative));
        touchInstances(member.mesh);
      }
      if (entry.hasHandle()) applyTo(entry.target, transform);
    } else {
      placeNode(entry, transform);
      entry.node.visible = !removed;
      setRemovedLayers(entry.node, removed);
    }
    moveFollowers(entry, entry.original, transform);
    return true;
  };

  const makeCopy = (item, prototype) => {
    let node;
    if (prototype.members) {
      // 나무 재질은 인스턴스 그리기용으로 셰이더를 고친 것이라(수관 색 보정·단풍) 보통 메시로는 그려지지 않는다.
      // 복제본도 인스턴스 하나짜리 메시로 만들고 원형 인스턴스의 색을 옮긴다.
      node = new Group();
      const colour = new Color();
      for (const member of prototype.members) {
        const mesh = new InstancedMesh(member.mesh.geometry, member.mesh.material, 1);
        mesh.setMatrixAt(0, member.relative);
        if (member.mesh.instanceColor) {
          member.mesh.getColorAt(member.index, colour);
          mesh.setColorAt(0, colour);
        }
        mesh.castShadow = member.mesh.castShadow;
        mesh.receiveShadow = member.mesh.receiveShadow;
        node.add(mesh);
      }
      prototype.primary.add(node);
    } else {
      node = prototype.node.clone(true);
      node.traverse((child) => {
        if (child.userData.editLayerMask !== undefined) child.layers.mask = child.userData.editLayerMask;
      });
      node.visible = true;
      prototype.node.parent.add(node);
    }
    node.name = item.id;
    node.userData = {
      ...node.userData, editAdded: true, editId: item.id,
      editable: { id: item.id, kind: prototype.kind, category: prototype.category },
    };
    const transform = { position: item.position, quaternion: item.quaternion, scale: item.scale };
    const entry = nodeEntry({
      id: item.id, kind: prototype.kind, category: prototype.category, prototype: prototype.id, added: true,
      node, unpivot: prototype.unpivot ?? null, followers: [],
    });
    placeNode(entry, transform);
    return register(Object.assign(entry, { original: transform, transform }));
  };

  return {
    entries,
    // 초안 전체를 장면에 맞춘다. 바뀐 것이 있으면 true(그림자 다시 굽기·다시 그리기 판단).
    apply(draft) {
      const removed = new Set(draft.removed);
      let changed = false;
      for (const entry of originals) {
        changed = setEntry(entry, draft.transforms[entry.id] ?? entry.original, removed.has(entry.id)) || changed;
      }
      const wanted = new Set(draft.added.map((item) => item.id));
      for (const [id, entry] of entries) {
        if (!entry.added || wanted.has(id)) continue;
        entry.target.removeFromParent();
        entry.node.removeFromParent();
        entries.delete(id);
        changed = true;
      }
      for (const entry of entries.values()) {
        const moves = draft.vertices?.[entry.id];
        if (entry.members || (!moves && !entry.vertexState?.applied)) continue;
        if (entry.vertexState?.applied === moves) continue;
        const state = vertexStateOf(entry);
        changed = applyVertexMoves(state, moves ?? []) || changed;
        state.applied = moves;
        entry.supportPoints = null;
      }
      missing = [];
      for (const item of draft.added) {
        const existing = entries.get(item.id);
        if (existing) {
          changed = setEntry(existing, { position: item.position, quaternion: item.quaternion, scale: item.scale }, false) || changed;
          continue;
        }
        const prototype = entries.get(item.prototype);
        if (!prototype) {
          missing.push(item.prototype);
          continue;
        }
        makeCopy(item, prototype);
        changed = true;
      }
      return changed;
    },
    // 레이캐스트 결과(가까운 순)에서 고를 객체 id, 없으면 null. 지운 것과 숨은 것은 건너뛴다.
    // 바닥 층(지형, 포장, 노면 표시)은 같은 높이에 겹쳐 있으므로, 처음 맞은 표면에서 COPLANAR_DEPTH 안에 있는 맞음을
    // 한 묶음으로 보고 편집 객체를 고른다: 바닥 위에 선 객체, 노면 표시, 포장 순서다.
    pick(intersections) {
      const visible = [];
      for (const hit of intersections) {
        if (hit.object.layers.mask === 0 || !isPickable(hit.object)) continue;
        const id = idOfHit(hit);
        if (id && entries.get(id).removed) continue;
        visible.push({ hit, id });
      }
      if (visible.length === 0) return null;
      const first = visible[0].hit.distance;
      const cluster = first === undefined ? [visible[0]] : visible.filter(({ hit }) => hit.distance - first <= COPLANAR_DEPTH);
      const rank = (id) => PICK_RANK[entries.get(id).category] ?? 0;
      const editable = cluster.filter(({ id }) => id).sort((p, q) => rank(p.id) - rank(q.id));
      return editable[0]?.id ?? null;
    },
    // 기즈모로 끄는 동안: 손잡이(노드)의 지금 변환을 멤버와 따라다니는 것에 옮긴다. 확정은 store.commitTransform이 한다.
    sync(id) {
      const entry = entries.get(id);
      if (!entry) return;
      setEntry(entry, toTransform(entry.target), entry.removed);
    },
    // 레이가 지면에 맞았을 때: 난간·볼라드처럼 가느다란 객체는 화면에서 몇 픽셀뿐이라, 맞은 점(월드) 반경 안에서
    // 경계 상자가 가장 가까운 작은 객체를 고른다. 건물과 나무는 레이로만 고른다.
    pickNear(point, radius) {
      const at = new Vector3(...point);
      const box = new Box3();
      let best = null;
      let bestDistance = radius;
      for (const entry of entries.values()) {
        if (entry.removed || entry.members || !NEAR_PICK_CATEGORIES.has(entry.category)) continue;
        const distance = box.setFromObject(entry.node).distanceToPoint(at);
        if (distance <= bestDistance) {
          best = entry.id;
          bestDistance = distance;
        }
      }
      return best;
    },
    readTransform: (id) => toTransform(entries.get(id).target),
    // 정점 편집: 손잡이(같은 자리 정점 묶음) 목록과 노드. 나무 인스턴스는 지오메트리를 공유하므로 정점 편집이 없다.
    vertexState: (id) => {
      const entry = entries.get(id);
      return entry && !entry.members ? vertexStateOf(entry) : null;
    },
    // 끄는 동안 미리 보기: 확정된 이동에 지금 끄는 이동 하나를 더해 입힌다(확정은 store.moveVertex).
    previewVertices(id, moves) {
      const entry = entries.get(id);
      const state = vertexStateOf(entry);
      applyVertexMoves(state, moves);
      state.applied = PREVIEWED;
      entry.supportPoints = null;
    },
    // 끌기 중 미리 보기: 주어진 편집값을 장면에만 입힌다(확정은 store.commitTransform).
    preview(id, transform) {
      const entry = entries.get(id);
      if (entry) setEntry(entry, transform, entry.removed);
    },
    boundsOf: (id, box) => boundsOfEntry(entries.get(id), box),
    // 원형 하나를 월드 좌표 point(바닥)에 놓을 때의 편집값: 원형의 회전·크기를 그대로 쓰고 위치만 그 부모 기준으로 바꾼다.
    placement(prototypeId, point) {
      const entry = entries.get(prototypeId);
      const parent = entry.members ? entry.primary : entry.target.parent;
      parent.updateWorldMatrix(true, false);
      const local = parent.worldToLocal(new Vector3(...point));
      return { position: local.toArray(), quaternion: [...entry.transform.quaternion], scale: [...entry.transform.scale] };
    },
    // 추가 목록: 원래 모델의 객체를 종류별로 묶고, 그 종류의 첫 객체를 복제 원형으로 쓴다.
    library() {
      const groups = new Map();
      for (const entry of originals) {
        const key = `${entry.category}/${entry.kind}`;
        const group = groups.get(key) ?? { key, category: entry.category, kind: entry.kind, count: 0, prototype: entry.id };
        group.count += 1;
        groups.set(key, group);
      }
      return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
    },
    missingPrototypes: () => [...missing],
    // 편집값을 바닥 규칙에 맞춘다: 바닥(지형·포장·노면 표시·밑에 있는 다른 객체)보다 내려가지 않고, 이동 드래그에서는
    // 닿은 뒤 더 끌어내린 만큼 기울여 발을 모두 바닥에 얹는다(groundContact.mjs).
    constrain(id, transform, { tilt = true } = {}) {
      const entry = entries.get(id);
      if (!entry || FREE_CATEGORIES.has(entry.category)) return transform;
      const points = supportPointsOf(entry);
      if (points.length === 0) return transform;
      const span = Math.max(...[0, 2].map((axis) => {
        const values = points.map((p) => p[axis] * transform.scale[axis]);
        return Math.max(...values) - Math.min(...values);
      }));
      return settleOnGround({ transform, points, groundAt: groundAtFor(entry, transform), tilt: tilt && span >= TILT_SPAN_MIN });
    },
  };

  // 선택 상자(월드 좌표). 나무 인스턴스는 손잡이에 모양이 없으므로 멤버 메시의 경계 상자를 인스턴스 행렬로 옮겨 합친다.
  function boundsOfEntry(entry, box) {
    if (!entry.members) return box.setFromObject(entry.node);
    box.makeEmpty();
    const instance = new Matrix4();
    for (const member of entry.members) {
      member.mesh.updateWorldMatrix(true, false);
      member.mesh.getMatrixAt(member.index, instance);
      if (!member.mesh.geometry.boundingBox) member.mesh.geometry.computeBoundingBox();
      box.union(member.mesh.geometry.boundingBox.clone().applyMatrix4(member.mesh.matrixWorld.clone().multiply(instance)));
    }
    return box;
  }

  function vertexStateOf(entry) {
    entry.vertexState ??= createVertexState(entry.node);
    return entry.vertexState;
  }

  // 객체의 발(가장 낮은 띠의 윤곽 점, 편집값 좌표). 모양은 바뀌지 않으므로 한 번 구해 둔다.
  function supportPointsOf(entry) {
    if (entry.supportPoints) return entry.supportPoints;
    const vertices = [];
    const v = new Vector3();
    const collect = (geometry, toTarget) => {
      const position = geometry.getAttribute("position");
      const step = Math.max(1, Math.floor(position.count / SUPPORT_VERTEX_SAMPLE));
      for (let i = 0; i < position.count; i += step) vertices.push(v.fromBufferAttribute(position, i).applyMatrix4(toTarget).toArray());
    };
    if (entry.members) {
      for (const member of entry.members) collect(member.mesh.geometry, member.relative);
    } else {
      entry.target.updateWorldMatrix(true, false);
      entry.node.updateWorldMatrix(true, true);
      const targetInverse = entry.target.matrixWorld.clone().invert();
      entry.node.traverse((child) => {
        if (child.isMesh && !child.isInstancedMesh && child.geometry) collect(child.geometry, targetInverse.clone().multiply(child.matrixWorld));
      });
    }
    entry.supportPoints = selectSupportPoints(vertices);
    return entry.supportPoints;
  }

  // 부모 좌표 (x, z)에서 점 높이 y 아래의 바닥 높이(부모 좌표). 객체 자신과 숨은 것, 선택 대리 프리즘은 바닥이 아니다.
  // 레이는 높이서 내려오고, 객체 꼭대기(y + reach)보다 낮은 첫 표면을 바닥으로 본다. 객체 위를 덮는 지붕·캐노피는
  // 바닥이 아니다. 한 번의 끌기로 꼭대기까지 모두 땅속에 들어갔으면 가장 낮은 표면(지형)을 바닥으로 본다.
  function groundAtFor(entry, transform) {
    const parent = entry.target.parent;
    parent.updateWorldMatrix(true, false);
    const toWorld = parent.matrixWorld;
    const toParent = parent.matrixWorld.clone().invert();
    const own = new Set();
    (entry.node ?? entry.target).traverse((child) => own.add(child));
    const size = boundsOfEntry(entry, new Box3()).getSize(new Vector3());
    const reach = Math.max(size.y, 1) + 1;
    // 검사할 자세(transform)의 위치 둘레. 입력 칸으로 멀리 옮기면 지금 자리가 아니라 새 자리의 표면을 봐야 한다.
    const centre = new Vector3(...transform.position).applyMatrix4(toWorld);
    const area = new Box3(centre.clone(), centre.clone()).expandByScalar(Math.max(size.x, size.y, size.z) * Math.max(...transform.scale.map(Math.abs)));
    // 후보 표면: 객체 주변(크기만큼 넓힌 범위)과 경계 상자가 겹치는 메시만 본다. 장면 전체를 검사하면 끌기 한 번에
    // 0.2~1초가 들었다(측정). 인스턴스 메시(나무, 빛 웅덩이, 입면 부속)는 바닥이 아니다. 큰 메시는 처음 쓸 때 경계 상자 트리를 만든다.
    area.expandByScalar(Math.max(size.x, size.z) + reach);
    const candidates = [];
    const box = new Box3();
    scene.traverse((object) => {
      if (!object.isMesh || object.isInstancedMesh || own.has(object) || object.userData.pickProxy || object.layers.mask === 0) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      box.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld);
      if (box.max.x < area.min.x || box.min.x > area.max.x || box.max.z < area.min.z || box.min.z > area.max.z) return;
      if (!isPickable(object)) return;
      if (!object.geometry.boundsTree && (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) > BVH_MIN_INDICES) {
        object.geometry.boundsTree = new MeshBVH(object.geometry, { indirect: true });
        object.raycast = acceleratedRaycast;
      }
      candidates.push(object);
    });
    const ray = new Raycaster();
    ray.layers.enableAll();
    const down = new Vector3(0, -1, 0);
    return (x, z, y) => {
      const point = new Vector3(x, y, z).applyMatrix4(toWorld);
      const top = point.y + reach;
      ray.set(new Vector3(point.x, top + RAY_HEADROOM, point.z), down);
      const surfaces = ray.intersectObjects(candidates, false);
      const hit = surfaces.find((h) => h.point.y <= top) ?? surfaces.at(-1);
      return hit ? hit.point.applyMatrix4(toParent).y : null;
    };
  }
}

// 카메라가 보는 방향과 거리(줌)를 그대로 두고 중심만 center로 옮긴 시점.
export function recenterView({ position, target }, center) {
  const shift = [0, 1, 2].map((i) => center[i] - target[i]);
  return { position: position.map((v, i) => v + shift[i]), target: [...center] };
}

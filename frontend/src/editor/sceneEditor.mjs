// 캠퍼스 모델 장면에 편집 초안(modelEditStore)을 입힌다. 편집 단위는 두 가지다.
// - 노드: 생성기가 객체마다 만든 노드(extras.editable = { id, kind, category }, GLTFLoader가 userData로 옮긴다).
//   노드의 위치·회전·크기가 곧 편집값이고, 원점은 객체 바닥 중심이다.
// - 나무 인스턴스: Trees_<종> 아래 인스턴스 메시(줄기·수관)의 같은 번호. id는 `Trees_<종>#<번호>`이고 편집값은
//   첫 인스턴스 메시 안에서의 그 인스턴스 행렬이다. 다른 멤버(수관)는 원래 상대 위치를 지킨다.
// 따라다니는 것(follower): 가로등의 빛 웅덩이 인스턴스(Lamps_pools.userData.lampIds), 건물의 선택 대리 프리즘(BLD_SCNU_*).
// 원래 월드 변환에서 객체가 움직인 만큼(월드 기준 차이) 같이 움직인다.
import { Box3, Color, Group, InstancedMesh, Matrix4, Object3D, Quaternion, Vector3 } from "three";

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
});

export const CATEGORY_LABELS = Object.freeze({
  building: "건물", entrance: "출입구", furniture: "시설물", lamp: "가로등", signal: "신호등", wheel_stop: "휠스톱", tree: "나무",
});

export const kindLabel = (kind) => KIND_LABELS[kind] ?? kind;

const TREE_GROUP = /^Trees_(.+)$/;
const ZERO = new Matrix4().makeScale(0, 0, 0);
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
    // 레이캐스트 결과(가까운 순)에서 처음 맞은 보이는 물체가 편집 객체면 그 id, 아니면 null.
    pick(intersections) {
      for (const hit of intersections) {
        const { object } = hit;
        if (object.layers.mask === 0 || !isPickable(object)) continue;
        if (object.isInstancedMesh && object.userData.editInstanceGroup) {
          const entry = entries.get(`${object.userData.editInstanceGroup}#${hit.instanceId}`);
          if (entry?.removed) continue;
          return entry ? entry.id : null;
        }
        let node = object;
        while (node && node.userData.editId === undefined) node = node.parent;
        const entry = node ? entries.get(node.userData.editId) : null;
        if (entry?.removed) continue;
        return entry ? entry.id : null;
      }
      return null;
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
        if (entry.removed || entry.members || entry.category === "building" || entry.category === "tree") continue;
        const distance = box.setFromObject(entry.node).distanceToPoint(at);
        if (distance <= bestDistance) {
          best = entry.id;
          bestDistance = distance;
        }
      }
      return best;
    },
    readTransform: (id) => toTransform(entries.get(id).target),
    // 선택 상자(월드 좌표). 나무 인스턴스는 손잡이에 모양이 없으므로 멤버 메시의 경계 상자를 인스턴스 행렬로 옮겨 합친다.
    boundsOf(id, box) {
      const entry = entries.get(id);
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
    },
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
  };
}

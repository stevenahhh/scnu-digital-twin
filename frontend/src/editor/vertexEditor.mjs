// 객체 하나의 정점 편집. 생성기의 메시는 면마다(그리고 재질 프리미티브마다) 정점을 따로 두므로, 같은 자리에 있는 정점을
// 한 묶음(손잡이)으로 본다. 손잡이를 옮기면 그 자리의 정점이 모두 함께 움직여 면이 벌어지지 않는다.
// 편집 문서에는 손잡이의 대표 정점(메시 path·index)과 객체 노드 좌표의 이동량만 남긴다(modelEditStore.moveVertex).
import { Matrix3, Mesh, Vector3 } from "three";

// 같은 자리로 보는 거리(객체 좌표, 장면 단위). 생성기 좌표는 1/1024 격자에 맞춰져 있다.
const WELD = 1e-4;

// 노드 아래 메시(인스턴스 메시 제외)와 노드에서 그 메시까지의 자식 번호 경로.
function meshesOf(node) {
  const out = [];
  const walk = (object, path) => {
    if (object.isMesh && !object.isInstancedMesh) out.push({ mesh: object, path: path.join("/") });
    object.children.forEach((child, i) => walk(child, [...path, i]));
  };
  walk(node, []);
  return out;
}

export function createVertexState(node) {
  node.updateWorldMatrix(true, true);
  const toNode = node.matrixWorld.clone().invert();
  const cells = new Map();
  const groups = [];
  const byMember = new Map();
  const meshes = meshesOf(node).map(({ mesh, path }) => {
    const relative = toNode.clone().multiply(mesh.matrixWorld);
    const position = mesh.geometry.getAttribute("position");
    const v = new Vector3();
    for (let i = 0; i < position.count; i += 1) {
      v.fromBufferAttribute(position, i).applyMatrix4(relative);
      const cell = `${Math.round(v.x / WELD)},${Math.round(v.y / WELD)},${Math.round(v.z / WELD)}`;
      let group = cells.get(cell);
      if (!group) {
        group = { position: v.toArray(), current: v.toArray(), members: [] };
        cells.set(cell, group);
        groups.push(group);
      }
      group.members.push({ path, index: i });
      byMember.set(`${path}:${i}`, group);
    }
    return { mesh, path, relative, toMesh: new Matrix3().setFromMatrix4(relative).invert(), original: null };
  });
  return {
    node,
    groups,
    meshes,
    byPath: new Map(meshes.map((m) => [m.path, m])),
    groupOf: (path, index) => byMember.get(`${path}:${index}`) ?? null,
    keyOf: (group) => ({ path: group.members[0].path, index: group.members[0].index }),
  };
}

// 편집 문서의 정점 이동 목록을 객체에 입힌다. 처음 바뀌는 메시는 지오메트리를 복제해(복제본·원형과 공유하지 않게)
// 원래 좌표를 보관하고, 매번 원래 좌표에서 다시 계산한다. 바뀐 것이 있으면 true.
export function applyVertexMoves(state, moves) {
  const touched = new Set();
  for (const m of state.meshes) {
    if (!m.original) continue;
    m.mesh.geometry.getAttribute("position").array.set(m.original);
    touched.add(m);
  }
  for (const group of state.groups) group.current = [...group.position];
  const delta = new Vector3();
  for (const move of moves) {
    const group = state.groupOf(move.path, move.index);
    if (!group) continue;
    group.current = group.current.map((v, k) => v + move.offset[k]);
    for (const member of group.members) {
      const m = state.byPath.get(member.path);
      if (!m.original) {
        // 다시 마운트될 때 sceneEditor의 restoreOriginalModel이 원래 지오메트리·레이캐스트로 되돌린다.
        m.mesh.userData.editOriginalGeometry ??= m.mesh.geometry;
        m.mesh.userData.editOriginalRaycast ??= m.mesh.raycast;
        m.mesh.geometry = m.mesh.geometry.clone();
        m.mesh.raycast = Mesh.prototype.raycast;
        m.original = m.mesh.geometry.getAttribute("position").array.slice();
      }
      const position = m.mesh.geometry.getAttribute("position");
      delta.fromArray(move.offset).applyMatrix3(m.toMesh);
      position.setXYZ(member.index, position.getX(member.index) + delta.x, position.getY(member.index) + delta.y, position.getZ(member.index) + delta.z);
      touched.add(m);
    }
  }
  for (const m of touched) {
    const { geometry } = m.mesh;
    geometry.getAttribute("position").needsUpdate = true;
    if (geometry.getAttribute("normal")) geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  return touched.size > 0;
}


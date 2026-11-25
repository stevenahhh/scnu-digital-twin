import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import landcoverUrl from "../../scripts/campus-model/data/landcover.png?url";
import { GRASS_CLASS, LANDCOVER_ORIGIN, TUFT_STRIDE, buildGrassField, chunksInRange, landcoverSampler, scatterChunk } from "./grassScatter.mjs";

// 잔디밭 덤불(추정 연출). 잔디 지면 위에 낮은 풀 덤불을 인스턴스로 심는다. 심는 곳은 두 가지다.
// - 자연 지면(Topography_joined) 가운데 토지피복이 잔디인 칸
// - 재질 이름이 Ground_Grass로 시작하는 잔디 메시(D4 주변, 생성기 stages/surfaces.mjs)
// 덤불은 가까이서만 보이는 크기라 카메라에서 viewDistance 안에 든 덩어리만 만들어 그리고, 멀어진 덩어리는 버린다.
// 조감 시점에서는 덩어리가 하나도 없어 비용이 없다. 덤불 색은 그 자리 지면의 잔디색에서 정해 지면에 섞여 보이게 한다.
// 반사가 없는 Lambert 재질이고 그림자는 받기만 한다. 바람 흔들림은 넣지 않는다(멈춘 화면에서 프레임을 요청하지 않도록).
export const GRASS_TIERS = Object.freeze({
  low: null,
  medium: Object.freeze({ density: 8, viewDistance: 45 }),
  high: Object.freeze({ density: 16, viewDistance: 60 }),
});
const CHUNK_SIZE = 16;
// 이 배율보다 멀어진 덩어리의 메시를 지운다(경계에서 만들고 지우기를 되풀이하지 않게 보이는 거리보다 넓게).
const DROP_FACTOR = 1.5;
// 한 프레임에 새로 만드는 덩어리 수. 남은 덩어리는 다음 프레임에 이어 만든다.
const BUILDS_PER_FRAME = 2;
const TOPOGRAPHY_MESH_NAME = "Topography_joined";
const LAWN_MATERIAL_PATTERN = /^Ground_Grass/;
// 지면의 잔디색(sRGB). 자연 지면은 생성기 stages/surfaces.mjs NATURAL_PALETTE의 GRASS이고, 잔디 메시는 재질 extras.source에
// 적힌 평균색(retinted to #rrggbb)을 쓴다. 둘 다 추정값이다.
const TOPOGRAPHY_GRASS_COLOR = "#70964a";
const RETINT_PATTERN = /retinted to (#[0-9a-f]{6})/i;

// 덤불 하나: 가는 잎 3장을 방사형으로 기울여 세운다(장면 단위, 1 단위 = 약 1.6 m). 실제 잔디(5-10 cm)보다 큰 약 30 cm다:
// 카메라가 지면 위 1.5 단위(CAMERA_GROUND_CLEARANCE)까지만 내려오므로 실제 크기로는 한두 픽셀이 되지 않는다.
const BLADES = 3;
const BLADE_HEIGHT = 0.2;
const BLADE_WIDTH = 0.1;
const BLADE_LEAN = 0.07;
// 정점 색은 인스턴스 색(그 자리 지면 잔디색)에 곱하는 배율이다: 뿌리는 조금 어둡게, 끝은 조금 밝고 노랗게.
const ROOT_TINT = [0.72, 0.72, 0.72];
const TIP_TINT = [1.15, 1.12, 0.95];

function tuftGeometry() {
  const positions = [];
  const colors = [];
  for (let b = 0; b < BLADES; b += 1) {
    const angle = (b / BLADES) * Math.PI * 2 + b * 0.35;
    const cx = Math.cos(angle);
    const cz = Math.sin(angle);
    const wx = -cz * (BLADE_WIDTH / 2);
    const wz = cx * (BLADE_WIDTH / 2);
    const height = BLADE_HEIGHT * (0.8 + b * 0.15);
    positions.push(-wx, 0, -wz, wx, 0, wz, cx * BLADE_LEAN, height, cz * BLADE_LEAN);
    colors.push(...ROOT_TINT, ...ROOT_TINT, ...TIP_TINT);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  // 잎이 지면과 같은 밝기로 보이도록 모든 법선을 위로 둔다.
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return geometry;
}

function tuftMaterial() {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  material.name = "Grass_Tuft";
  // 양면 재질은 뒷면에서 법선을 뒤집는다(normal_fragment_begin). 잎은 앞뒤 구분 없이 위쪽 법선으로 빛을 받아야 하므로 되돌린다.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      "#include <normal_fragment_begin>\n\tnormal = normalize( vNormal );\n\tnonPerturbedNormal = normal;",
    );
  };
  material.customProgramCacheKey = () => "campus-grass-tuft";
  return material;
}

async function loadLandcover(url) {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0);
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  return landcoverSampler({ pixels: data, width: bitmap.width, height: bitmap.height, channels: 4, ...LANDCOVER_ORIGIN });
}

function grassSources(scene, landcoverAt) {
  scene.updateMatrixWorld(true);
  const toScene = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const sources = [];
  const colors = [];
  const add = (mesh, color, accept) => {
    const position = mesh.geometry?.attributes?.position;
    if (!position) return;
    sources.push({
      positions: position.array,
      index: mesh.geometry.index?.array ?? null,
      matrix: new THREE.Matrix4().multiplyMatrices(toScene, mesh.matrixWorld).elements,
      accept,
    });
    colors.push(new THREE.Color(color));
  };
  const topography = scene.getObjectByName(TOPOGRAPHY_MESH_NAME);
  if (topography?.isMesh) add(topography, TOPOGRAPHY_GRASS_COLOR, (x, z) => landcoverAt(x, z) === GRASS_CLASS);
  scene.traverse((object) => {
    if (!object.isMesh || !LAWN_MATERIAL_PATTERN.test(object.material?.name ?? "")) return;
    add(object, RETINT_PATTERN.exec(object.material.userData?.source ?? "")?.[1] ?? TOPOGRAPHY_GRASS_COLOR, null);
  });
  return { sources, colors };
}

function buildChunkMesh(data, geometry, material, colors) {
  const count = data.length / TUFT_STRIDE;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const matrices = mesh.instanceMatrix.array;
  const color = new THREE.Color();
  for (let i = 0; i < count; i += 1) {
    const o = i * TUFT_STRIDE;
    const scale = data[o + 4];
    const cos = Math.cos(data[o + 3]) * scale;
    const sin = Math.sin(data[o + 3]) * scale;
    // 수직축 회전 x 균일 배율 x 이동(열 우선)
    matrices.set([cos, 0, -sin, 0, 0, scale, 0, 0, sin, 0, cos, 0, data[o], data[o + 1], data[o + 2], 1], i * 16);
    const shade = 0.9 + (scale - 0.7) * (0.2 / 0.6);
    mesh.setColorAt(i, color.copy(colors[data[o + 5]]).multiplyScalar(shade));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  // 포인터·지면 높이 레이캐스트에 끼지 않는다(덤불 수만큼 검사하게 된다).
  mesh.raycast = () => {};
  return mesh;
}

// scene: campus-v2.glb의 glTF 장면. 이 컴포넌트는 그 장면과 같은 부모 그룹 안에 놓여야 한다.
export function CampusGrass({ scene, quality }) {
  const tier = GRASS_TIERS[quality] ?? null;
  const enabled = tier !== null;
  const groupRef = useRef(null);
  const [landcoverAt, setLandcoverAt] = useState(null);
  // key -> 메시, 덤불이 없는 덩어리는 null(다시 뿌리지 않도록)
  const builtRef = useRef(new Map());
  const invalidate = useThree((state) => state.invalidate);
  const cameraLocal = useMemo(() => new THREE.Vector3(), []);
  const inverse = useMemo(() => new THREE.Matrix4(), []);

  useEffect(() => {
    if (!tier || landcoverAt) return undefined;
    let cancelled = false;
    loadLandcover(landcoverUrl)
      .then((sampler) => {
        if (!cancelled) setLandcoverAt(() => sampler);
      })
      .catch((error) => console.warn("[CampusGrass] land cover unavailable, no grass tufts", error));
    return () => {
      cancelled = true;
    };
  }, [tier, landcoverAt]);

  const lawn = useMemo(() => {
    if (!enabled || !landcoverAt || !scene) return null;
    const { sources, colors } = grassSources(scene, landcoverAt);
    if (sources.length === 0) return null;
    return { field: buildGrassField({ sources, chunkSize: CHUNK_SIZE }), colors };
    // 덩어리 나누기는 밀도와 무관하다. 단계가 바뀌어도(보통/높음) 다시 하지 않도록 켜짐 여부만 본다.
  }, [enabled, landcoverAt, scene]);

  const resources = useMemo(() => ({ geometry: tuftGeometry(), material: tuftMaterial() }), []);

  // 지면이나 단계(밀도)가 바뀌면 만들어 둔 메시를 버리고, 한 장을 그려 새로 만들기 시작한다(demand 루프).
  useEffect(() => {
    const built = builtRef.current;
    if (lawn) invalidate();
    return () => {
      for (const mesh of built.values()) {
        mesh?.removeFromParent();
        mesh?.dispose();
      }
      built.clear();
    };
  }, [lawn, tier, invalidate]);

  useEffect(() => () => {
    resources.geometry.dispose();
    resources.material.dispose();
  }, [resources]);

  useFrame(({ camera }) => {
    const group = groupRef.current;
    if (!group || !lawn || !tier) return;
    // 마운트 직후 첫 프레임에는 렌더가 아직 월드 행렬을 갱신하지 않았다(재중심화 이동이 빠진 항등 행렬).
    group.updateWorldMatrix(true, false);
    inverse.copy(group.matrixWorld).invert();
    cameraLocal.copy(camera.position).applyMatrix4(inverse);
    const eye = [cameraLocal.x, cameraLocal.y, cameraLocal.z];
    const built = builtRef.current;
    const near = chunksInRange(lawn.field.chunks, eye, tier.viewDistance);
    let budget = BUILDS_PER_FRAME;
    let pending = false;
    for (const key of near) {
      if (built.has(key)) continue;
      if (budget === 0) {
        pending = true;
        break;
      }
      budget -= 1;
      const data = scatterChunk(lawn.field, key, { density: tier.density });
      const mesh = data.length > 0 ? buildChunkMesh(data, resources.geometry, resources.material, lawn.colors) : null;
      built.set(key, mesh);
      if (mesh) group.add(mesh);
    }
    const keep = chunksInRange(lawn.field.chunks, eye, tier.viewDistance * DROP_FACTOR);
    for (const [key, mesh] of built) {
      if (keep.has(key)) {
        if (mesh) mesh.visible = near.has(key);
        continue;
      }
      mesh?.removeFromParent();
      mesh?.dispose();
      built.delete(key);
    }
    if (pending) invalidate();
  });

  if (!tier) return null;
  return <group ref={groupRef} name="Campus_Grass" />;
}

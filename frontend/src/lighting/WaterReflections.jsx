// Planar mirror reflections on the plaza pools (helpers and shader: waterReflection.mjs).
//
// Finds the Furniture_Water mesh of the campus model, splits it into its pools, and puts a three.js Reflector over
// each: a mirror camera renders the scene into a texture of WATER_REFLECTION_SIZE[quality] px, only while that pool
// is drawn (the Reflector renders from onBeforeRender, which frustum culling skips), never inside another mirror's
// pass, and without re-rendering the shadow map (Reflector keeps shadowMap.autoUpdate off in its pass). The source
// water mesh is hidden while the mirrors stand and shown again when they are removed.
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry, Color, DataTexture, DoubleSide, Frustum, LinearFilter, Matrix4, RepeatWrapping, SRGBColorSpace, Sphere, Vector2, Vector3 } from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { WATER_MATERIAL_NAME } from "./water.mjs";
import { WATER_BASE_COLOUR, WATER_REFLECTION_SHADER, mirrorDue, reflectionSizeFor, rippleNormalMap, splitPools } from "./waterReflection.mjs";

const RIPPLE_SIZE = 64;
const SEARCH_EVERY_FRAMES = 30;

function findWater(scene) {
  let found = null;
  scene.traverse((o) => {
    if (!found && o.isMesh && o.material?.name === WATER_MATERIAL_NAME && !o.userData.waterMirror) found = o;
  });
  return found;
}

function buildMirrors(source, size, ripple, tier, clock) {
  source.updateWorldMatrix(true, false);
  const pos = source.geometry.getAttribute("position");
  const world = new Float32Array(pos.count * 3);
  const v = new Vector3();
  const buffer = new Vector2();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i).applyMatrix4(source.matrixWorld);
    world.set([v.x, v.y, v.z], i * 3);
  }
  const index = source.geometry.getIndex();
  const pools = splitPools(world, index ? Array.from(index.array) : null);
  const color = new Color(WATER_BASE_COLOUR);
  return pools.map(({ triangles, planeY }) => {
    // the pool in the Reflector's local XY plane (normal +Z); the mesh turns it face-up at planeY
    const local = new Float32Array(triangles.length * 3);
    triangles.forEach((t, k) => local.set([world[t * 3], -world[t * 3 + 2], 0], k * 3));
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(local, 3));
    geometry.computeBoundingSphere();
    const mirror = new Reflector(geometry, { color, textureWidth: size, textureHeight: size, clipBias: 0.003, shader: WATER_REFLECTION_SHADER });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = planeY + 0.005;
    mirror.material.uniforms.tRipple.value = ripple;
    mirror.material.side = DoubleSide; // the (x, z) -> (x, -z) remap may flip the winding
    mirror.userData.waterMirror = true;
    mirror.castShadow = false;
    mirror.receiveShadow = false;
    mirror.raycast = () => {};
    // The mirror pass runs from WaterReflections' useFrame, before the main render, with the main pass's output colour
    // space and tone mapping (the target is marked like the composer's screen-referred buffer while it renders). Run
    // from three's onBeforeRender it was a render nested in the main one, with its own light state and a linear target,
    // so every lit material resolved its program again twice a frame: about 4 ms of main-thread time per frame on
    // campus-v2 (measured). The pool shader takes the texture back to scene-linear light (waterReflection.mjs). A pool
    // seen in another pool's reflection shows its last texture.
    const render = mirror.onBeforeRender;
    mirror.onBeforeRender = () => {};
    const target = mirror.getRenderTarget();
    const sphere = new Sphere();
    let rendered = false;
    const texPos = new Vector3();
    const texDir = new Vector3();
    const dir = new Vector3();
    mirror.userData.renderReflection = (renderer, scene, camera, frustum) => {
      if (!mirror.visible) return;
      mirror.updateWorldMatrix(true, false);
      sphere.copy(geometry.boundingSphere).applyMatrix4(mirror.matrixWorld);
      // only while the pool is in view (three skipped onBeforeRender for a culled mirror)
      if (!frustum.intersectsSphere(sphere)) return;
      // the first pass always runs, so a mirror never shows an empty texture
      camera.getWorldDirection(dir);
      const moved = rendered ? texPos.distanceTo(camera.position) : Infinity;
      const turned = rendered ? (Math.acos(Math.min(1, Math.max(-1, texDir.dot(dir)))) * 180) / Math.PI : Infinity;
      if (rendered && !mirrorDue({ frame: clock.frame, tier, radius: sphere.radius, distance: sphere.center.distanceTo(camera.position), fovDeg: camera.fov, viewportPx: renderer.getDrawingBufferSize(buffer).y, movedSinceTexture: moved, turnedSinceTexture: turned, cameraAtRest: clock.atRest })) return;
      rendered = true;
      texPos.copy(camera.position);
      texDir.copy(dir);
      const colorSpace = target.texture.colorSpace;
      target.isXRRenderTarget = true;
      target.texture.colorSpace = SRGBColorSpace;
      try {
        render.call(mirror, renderer, scene, camera);
      } finally {
        target.isXRRenderTarget = false;
        target.texture.colorSpace = colorSpace;
      }
    };
    return mirror;
  });
}

export function WaterReflections({ quality = "low" }) {
  const { scene } = useThree();
  const state = useRef({ source: null, mirrors: [], frames: 0, ripple: null, clock: { frame: 0, atRest: false }, lastCam: null, frustum: new Frustum(), projection: new Matrix4() });

  useEffect(() => {
    const s = state.current;
    const texture = new DataTexture(rippleNormalMap(RIPPLE_SIZE), RIPPLE_SIZE, RIPPLE_SIZE);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.magFilter = texture.minFilter = LinearFilter;
    texture.needsUpdate = true;
    s.ripple = texture;
    return () => {
      clear(s);
      texture.dispose();
    };
  }, []);

  // a tier change rebuilds the mirrors at the new texture size
  useEffect(() => () => clear(state.current), [quality]);

  useFrame((state3) => {
    const { clock } = state3;
    const s = state.current;
    if (s.source && !s.source.parent) clear(s); // the model was reloaded
    if (!s.source) {
      s.frames += 1;
      if (s.frames % SEARCH_EVERY_FRAMES !== 1) return;
      const water = findWater(scene);
      if (!water || !s.ripple) return;
      s.source = water;
      s.mirrors = buildMirrors(water, reflectionSizeFor(quality), s.ripple, quality, s.clock);
      for (const m of s.mirrors) scene.add(m);
      water.visible = false;
    }
    s.clock.frame += 1;
    // at rest: the camera has not moved since the previous frame
    const cam = state3.camera;
    cam.updateMatrixWorld();
    s.clock.atRest = s.lastCam ? s.lastCam.equals(cam.matrixWorld) : false;
    (s.lastCam ??= cam.matrixWorld.clone()).copy(cam.matrixWorld);
    const t = clock.elapsedTime;
    s.frustum.setFromProjectionMatrix(s.projection.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    for (const m of s.mirrors) {
      m.material.uniforms.time.value = t;
      m.userData.renderReflection(state3.gl, scene, cam, s.frustum);
    }
  });
  return null;
}

function clear(s) {
  for (const m of s.mirrors) {
    m.parent?.remove(m);
    m.getRenderTarget().dispose();
    m.geometry.dispose();
    m.material.dispose();
  }
  if (s.source) s.source.visible = true;
  s.mirrors = [];
  s.source = null;
  s.frames = 0;
}

import { useLayoutEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

// One flat ring under the campus terrain's edge that runs out past the camera's far plane, so the view
// never ends in a hard edge where a ground mesh stops: with ?model=uni (no outer terrain ring) it is the
// ground beyond Topography, and with campus-v2.glb it lies below the outer ring and shows only where the
// ring ends. It does not depend on the GLB, the quality tier or the composer.
//
// Hole: the generator's EXTENT (scripts/campus-model/lib/frame.mjs, x -2..502, z -376..2) moved by
// CityModel's recentring on the BLD_D4 anchor (about x -260.9, z +173.3), inset so the ring starts under
// the terrain rather than at its edge. Height: just below the lowest Topography edge (11.9 units).
const HOLE = Object.freeze({ minX: -257, maxX: 235, minZ: -197, maxZ: 169 });
const SKIRT_Y = 10;
const OUTER_RADIUS = 6000;
// Far-ground tone: outerTerrain.mjs's LOWLAND backdrop (sRGB 128, 136, 100), the colour the outer ring fades
// to. A model without the ring (?model=uni) has no backdrop, so the ring takes the colour of its largest
// Topography mesh instead and the ground runs on without a colour step.
const FAR_GROUND_COLOR = "#808864";
const OUTER_TERRAIN_NAME = "OuterTerrain";
const TOPOGRAPHY_PATTERN = /^Topography/;

function findGroundTone(scene) {
  let outerTerrain = false;
  let topography = null;
  let topographyArea = 0;
  scene.traverse((object) => {
    if (object.name === OUTER_TERRAIN_NAME) outerTerrain = true;
    if (!object.isMesh || !object.material?.color) return;
    let ancestor = object;
    while (ancestor && !TOPOGRAPHY_PATTERN.test(ancestor.name)) ancestor = ancestor.parent;
    if (!ancestor) return;
    object.geometry.computeBoundingBox();
    const size = object.geometry.boundingBox.getSize(new THREE.Vector3()).multiply(object.getWorldScale(new THREE.Vector3()));
    const area = Math.abs(size.x * size.y) + Math.abs(size.x * size.z) + Math.abs(size.y * size.z);
    if (area > topographyArea) {
      topography = object.material;
      topographyArea = area;
    }
  });
  if (outerTerrain || !topography) return null;
  return topography;
}
// The exp2 fog reaches only ~80 % at the 1000-unit far plane, which would leave a cut line where the far
// plane clips the ring; between these shares of camera.far the ring is blended the rest of the way to fog.
const FADE_START = 0.55;
const FADE_END = 0.95;

function createSkirtGeometry() {
  const shape = new THREE.Shape().absarc(0, 0, OUTER_RADIUS, 0, Math.PI * 2, false);
  // Shape y becomes -z after the rotation below.
  const hole = new THREE.Path()
    .moveTo(HOLE.minX, -HOLE.maxZ)
    .lineTo(HOLE.minX, -HOLE.minZ)
    .lineTo(HOLE.maxX, -HOLE.minZ)
    .lineTo(HOLE.maxX, -HOLE.maxZ)
    .lineTo(HOLE.minX, -HOLE.maxZ);
  shape.holes.push(hole);
  const geometry = new THREE.ShapeGeometry(shape, 96);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function applyFarFade(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.skirtFadeStart = uniforms.skirtFadeStart;
    shader.uniforms.skirtFadeEnd = uniforms.skirtFadeEnd;
    shader.fragmentShader = `uniform float skirtFadeStart;\nuniform float skirtFadeEnd;\n${shader.fragmentShader.replace(
      "#include <fog_fragment>",
      `#include <fog_fragment>
#ifdef USE_FOG
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, smoothstep( skirtFadeStart, skirtFadeEnd, vFogDepth ) );
#endif`,
    )}`;
  };
  material.customProgramCacheKey = () => "horizon-skirt";
}

const ignoreRaycast = () => {};

// Mount it after the campus model has loaded (inside the model's Suspense) so the ground tone can be read.
export function HorizonSkirt() {
  const far = useThree((state) => state.camera.far);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const geometry = useMemo(createSkirtGeometry, []);
  const uniforms = useMemo(() => ({ skirtFadeStart: { value: 0 }, skirtFadeEnd: { value: 1 } }), []);
  const material = useMemo(() => {
    const skirt = new THREE.MeshStandardMaterial({ color: FAR_GROUND_COLOR, roughness: 1, metalness: 0, fog: true });
    applyFarFade(skirt, uniforms);
    return skirt;
  }, [uniforms]);
  useLayoutEffect(() => {
    uniforms.skirtFadeStart.value = far * FADE_START;
    uniforms.skirtFadeEnd.value = far * FADE_END;
  }, [far, uniforms]);
  useLayoutEffect(() => {
    const ground = findGroundTone(scene);
    material.color.set(ground ? ground.color : FAR_GROUND_COLOR);
    if (ground) material.roughness = ground.roughness ?? 1;
    invalidate();
  }, [invalidate, material, scene]);
  useLayoutEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return (
    <mesh
      name="HorizonSkirt"
      geometry={geometry}
      material={material}
      position={[0, SKIRT_Y, 0]}
      raycast={ignoreRaycast}
      castShadow={false}
      receiveShadow={false}
    />
  );
}

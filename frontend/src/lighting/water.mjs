// Pool water (Furniture_Water, stages/furniture.mjs P.pond). Pure helpers; no three.js here.
//
// The material is glossy (roughness 0.06) and alpha-blended, so three's standard shading already reflects the sky
// environment (scene.environment, SkyEnvironment.jsx) with Schlick fresnel and no ray tracing. This patch adds the
// other half of the water look: the surface is see-through looking down (the painted pool floor shows) and nearly
// opaque at grazing angles, where the reflection dominates. Estimated look, not a measured optical model.
export const WATER_MATERIAL_NAME = "Furniture_Water";
export const WATER_ALPHA = Object.freeze({ down: 0.6, grazing: 0.95, power: 3 });

// Fragment shader patch for MeshStandardMaterial (onBeforeCompile).
export function patchWaterFresnel(shader, alpha = WATER_ALPHA) {
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <normal_fragment_maps>",
    `#include <normal_fragment_maps>
  float waterFacing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  diffuseColor.a = mix(${alpha.down.toFixed(3)}, ${alpha.grazing.toFixed(3)}, pow(1.0 - waterFacing, ${alpha.power.toFixed(1)}));`,
  );
  return shader;
}

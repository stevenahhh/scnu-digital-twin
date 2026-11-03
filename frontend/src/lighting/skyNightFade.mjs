import * as THREE from "three";

// Adds a night fade to a Preetham Sky material (three's or three-stdlib's): after tone mapping and
// colour-space encoding the dome is mixed toward skyNightColor by skyNightMix (see getSkyNightMix).
// The visible sky is drawn to the screen, so it takes the sRGB fog colour and ends up exactly on the
// night fog and background; the environment copy renders to a linear target and takes linear values.
// Returns the two uniforms; calling it again on the same material only returns them.
export function applySkyNightFade(material, nightColor) {
  if (material.uniforms.skyNightMix) return material.uniforms;
  const shader = material.fragmentShader;
  const encode = /#include <(colorspace|encodings)_fragment>/;
  if (!encode.test(shader)) throw new Error("Sky fragment shader has no colour-space include to fade after");
  material.uniforms.skyNightColor = { value: new THREE.Color().setRGB(...nightColor) };
  material.uniforms.skyNightMix = { value: 0 };
  material.fragmentShader = `uniform vec3 skyNightColor;\nuniform float skyNightMix;\n${shader.replace(
    encode,
    (include) => `${include}\n\tgl_FragColor.rgb = mix( gl_FragColor.rgb, skyNightColor, skyNightMix );`,
  )}`;
  material.needsUpdate = true;
  return material.uniforms;
}

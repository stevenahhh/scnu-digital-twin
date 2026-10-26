// Cascade selection for three's built-in lit materials (Standard, Physical, Lambert, Phong, Toon), as a patch of
// ShaderChunk.lights_fragment_begin. It changes shading only when a scene has two or more directional lights and
// every one of them casts a shadow: that is the Legacy campus on medium/high, where SunCascades adds intensity-0
// cascade lights next to the sun light. Then the sun (directional light 0) is lit once and shadowed by the first
// cascade whose map contains the fragment (finest first), so cascades need no per-material defines or uniforms.
// Scenes with one directional light (the low tier, the D4 detail canvases) compile the stock loop unchanged.
import { ShaderChunk } from "three";

// The stock directional-light block of three r186 (0.186.x), between these two markers.
export const DIRECTIONAL_BLOCK_START = "#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )";
export const DIRECTIONAL_BLOCK_END = "#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )";

const CASCADE_BRANCH = /* glsl */ `
	#if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 1 ) && ( NUM_DIR_LIGHT_SHADOWS == NUM_DIR_LIGHTS )

	float campusSunShadow = 1.0;
	bool campusCascadeFound = false;
	vec3 campusCascadeCoord;
	float campusCascadeEdge;

	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {

		directionalLightShadow = directionalLightShadows[ i ];
		campusCascadeCoord = vDirectionalShadowCoord[ i ].xyz / vDirectionalShadowCoord[ i ].w;
		// Keep the PCF taps (shadowRadius texels) inside the map.
		campusCascadeEdge = ( directionalLightShadow.shadowRadius + 1.0 ) / directionalLightShadow.shadowMapSize.x;
		if ( ! campusCascadeFound && all( greaterThan( campusCascadeCoord, vec3( campusCascadeEdge, campusCascadeEdge, 0.0 ) ) ) && all( lessThan( campusCascadeCoord, vec3( 1.0 - campusCascadeEdge, 1.0 - campusCascadeEdge, 1.0 ) ) ) ) {

			campusCascadeFound = true;
			campusSunShadow = receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;

		}

	}
	#pragma unroll_loop_end

	directionalLight = directionalLights[ 0 ];
	getDirectionalLightInfo( directionalLight, directLight );
	directLight.color *= directLight.visible ? campusSunShadow : 1.0;
	RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );

	#else
`;

// Wraps the stock directional loop: cascades first, the untouched loop in the #else branch.
export function patchLightsFragmentBegin(source) {
  const start = source.indexOf(DIRECTIONAL_BLOCK_START);
  const end = source.indexOf(DIRECTIONAL_BLOCK_END);
  if (start < 0 || end < start) throw new Error("lights_fragment_begin: directional-light block not found (three version changed?)");
  const block = source.slice(start + DIRECTIONAL_BLOCK_START.length, end);
  const close = block.lastIndexOf("#endif");
  const declarations = block.indexOf("#pragma unroll_loop_start");
  if (close < 0 || declarations < 0) throw new Error("lights_fragment_begin: unexpected directional-light block");
  const patched = `${DIRECTIONAL_BLOCK_START}${block.slice(0, declarations)}${CASCADE_BRANCH}\t${block.slice(declarations, close)}\t#endif\n\n${block.slice(close)}`;
  return source.slice(0, start) + patched + source.slice(end);
}

export const CASCADE_CHUNK_MARKER = "campusSunShadow";

// Idempotent: patching twice (HMR, tests) leaves one cascade branch.
export function installCascadeShadowChunk(chunks = ShaderChunk) {
  if (!chunks.lights_fragment_begin.includes(CASCADE_CHUNK_MARKER)) {
    chunks.lights_fragment_begin = patchLightsFragmentBegin(chunks.lights_fragment_begin);
  }
  return chunks.lights_fragment_begin;
}

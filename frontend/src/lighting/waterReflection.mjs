// Planar pool reflections (pure helpers; the three.js side is WaterReflections.jsx).
//
// Each pool of the Furniture_Water mesh becomes a flat mirror: a second camera reflected in the pool's plane renders
// the scene into a texture (render-to-texture, the three.js Reflector), and the pool shader blends that reflection
// with the water colour by Schlick fresnel, offset by a slowly scrolling ripple normal map. Rasterised only: no ray
// tracing and no screen-space ray marching. The mirror renders only while the pool is drawn (frustum culled), at a
// texture size per quality tier. Look values estimated, not a measured optical model.

// Reflection texture size (px, square) per quality tier.
export const WATER_REFLECTION_SIZE = Object.freeze({ low: 256, medium: 512, high: 1024 });
export const reflectionSizeFor = (tier) => WATER_REFLECTION_SIZE[tier] ?? WATER_REFLECTION_SIZE.low;
// The mirror pass re-renders the scene, so it runs only every Nth frame per tier (the texture keeps the last
// reflection in between) and not at all for a pool smaller than MIN_POOL_PX on screen (it keeps its last reflection).
export const WATER_REFLECTION_EVERY = Object.freeze({ low: 3, medium: 2, high: 1 });
export const MIN_POOL_PX = 48;
// Should the mirror of a pool (bounding sphere radius r, at distance d from a perspective camera of vertical fov
// fovDeg and viewport height px) render on frame `frame` for this tier?
// Skipping only thins out refreshes during continuous small camera motion: a texture from another viewpoint (camera
// moved more than JUMP_UNITS or turned more than JUMP_DEG since it was rendered) or a camera now at rest on a stale
// texture always refreshes, so a jump or the end of a move never leaves a wrong reflection on screen.
export const JUMP_UNITS = 2;
export const JUMP_DEG = 5;
export function mirrorDue({ frame, tier, radius, distance, fovDeg, viewportPx, movedSinceTexture = 0, turnedSinceTexture = 0, cameraAtRest = false }) {
  const every = WATER_REFLECTION_EVERY[tier] ?? WATER_REFLECTION_EVERY.low;
  const stale = movedSinceTexture > 1e-4 || turnedSinceTexture > 1e-3;
  const jumped = movedSinceTexture > JUMP_UNITS || turnedSinceTexture > JUMP_DEG;
  if (!jumped && !(cameraAtRest && stale) && frame % every !== 0) return false;
  const sizePx = (radius / Math.max(distance, 1e-3)) * (viewportPx / 2 / Math.tan(((fovDeg ?? 45) * Math.PI) / 360)) * 2;
  return sizePx >= MIN_POOL_PX;
}

// Ripple: UV offset strength of the reflection, ripple scale (repeats per metre of water) and drift speed (repeats
// per second); fresnel floor (share of reflection looking straight down: a calm pool against a bright sky, VR scene_c1).
export const WATER_RIPPLE = Object.freeze({ strength: 0.012, scale: 0.35, speed: 0.02 });
export const WATER_FRESNEL = Object.freeze({ f0: 0.02, floor: 0.45 });
// Water body colour under the reflection (sRGB): the dark green-teal of the pool in VR scene_c1 b. The model's water
// material takes its colour from a texture (its colour factor is white), so the mirror shader gets its own. Estimated.
export const WATER_BASE_COLOUR = 0x2f5a57;

// Split a triangle soup into its connected pools. `positions`: flat [x, y, z, ...] (world), `index`: triangle vertex
// indices or null. Vertices at the same position (to 1 mm) join, so a pool split into several primitives stays one.
// Returns [{ triangles: [i0, i1, i2, ...], planeY }] with planeY the mean height of the pool's vertices.
export function splitPools(positions, index = null) {
  const count = positions.length / 3;
  const tri = index ?? Array.from({ length: count }, (_, i) => i);
  const parent = Array.from({ length: count }, (_, i) => i);
  const root = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const join = (a, b) => { parent[root(a)] = root(b); };
  const seen = new Map();
  for (let i = 0; i < count; i += 1) {
    const key = `${Math.round(positions[i * 3] * 1000)},${Math.round(positions[i * 3 + 1] * 1000)},${Math.round(positions[i * 3 + 2] * 1000)}`;
    if (seen.has(key)) join(i, seen.get(key));
    else seen.set(key, i);
  }
  for (let t = 0; t + 2 < tri.length; t += 3) {
    join(tri[t], tri[t + 1]);
    join(tri[t], tri[t + 2]);
  }
  const pools = new Map();
  for (let t = 0; t + 2 < tri.length; t += 3) {
    const r = root(tri[t]);
    if (!pools.has(r)) pools.set(r, []);
    pools.get(r).push(tri[t], tri[t + 1], tri[t + 2]);
  }
  return [...pools.values()].map((triangles) => {
    const vertices = [...new Set(triangles)];
    const planeY = vertices.reduce((s, v) => s + positions[v * 3 + 1], 0) / vertices.length;
    return { triangles, planeY };
  });
}

// A tileable ripple normal map (RGBA bytes, size x size): the sum of a few integer-frequency sine waves, so it repeats
// seamlessly; normals encoded 0..255 around 128.
export function rippleNormalMap(size = 64) {
  const waves = [[3, 1, 0.0, 1], [1, 4, 1.3, 0.7], [5, -2, 2.1, 0.45], [-2, 6, 0.7, 0.3]];
  const height = (x, y) => waves.reduce((s, [kx, ky, phase, amp]) => s + amp * Math.sin(((kx * x + ky * y) / size) * 2 * Math.PI + phase), 0);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (height(x + 1, y) - height(x - 1, y)) / 2;
      const dy = (height(x, y + 1) - height(x, y - 1)) / 2;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      data[o] = Math.round(128 + 127 * (-dx / len));
      data[o + 1] = Math.round(128 + 127 * (-dy / len));
      data[o + 2] = Math.round(128 + 127 * (1 / len));
      data[o + 3] = 255;
    }
  }
  return data;
}

// The pool shader for the Reflector (its `shader` option): projective reflection lookup offset by two drifting ripple
// samples, Schlick fresnel between the water colour and the reflection.
export const WATER_REFLECTION_SHADER = Object.freeze({
  name: "CampusWaterReflection",
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    tRipple: { value: null },
    time: { value: 0 },
    strength: { value: WATER_RIPPLE.strength },
    rippleScale: { value: WATER_RIPPLE.scale },
    rippleSpeed: { value: WATER_RIPPLE.speed },
    f0: { value: WATER_FRESNEL.f0 },
    fresnelFloor: { value: WATER_FRESNEL.floor },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform sampler2D tRipple;
    uniform float time;
    uniform float strength;
    uniform float rippleScale;
    uniform float rippleSpeed;
    uniform float f0;
    uniform float fresnelFloor;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec2 p = vWorld.xz * rippleScale;
      vec2 n1 = texture2D(tRipple, p + vec2(time * rippleSpeed, time * rippleSpeed * 0.65)).xy * 2.0 - 1.0;
      vec2 n2 = texture2D(tRipple, p * 1.7 - vec2(time * rippleSpeed * 0.85, -time * rippleSpeed * 0.55)).xy * 2.0 - 1.0;
      vec2 d = (n1 + n2) * strength;
      vec4 uv = vUv;
      uv.xy += d * uv.w;
      vec3 reflection = texture2DProj(tDiffuse, uv).rgb;
      vec3 n = normalize(vec3(d.x * 6.0, 1.0, d.y * 6.0));
      vec3 v = normalize(cameraPosition - vWorld);
      float fresnel = f0 + (1.0 - f0) * pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 5.0);
      gl_FragColor = vec4(mix(color, reflection, clamp(fresnelFloor + (1.0 - fresnelFloor) * fresnel, 0.0, 1.0)), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});

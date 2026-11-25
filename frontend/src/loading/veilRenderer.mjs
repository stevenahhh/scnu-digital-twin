import { fieldOriginInScene, revealFrame } from "./veilView.mjs";

const FIELD_STRIDE = 6;
const CONTOUR_INTERVAL = 1.4;
const DPR_LIMIT = 1.5;
const FALLBACK_GROUND = 24;

const VERTEX = `#version 300 es
in vec2 aPos; out vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// 장면 카메라의 광선을 실제 지형에 맞혀 등고선을 그린다. 진행률은 시선이 닿는 땅에서 퍼지는 파면이고, 끝나면 같은 자리에서 구멍이 열려 장면이 드러난다.
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vNdc; out vec4 outColor;
uniform vec3 uEye, uRight, uUp, uForward, uBg, uLine, uGlow;
uniform vec4 uRect; uniform vec2 uView, uCentre;
uniform float uTime, uProgress, uReveal, uMaxR, uScale, uHasField, uGround, uInterval;
uniform sampler2D uField;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; } return v; }
// 격자 밖의 높이는 가장자리 값을 그대로 늘린다(가짜 비탈이 생기지 않는다). 등고선은 가장자리로 갈수록 옅어진다.
float fieldMask(vec2 p) {
  if (uHasField < 0.5) return 1.0;
  vec2 uv = (p - uRect.xy) / uRect.zw;
  vec2 edge = smoothstep(vec2(0.01), vec2(0.1), uv) * smoothstep(vec2(0.01), vec2(0.1), 1.0 - uv);
  return edge.x * edge.y;
}
float heightAt(vec2 p) {
  if (uHasField < 0.5) return uGround;
  vec2 uv = (p - uRect.xy) / uRect.zw;
  return texture(uField, clamp(uv, 0.0, 1.0)).r;
}
void main() {
  vec3 dir = normalize(uForward + uRight * vNdc.x * uView.x + uUp * vNdc.y * uView.y);
  float ground = 1.0 - smoothstep(-0.03, -0.01, dir.y);
  float slope = min(dir.y, -0.01);
  float t = (uGround - uEye.y) / slope;
  vec3 p = uEye + dir * t;
  for (int i = 0; i < 5; i++) { t = (heightAt(p.xz) - uEye.y) / slope; p = uEye + dir * t; }
  float h = heightAt(p.xz);
  float flow = fbm(p.xz * 0.012 + uTime * vec2(0.014, -0.009));
  float c = h / uInterval + flow * 1.6;
  float w = max(fwidth(c), 1e-4);
  float line = (1.0 - smoothstep(0.0, 1.5, abs(fract(c - 0.5) - 0.5) / w)) * (1.0 - smoothstep(0.35, 0.95, w)) * fieldMask(p.xz) * ground;
  vec2 g = p.xz / 62.5; vec2 gw = max(fwidth(g), vec2(1e-4));
  vec2 gd = abs(fract(g - 0.5) - 0.5) / gw;
  float grid = (1.0 - smoothstep(0.0, 1.2, min(gd.x, gd.y))) * (1.0 - smoothstep(0.2, 0.6, max(gw.x, gw.y))) * ground;
  float r = mix(1.0, 1.0 - exp(-length(p.xz - uCentre) / uScale) + (fbm(p.xz * 0.018 - uTime * 0.02) - 0.5) * 0.06, ground);
  float front = mix(-0.05, uMaxR + 0.06, uProgress);
  float lit = 1.0 - smoothstep(front - 0.1, front, r);
  float crest = exp(-pow((r - front) / 0.022, 2.0)) * step(0.001, uProgress) * (1.0 - uReveal);
  vec3 col = uBg + uLine * (grid * 0.035 + line * (0.09 + 0.3 * lit)) + uGlow * (lit * 0.05 + crest * 0.75 + line * lit * 0.12);
  float gate = mix(-0.12, uMaxR + 0.14, uReveal);
  float alpha = smoothstep(gate - 0.06, gate + 0.04, r);
  float rim = exp(-pow((r - gate) / 0.03, 2.0)) * step(0.001, uReveal);
  outColor = vec4(col * alpha + uGlow * rim * 0.8, max(alpha, rim * 0.8));
}`;

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader compile failed");
  return shader;
}

// 지형 격자를 줄여 평균을 낸다. 인도 턱 같은 작은 단차가 등고선을 어지럽히지 않는다.
function reduceField(field) {
  const width = Math.floor(field.width / FIELD_STRIDE);
  const height = Math.floor(field.height / FIELD_STRIDE);
  const data = new Float32Array(width * height);
  let sum = 0;
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      let total = 0;
      for (let y = 0; y < FIELD_STRIDE; y += 1) for (let x = 0; x < FIELD_STRIDE; x += 1) total += field.heights[(j * FIELD_STRIDE + y) * field.width + i * FIELD_STRIDE + x];
      data[j * width + i] = total / (FIELD_STRIDE * FIELD_STRIDE);
      sum += data[j * width + i];
    }
  }
  return { width, height, data, mean: sum / data.length };
}

// WebGL2가 없으면 null이다. 부르는 쪽은 단색 막으로 대신한다.
export function createVeilRenderer(canvas, { background, primary }) {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: "low-power" });
  if (!gl) return null;
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "shader link failed");
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(gl.getAttribLocation(program, "aPos"));
  gl.vertexAttribPointer(gl.getAttribLocation(program, "aPos"), 2, gl.FLOAT, false, 0, 0);
  const u = (name) => gl.getUniformLocation(program, name);

  const bg = hexRgb(background);
  const luminance = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
  gl.uniform3fv(u("uBg"), bg);
  gl.uniform3fv(u("uLine"), luminance > 0.5 ? [-0.75, -0.72, -0.68] : [0.85, 0.9, 1]);
  gl.uniform3fv(u("uGlow"), hexRgb(primary).map((v) => (luminance > 0.5 ? v - 0.75 : v + 0.15)));
  gl.uniform1f(u("uInterval"), CONTOUR_INTERVAL);
  gl.uniform1f(u("uHasField"), 0);
  let groundY = FALLBACK_GROUND;

  return {
    setField(field) {
      const reduced = reduceField(field);
      const [x, z] = fieldOriginInScene(field);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, reduced.width, reduced.height, 0, gl.RED, gl.FLOAT, reduced.data);
      for (const [name, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, name, value);
      // 줄인 격자의 칸 하나는 원래 표본 FIELD_STRIDE개의 평균이라, 칸 중심이 표본 사이(반 칸 앞)에 온다.
      gl.uniform4f(u("uRect"), x - field.step / 2, z - field.step / 2, reduced.width * FIELD_STRIDE * field.step, reduced.height * FIELD_STRIDE * field.step);
      gl.uniform1f(u("uHasField"), 1);
      groundY = reduced.mean;
    },
    // view는 veilView.mjs의 viewFromCamera·viewFromPose가 돌려주는 값이다.
    draw({ time, progress, reveal, view }) {
      const dpr = Math.min(window.devicePixelRatio || 1, DPR_LIMIT);
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      const frame = revealFrame(view, groundY);
      gl.uniform3fv(u("uEye"), view.eye);
      gl.uniform3fv(u("uForward"), view.forward);
      gl.uniform3fv(u("uRight"), view.right);
      gl.uniform3fv(u("uUp"), view.up);
      gl.uniform2f(u("uView"), view.tanX, view.tanY);
      gl.uniform2fv(u("uCentre"), frame.centre);
      gl.uniform1f(u("uScale"), frame.scale);
      gl.uniform1f(u("uMaxR"), frame.maxR);
      gl.uniform1f(u("uGround"), groundY);
      gl.uniform1f(u("uTime"), time);
      gl.uniform1f(u("uProgress"), progress);
      gl.uniform1f(u("uReveal"), reveal);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    // 컨텍스트는 잃게 하지 않는다. StrictMode가 같은 캔버스에 다시 마운트하면 그 컨텍스트를 그대로 받는다.
    dispose() { gl.deleteProgram(program); },
  };
}

import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

// KTX2 (KHR_texture_basisu) 텍스처를 campus-v2.glb 로더에 붙인다. Basis 트랜스코더는 public/basis/에서 받는다(CDN 없음).
// detectSupport는 렌더러의 확장 목록만 보므로, Canvas가 생기기 전(useGLTF.preload는 모듈을 읽을 때 시작한다) 임시 WebGL2
// 컨텍스트로 답하고 바로 놓는다. CityModel과 교통 시뮬레이션이 같은 URL을 같은 확장으로 읽어야 캐시가 하나로 맞는다.
let ktx2 = null;

function sharedKtx2Loader() {
  if (ktx2) return ktx2;
  const gl = document.createElement("canvas").getContext("webgl2");
  ktx2 = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`);
  ktx2.detectSupport({ extensions: { has: (name) => Boolean(gl?.getExtension(name)), get: (name) => gl?.getExtension(name) } });
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return ktx2;
}

export function extendCampusLoader(loader) {
  loader.setKTX2Loader(sharedKtx2Loader());
}

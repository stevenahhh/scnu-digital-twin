import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO, SMAA } from "@react-three/postprocessing";
import { RenderPass } from "postprocessing";
import { LinearSRGBColorSpace, SRGBColorSpace } from "three";
import { CAMPUS_CANVAS_GL } from "../lighting/CampusLighting";
import { getNightWeight } from "../lighting/season.mjs";
import { QUALITY_EFFECTS } from "../settings/qualityPreset.mjs";

// Medium/High 품질 단계의 후처리. AppLegacy가 React.lazy로 불러오므로 low 단계는 이 청크를 받지 않는다.
// EffectComposer는 우선순위 1 useFrame으로 R3F의 기본 렌더를 대신할 뿐 스스로 프레임을 요청하지 않는다.
// 그래서 demand 루프(정지 화면 0프레임)는 그대로이고, 마운트·설정 변경 때만 한 번 invalidate한다.
const AO_RADIUS = 3; // 장면 단위(약 0.62 단위/m), 약 5 m
// 장면 버퍼는 Neutral 톤 매핑을 거친 화면 값(0..1)을 담으므로 임계값도 그 기준이다. 밤에만 켜서
// 조명 받은 벽이 어두울 때 창문·가로등 발광만 번지게 한다. 창문 수백 개가 넓은 mip 번짐으로 더해지면
// 장면 전체가 떠 보이므로 번짐 반경과 단계 수를 줄여 발광체 가까이에만 남긴다.
const BLOOM_THRESHOLD = 0.8;
const BLOOM_MAX_INTENSITY = 0.35;
const BLOOM_RADIUS = 0.5;
const BLOOM_LEVELS = 5;

// three 재질은(r163·r186 모두) 톤 매핑 -> sRGB 인코딩 -> 안개 순서로 계산하므로 안개가 화면(sRGB) 공간에서 섞인다.
// 컴포저의 선형 버퍼에 그리면 안개가 선형 공간에서 섞여 장면 전체가 뿌옇게 뜬다(Low 화면과 다른 그림).
// RenderPass가 장면을 그리는 동안만 입력 버퍼를 three가 화면처럼 다루는 대상(isXRRenderTarget, sRGB)으로
// 표시해 재질이 Low와 똑같이 톤 매핑·인코딩·안개를 계산하게 한다. 그린 뒤에는 다시 Linear로 돌려둔다:
// postprocessing은 sRGB로 표시된 버퍼에 쓸 때 인코딩을 한 번 더 하므로(half-float 입력은 풀지 않는다)
// Bloom처럼 버퍼를 오가는 패스가 있으면 어두운 곳이 떠오른다. 같은 이유로 마지막 패스가 화면에
// 한 번 더 인코딩하지 않게 outputColorSpace를 컴포저가 있는 동안만 Linear로 둔다. 효과들은 화면용
// (감마) 값 위에서 돌고, SMAA는 원래 그 값을 전제한다.
// 컴포저는 마운트 때 gl.toneMapping을 끄므로(자식 effect가 먼저 실행된다) 여기서 Neutral로 되돌린다.
function useScreenReferredBuffers(composerRef) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    gl.outputColorSpace = LinearSRGBColorSpace;
    return () => {
      gl.outputColorSpace = SRGBColorSpace;
      invalidate();
    };
  }, [gl, invalidate]);
  useEffect(() => {
    const composer = composerRef.current;
    const renderPass = composer?.passes.find((pass) => pass instanceof RenderPass);
    if (renderPass && !renderPass.screenReferred) {
      const renderScene = renderPass.render.bind(renderPass);
      renderPass.render = (renderer, inputBuffer, ...rest) => {
        inputBuffer.isXRRenderTarget = true;
        inputBuffer.texture.colorSpace = SRGBColorSpace;
        try {
          renderScene(renderer, inputBuffer, ...rest);
        } finally {
          inputBuffer.isXRRenderTarget = false;
          inputBuffer.texture.colorSpace = LinearSRGBColorSpace;
        }
      };
      renderPass.screenReferred = true;
    }
    gl.toneMapping = CAMPUS_CANVAS_GL.toneMapping;
    gl.toneMappingExposure = CAMPUS_CANVAS_GL.toneMappingExposure;
    invalidate();
  });
}

// @react-three/postprocessing는 CSS 크기(size)가 바뀔 때만 composer.setSize를 부르고, 픽셀 비율(dpr)만 바뀔 때는 부르지 않는다.
// 그런데 자식이 바뀌어 패스를 다시 붙이면(시간 재생·선택으로 이 컴포넌트가 다시 렌더될 때) addPass가 그 순간의 드로잉 버퍼
// 크기로 패스를 맞춘다. 줌·회전 중(interactionDpr가 dpr을 0.75배로 낮춘 동안) 다시 붙은 N8AO는 dpr이 돌아온 뒤에도
// 작은 버퍼에 남아 깊이 버퍼와 해상도가 어긋나고, 화면에 회색 얼룩·띠가 정지 화면까지 남는다.
// dpr이 바뀔 때마다 컴포저 전체(입력 버퍼와 모든 패스)를 현재 드로잉 버퍼 크기로 다시 맞춘다.
function useComposerFollowsPixelRatio(composerRef) {
  const dpr = useThree((state) => state.viewport.dpr);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    composerRef.current?.setSize(size.width, size.height);
    invalidate();
  }, [composerRef, dpr, size, invalidate]);
}

export default function HighTierEffects({ tier, sunAltitude }) {
  const invalidate = useThree((state) => state.invalidate);
  const composerRef = useRef(null);
  const preset = QUALITY_EFFECTS[tier];
  const night = Number.isFinite(sunAltitude) ? getNightWeight(sunAltitude) : 0;
  const bloomIntensity = preset?.bloom ? BLOOM_MAX_INTENSITY * night : 0;

  useScreenReferredBuffers(composerRef);
  useComposerFollowsPixelRatio(composerRef);
  useEffect(() => {
    invalidate();
  }, [invalidate, tier, bloomIntensity]);

  if (!preset) return null;
  return (
    <EffectComposer ref={composerRef} multisampling={0} autoClear={false}>
      <N8AO
        halfRes={preset.ao.halfRes}
        quality={preset.ao.quality}
        intensity={preset.ao.intensity}
        aoRadius={AO_RADIUS}
        distanceFalloff={1}
      />
      {bloomIntensity > 0 ? (
        <Bloom
          mipmapBlur
          radius={BLOOM_RADIUS}
          levels={BLOOM_LEVELS}
          luminanceThreshold={BLOOM_THRESHOLD}
          luminanceSmoothing={0.1}
          intensity={bloomIntensity}
        />
      ) : null}
      <SMAA />
    </EffectComposer>
  );
}

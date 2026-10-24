import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { getNightWeight } from "../lighting/season.mjs";
import { QUALITY_EFFECTS } from "../settings/qualityPreset.mjs";

// Medium/High 품질 단계의 후처리. AppLegacy가 React.lazy로 불러오므로 low 단계는 이 청크를 받지 않는다.
// EffectComposer는 우선순위 1 useFrame으로 R3F의 기본 렌더를 대신할 뿐 스스로 프레임을 요청하지 않는다.
// 그래서 demand 루프(정지 화면 0프레임)는 그대로이고, 마운트·설정 변경 때만 한 번 invalidate한다.
// 컴포저가 gl.toneMapping을 끄므로(장면은 선형 HDR 버퍼에 그려진다) Neutral 톤 매핑은 ToneMapping 효과가 맡는다.
const AO_RADIUS = 3; // 장면 단위(약 0.62 단위/m), 약 5 m
const BLOOM_THRESHOLD = 1; // 선형 HDR 기준: 햇빛 받은 벽보다 밝은 창문·가로등 발광만 번진다.
const BLOOM_MAX_INTENSITY = 0.6;

export default function HighTierEffects({ tier, sunAltitude }) {
  const invalidate = useThree((state) => state.invalidate);
  const preset = QUALITY_EFFECTS[tier];
  const night = Number.isFinite(sunAltitude) ? getNightWeight(sunAltitude) : 0;
  const bloomIntensity = preset?.bloom ? BLOOM_MAX_INTENSITY * night : 0;

  useEffect(() => {
    invalidate();
  }, [invalidate, tier, bloomIntensity]);

  if (!preset) return null;
  const DBG = new URLSearchParams(location.search).get("fx") ?? "aobts";
  return (
    <EffectComposer multisampling={0} autoClear={false}>
      {DBG.includes("a") ? <N8AO
        halfRes={preset.ao.halfRes}
        quality={preset.ao.quality}
        intensity={preset.ao.intensity}
        aoRadius={AO_RADIUS}
        distanceFalloff={1}
      /> : null}
      {DBG.includes("b") && bloomIntensity > 0 ? (
        <Bloom mipmapBlur luminanceThreshold={BLOOM_THRESHOLD} luminanceSmoothing={0.3} intensity={bloomIntensity} />
      ) : null}
      {DBG.includes("t") ? <ToneMapping mode={ToneMappingMode.NEUTRAL} /> : null}
      {DBG.includes("s") ? <SMAA /> : null}
    </EffectComposer>
  );
}

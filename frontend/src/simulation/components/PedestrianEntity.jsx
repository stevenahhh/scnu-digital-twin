import React, { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RISK_COLORS } from "../utils/riskColors.mjs";

export const PedestrianEntity = React.memo(function PedestrianEntity({ speed = 0, riskLevel = "normal" }) {
  const body = useRef();
  useFrame(({ clock }) => {
    if (body.current) body.current.position.y = speed > 0.1 ? Math.sin(clock.elapsedTime * 7) * 0.045 : 0;
  });
  const color = RISK_COLORS[riskLevel] ?? "#5b4b8a";
  return (
    <group ref={body}>
      <mesh position={[0, 0.72, 0]}>
        <capsuleGeometry args={[0.22, 0.72, 5, 10]} />
        <meshStandardMaterial color={color} roughness={0.75} />
      </mesh>
      <mesh position={[0, 1.45, 0]}>
        <sphereGeometry args={[0.25, 12, 12]} />
        <meshStandardMaterial color="#dfb69d" roughness={0.8} />
      </mesh>
    </group>
  );
});

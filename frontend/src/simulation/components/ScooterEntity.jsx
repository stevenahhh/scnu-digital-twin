import React from "react";
import { RISK_COLORS } from "../utils/riskColors.mjs";

export const ScooterEntity = React.memo(function ScooterEntity({ riskLevel = "normal", state = "moving" }) {
  const risky = riskLevel === "danger" || String(state).toLowerCase() === "wrong_way";
  const color = risky ? RISK_COLORS.danger : RISK_COLORS[riskLevel] ?? "#16866f";
  return (
    <group>
      <mesh position={[0, 0.18, 0]}>
        <boxGeometry args={[0.28, 0.12, 1.25]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.75, -0.48]}>
        <cylinderGeometry args={[0.045, 0.045, 1.2, 8]} />
        <meshStandardMaterial color="#263238" />
      </mesh>
      <mesh position={[0, 1.32, -0.48]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.04, 0.04, 0.62, 8]} />
        <meshStandardMaterial color="#263238" />
      </mesh>
      {[-0.48, 0.48].map((z) => (
        <mesh key={z} position={[0, 0.18, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.18, 0.18, 0.09, 12]} />
          <meshStandardMaterial color="#172029" />
        </mesh>
      ))}
    </group>
  );
});

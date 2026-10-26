import React from "react";
import * as THREE from "three";

// Cheap contact ("blob") shadow under a moving traffic agent: one soft dark ellipse on a transparent quad, no shadow
// pass. The campus sun shadows are rendered only when the sun or the camera moves, so agents do not cast into them;
// on the high tier they get this instead. All agents share one texture, material and geometry.
const SIZES = Object.freeze({
  car: [1.9, 3.3],
  person: [0.9, 0.9],
  scooter: [0.7, 1.6],
});
// The agent's group sits GROUND_CLEARANCE (0.12) above the terrain; the blob lies just above the ground.
const BLOB_Y = -0.1;
const BLOB_OPACITY = 0.45;

let shared = null;
function sharedResources() {
  if (shared) return shared;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(0,0,0,1)");
  gradient.addColorStop(0.55, "rgba(0,0,0,0.6)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  // The gradient lives in the texture's alpha channel, so it is a colour map (alphaMap would read green, which is 0).
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    map: texture,
    transparent: true,
    opacity: BLOB_OPACITY,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    fog: true,
  });
  const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  shared = { material, geometry };
  return shared;
}

export function contactShadowSize(type) {
  return SIZES[type] ?? null;
}

export const ContactShadow = React.memo(function ContactShadow({ type }) {
  const size = contactShadowSize(type);
  if (!size) return null;
  const { material, geometry } = sharedResources();
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[0, BLOB_Y, 0]}
      scale={[size[0], 1, size[1]]}
      renderOrder={-1}
      raycast={() => null}
      dispose={null}
    />
  );
});

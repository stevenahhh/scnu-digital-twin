// Rounded toy-figure parts for the animated mascots of the live layers (e2-worksite.mjs, med-promo.mjs): a unit
// geometry scaled, turned and placed into a vertex-coloured Kit, and a limb as a stretched ball between two points.
// Positions and sizes are in the caller's local units.
import { BoxGeometry, Matrix4, Quaternion, SphereGeometry, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { rgb } from "./solids.mjs";

export const ball = new SphereGeometry(1, 20, 14);
export const box = new BoxGeometry(1, 1, 1);
export const soft = new RoundedBoxGeometry(1, 1, 1, 2, 0.16);
const V = (a) => new Vector3(...a);

export function part(kit, geom, pos, size, color, q = new Quaternion()) {
  const shape = geom.clone().applyMatrix4(new Matrix4().compose(V(pos), q, V(size)));
  const { position, normal } = shape.attributes;
  const paint = rgb(color), base = kit.vertexCount;
  for (let i = 0; i < position.count; i++) {
    kit.vertex([position.getX(i), position.getY(i), position.getZ(i)], [normal.getX(i), normal.getY(i), normal.getZ(i)], paint);
  }
  const indices = kit.mesh.indices;
  for (let i = 0; i < (shape.index?.count ?? position.count); i++) indices.push(base + (shape.index?.getX(i) ?? i));
}

export function limb(kit, p, q, radius, color) {
  const d = V(q).sub(V(p));
  part(kit, ball, V(p).lerp(V(q), .5).toArray(), [radius, d.length() / 2 + radius * .55, radius],
    color, new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.normalize()));
}

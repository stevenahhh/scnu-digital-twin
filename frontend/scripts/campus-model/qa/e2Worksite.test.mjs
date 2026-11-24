import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Quaternion, Vector3 } from "three";

// Exercise the published geometry, not the generator's design constants.
const bytes = readFileSync(new URL("../../../public/campus-e2-worksite.glb", import.meta.url));
const end = 20 + bytes.readUInt32LE(12);
const doc = JSON.parse(bytes.subarray(20, end));
const read = id => {
  const a = doc.accessors[id], v = doc.bufferViews[a.bufferView];
  const offset = bytes.byteOffset + end + 8 + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return new Float32Array(bytes.buffer, offset, a.count * {SCALAR:1, VEC3:3, VEC4:4}[a.type]);
};
test("the striking face reaches the stock twice, lifts clear between taps, and never passes through it", () => {
  const clip = doc.animations[0], channel = clip.channels[0];
  const arm = doc.nodes[channel.target.node];
  const points = n => read(doc.meshes[n.mesh].primitives[0].attributes.POSITION);
  const positions = points(arm);
  const stock = points(doc.nodes.find(n => n.name === "E2_Sawhorse"));
  const top = Math.max(...stock.filter((_, i) => i % 3 === 1));
  const rotations = read(clip.samplers[channel.sampler].output);
  const gap = [];
  for (let k = 0; k < rotations.length; k += 4) {
    const rot = new Quaternion().fromArray(rotations, k);
    let min = Infinity;
    for (let i=0; i<positions.length; i+=3) {
      const p=new Vector3().fromArray(positions,i).applyQuaternion(rot).add(new Vector3(...arm.translation));
      if (p.x >= -.47 && p.x <= 1.09 && p.z >= .66 && p.z <= 1.03) min=Math.min(min,p.y);
    }
    gap.push(min-top);
  }
  assert.ok(gap.every(d => d > -.005));
  const contacts=gap.map(d=>d<.005);
  assert.equal(contacts.filter((hit,i)=>hit && !contacts[i-1]).length,2);
  assert.ok(gap[contacts.indexOf(true)-1]>.1);
  assert.ok(gap.at(-1)>.1);
});

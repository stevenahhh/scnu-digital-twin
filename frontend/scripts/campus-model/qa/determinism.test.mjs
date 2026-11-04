import assert from "node:assert/strict";
import test from "node:test";
import { assertRawDeterminism } from "./determinism.mjs";

test("identical raw bytes return their SHA-256", () => {
  assert.deepEqual(assertRawDeterminism(Buffer.from("abc"), Buffer.from("abc")), {
    firstSha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    secondSha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  });
});

test("a single changed byte in the second raw build fails determinism", () => {
  assert.throws(() => assertRawDeterminism(Buffer.from("abc"), Buffer.from("abd")),
    { code: "RAW_NONDETERMINISTIC" });
});

import { createHash } from "node:crypto";

export class RawDeterminismError extends Error {
  constructor(firstSha256, secondSha256) {
    super(`raw build determinism failed: ${firstSha256} != ${secondSha256}`);
    this.code = "RAW_NONDETERMINISTIC";
    this.firstSha256 = firstSha256;
    this.secondSha256 = secondSha256;
  }
}

/** Compare the serialized raw bytes, without normalizing metadata or geometry. */
export function assertRawDeterminism(first, second) {
  const firstSha256 = createHash("sha256").update(first).digest("hex");
  const secondSha256 = createHash("sha256").update(second).digest("hex");
  if (firstSha256 !== secondSha256) throw new RawDeterminismError(firstSha256, secondSha256);
  return { firstSha256, secondSha256 };
}

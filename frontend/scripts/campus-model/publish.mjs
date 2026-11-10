#!/usr/bin/env bun
import { candidatePaths, CandidateGateError, publishReviewedCandidate } from "./qa/candidate.mjs";

const args = process.argv.slice(2);
if (args[0] !== "--candidate-dir" || !args[1]
  || !(args.length === 2 || args.length === 4 && args[2] === "--exception")) {
  throw new CandidateGateError("CANDIDATE_REQUIRED",
    "candidate QA gate requires --candidate-dir <path> [--exception F3-paint-2026-11-04]");
}
const identity = await publishReviewedCandidate(candidatePaths(args[1]), {
  precompress: true, exception: args[3] ?? null,
});
console.log(`MODEL_PUBLISHED ${identity.hashes.packed}`);

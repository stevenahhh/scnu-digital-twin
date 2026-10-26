import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_DETAILS_BACKOFF, TRAFFIC_FEED_BACKOFF, nextPollDelay, shouldPoll } from "./agentDetailsBackoff.mjs";

test("agent details poll every 5 s and back off 1 -> 2 -> 4 -> 8 s up to 30 s", () => {
  const delays = [0, 1, 2, 3, 4, 5, 6, 9].map((failures) => nextPollDelay(failures, AGENT_DETAILS_BACKOFF));
  assert.deepEqual(delays, [5000, 1000, 2000, 4000, 8000, 16000, 30000, 30000]);
});

test("the traffic feed polls every 2 s and makes at most 4 requests in a minute while down", () => {
  const delays = [0, 1, 2, 3, 4].map((failures) => nextPollDelay(failures, TRAFFIC_FEED_BACKOFF));
  assert.deepEqual(delays, [2000, 5000, 10000, 20000, 30000]);
  let at = 0;
  let requests = 0;
  for (let failures = 1; at < 60000; failures += 1) {
    requests += 1;
    at += nextPollDelay(failures, TRAFFIC_FEED_BACKOFF);
  }
  assert.equal(requests, 4);
});

test("polling pauses only when the browser reports offline", () => {
  assert.equal(shouldPoll({ onLine: false }), false);
  assert.equal(shouldPoll({ onLine: true }), true);
  assert.equal(shouldPoll(undefined), true);
});

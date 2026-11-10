import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_DETAILS_BACKOFF, TRAFFIC_FEED_BACKOFF, nextPollDelay, nextPollWait, shouldPoll } from "./agentDetailsBackoff.mjs";

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

test("while the traffic feed is down the gap between request starts never shrinks, even after a slow first response", () => {
  // Request durations: a cold 12.7 s first response, then fast failures.
  const durations = [12700, 2200, 100, 100, 100];
  let start = 0;
  let previousGap = 0;
  const starts = [];
  for (let i = 0; i < durations.length; i += 1) {
    starts.push(start);
    const completedAt = start + durations[i];
    const { wait, gap } = nextPollWait({ failures: i + 1, startedAt: start, completedAt, previousGap, backoff: TRAFFIC_FEED_BACKOFF });
    assert.ok(wait >= 0);
    previousGap = gap;
    start = completedAt + wait;
  }
  const gaps = starts.slice(1).map((value, i) => value - starts[i]);
  gaps.forEach((gap, i) => i > 0 && assert.ok(gap >= gaps[i - 1], `gap ${i} ${gap} < ${gaps[i - 1]}`));
  assert.ok(starts.filter((value) => value <= 60000).length <= 4);
});

test("a late timer (a busy main thread) widens the gap and the next gap never shrinks below it", () => {
  // The first retry was due 5 s after the first start but its timer fired at 14.4 s while the model loaded.
  const next = nextPollWait({ failures: 2, startedAt: 14400, completedAt: 14450, previousGap: 5000, previousStartedAt: 0, backoff: TRAFFIC_FEED_BACKOFF });
  assert.deepEqual(next, { wait: 14350, gap: 14400 });
  // Without a previous start the observed gap is unknown and the computed one stands.
  assert.deepEqual(nextPollWait({ failures: 2, startedAt: 14400, completedAt: 14450, previousGap: 5000, backoff: TRAFFIC_FEED_BACKOFF }), { wait: 9950, gap: 10000 });
});

test("a success polls again after the normal delay from its completion", () => {
  assert.deepEqual(nextPollWait({ failures: 0, startedAt: 0, completedAt: 300, previousGap: 9000, backoff: TRAFFIC_FEED_BACKOFF }), { wait: 2000, gap: 2300 });
});

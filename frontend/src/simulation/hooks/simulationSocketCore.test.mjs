import assert from "node:assert/strict";
import test from "node:test";
import { connectionLabel, reconnectDelayMs } from "./simulationSocketCore.mjs";

test("preserves the existing reconnect delays for retries one through eight", () => {
  for (let retryCount = 1; retryCount <= 8; retryCount += 1) {
    assert.equal(reconnectDelayMs(retryCount), Math.min(10000, 500 * 2 ** (retryCount - 1)));
  }
});

test("uses a thirty-second delay after the fast retries", () => {
  assert.equal(reconnectDelayMs(9), 30000);
  assert.equal(reconnectDelayMs(10), 30000);
  assert.equal(reconnectDelayMs(20), 30000);
});

test("labels retries through eight as reconnecting and later retries disconnected", () => {
  for (let retryCount = 1; retryCount <= 8; retryCount += 1) {
    assert.equal(connectionLabel(retryCount), "재연결 중");
  }
  assert.equal(connectionLabel(9), "연결 끊김");
  assert.equal(connectionLabel(10), "연결 끊김");
});

import assert from "node:assert/strict";
import test from "node:test";
import { INITIAL_FEED_STATUS, describeFeedStatus, isFeedDown, nextRetryDelay, reduceFeedStatus } from "./feedStatusModel.mjs";

const at = (hh, mm) => new Date(2026, 9, 25, hh, mm);
const run = (events, start = INITIAL_FEED_STATUS) => events.reduce(reduceFeedStatus, start);

test("nextRetryDelay doubles from 1 s and caps at 30 s", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 12].map(nextRetryDelay), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  assert.equal(nextRetryDelay(0), 0);
});

test("failures count attempts and keep the last good value; a success resets them", () => {
  const live = run([{ type: "success", at: at(9, 40), value: { t: 20 } }]);
  assert.equal(live.status, "live");
  const down = run([{ type: "failure", at: at(9, 41), cause: "기상 서버에 연결할 수 없습니다" }, { type: "failure", at: at(9, 42) }], live);
  assert.equal(down.status, "down");
  assert.equal(down.attempt, 2);
  assert.equal(down.retryInMs, 2000);
  assert.deepEqual(down.lastGood, { t: 20 });
  assert.equal(down.cause, "기상 서버에 연결할 수 없습니다");
  assert.ok(isFeedDown(down));
  const back = run([{ type: "success", at: at(9, 43), value: { t: 21 } }], down);
  assert.equal(back.status, "live");
  assert.equal(back.attempt, 0);
  assert.equal(back.retryInMs, null);
});

test("a cached answer is stale, never live", () => {
  assert.equal(run([{ type: "success", at: at(9, 40), value: 1, stale: true }]).status, "stale");
});

test("offline pauses retries and online resumes at once", () => {
  const down = run([{ type: "failure", at: at(9, 41) }]);
  const paused = run([{ type: "offline" }, { type: "failure", at: at(9, 42) }], down);
  assert.equal(paused.status, "paused");
  assert.equal(paused.retryInMs, null);
  assert.equal(paused.attempt, 1);
  const resumed = run([{ type: "online" }], paused);
  assert.equal(resumed.status, "down");
  assert.equal(resumed.retryInMs, 0);
  assert.equal(resumed.attempt, 0);
});

test("the Korean text names the cause, an HH:mm and the next step", () => {
  const down = run([{ type: "success", at: at(9, 40), value: 1 }, { type: "failure", at: at(9, 45), cause: "기상 서버 응답 없음" }]);
  const text = describeFeedStatus("weather", down);
  assert.equal(text.title, "기상 서버 응답 없음");
  assert.equal(text.detail, "09:40 값 표시 중 · 확인 09:45 · 1초 뒤 다시 시도");
  const never = describeFeedStatus("traffic", run([{ type: "failure", at: at(10, 5), cause: "영상 분석 서버 연결 없음" }]));
  assert.match(never.detail, /받은 값 없음 · 확인 10:05/);
  const paused = describeFeedStatus("energy", run([{ type: "offline" }, { type: "failure", at: at(10, 6) }]));
  assert.match(paused.detail, /멈춤/);
  assert.match(describeFeedStatus("simulation", run([{ type: "failure", at: at(10, 7) }])).detail, /자동으로 다시 연결/);
});

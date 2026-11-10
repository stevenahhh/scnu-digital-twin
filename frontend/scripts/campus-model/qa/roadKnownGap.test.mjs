import test from 'node:test';
import assert from 'node:assert/strict';
import { withKnownRoadGaps, TODO24_ROAD_GAPS } from './roadInventory.mjs';

const all = (value) => Object.fromEntries(TODO24_ROAD_GAPS.map((k) => [k, value]));

test('failing todo 24 road flags become a reasoned known gap', () => {
  const out = withKnownRoadGaps({ accepted: false, checks: { ...all(true), lateral: false, ownership: false } });
  assert.equal(out.accepted, false);
  assert.match(out.reason, /lateral/);
  assert.match(out.reason, /ownership/);
  assert.match(out.knownGap, /todo 24/);
});

test('an accepted road report is returned unchanged', () => {
  const doc = { accepted: true, checks: all(true) };
  assert.deepEqual(withKnownRoadGaps(doc), doc);
});

test('a failing flag outside the recorded gaps gets no known gap', () => {
  const out = withKnownRoadGaps({ accepted: false, checks: { ...all(true), newFlag: false } });
  assert.equal(out.knownGap, undefined);
});

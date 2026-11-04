import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceQaReport, QaReportError } from './reportPolicy.mjs';

const run = {
  runHash: 'run-28', sourceRevision: '4f143cf1', inputHashes: { parcels: 'parcels-sha', anchors: 'anchors-sha' },
  rawHash: 'raw-sha', packedHash: 'packed-sha',
};
const entry = (extra = {}) => ({
  id: 'door-A', metric: 'bearingDeg', value: 1, threshold: 1.5, operator: 'lte',
  status: 'measured', evidenceTier: 'T1', reason: null, evidence: 'vr/scene-A/door-A.png', ...extra,
});
const check = (kind, entries, extra = {}) => ({ id: kind, kind, ...structuredClone(run), status: 'complete', entries, ...extra });
const baseline = {
  id: 'door-A', metric: 'bearingDeg', value: 2, threshold: 1.5, operator: 'lte',
  reason: 'Scene A 2025 door-A correspondence remains displaced; cause not established.',
  evidence: 'review/door-A.md',
};

for (const kind of ['vr', 'overhead']) {
  const rows = [
    ['normal', entry(), [], 'pass', true, true, 1, 0],
    ['known over', entry({ value: 2 }), [baseline], 'warning', false, true, 1, 0],
    ['new over with reason', entry({ value: 2, reason: 'Scene A 2025 new mismatch, not yet reviewed.' }), [], 'fail', false, false, 1, 0],
    ['missing mask', entry({ status: 'error', value: null, reason: 'Missing ID mask', code: 'missing-mask' }), [], 'error', false, false, 0, 1],
    ['wrong wall', entry({ status: 'error', value: null, reason: 'Wall mapping disagrees', code: 'wrong-wall' }), [], 'error', false, false, 0, 1],
    ['T4', entry({ evidenceTier: 'T4', value: null, status: 'unknown', reason: 'Station not refined' }), [], 'unverified', null, false, 0, 1],
  ];
  for (const [label, finding, approved, status, pass, accepted, checked, unknown] of rows) {
    test(`${kind}: ${label} keeps raw accuracy separate from acceptance`, () => {
      const report = reduceQaReport(run, [check(kind, [finding], { approvedOverages: approved })]);
      assert.deepEqual(
        [report.status, report.pass, report.accepted, report.checked, report.unknown],
        [status, pass, accepted, checked, unknown],
      );
      assert.equal(report.findings[0].id, 'door-A');
      assert.equal(report.findings[0].metric, 'bearingDeg');
      assert.equal(report.findings[0].threshold, 1.5);
      assert.ok(report.findings[0].evidence);
    });
  }
}

test('common identity fields are retained with a schema version and per-check status', () => {
  const input = [check('vr', [entry()])];
  const before = structuredClone(input);
  const report = reduceQaReport(run, input);
  assert.equal(report.schemaVersion, 1);
  for (const key of Object.keys(run)) assert.deepEqual(report[key], run[key]);
  assert.deepEqual([report.checks[0].status, report.checks[0].checked, report.checks[0].unknown], ['pass', 1, 0]);
  assert.deepEqual(input, before);
});

test('all notRun retains reasons and never claims a pass', () => {
  const report = reduceQaReport(run, ['vr', 'overhead'].map(kind => check(kind, [], { status: 'notRun', reason: 'Candidate render unavailable' })));
  assert.deepEqual([report.status, report.pass, report.accepted, report.checked, report.unknown], ['notRun', null, false, 0, 2]);
  assert.deepEqual(report.checks.map(c => c.reason), ['Candidate render unavailable', 'Candidate render unavailable']);
});

for (const key of ['runHash', 'sourceRevision', 'inputHashes', 'rawHash', 'packedHash']) {
  test(`rejects a result with mismatched ${key}`, () => {
    const result = check('vr', [entry()], { [key]: key === 'inputHashes' ? { parcels: 'old' } : 'old' });
    assert.throws(() => reduceQaReport(run, [result]), error => error instanceof QaReportError && error.field === key);
  });
}

test('over-tolerance map entry without a reason fails', () => {
  const report = reduceQaReport(run, [check('map', [entry({ value: 2, tier: 'lane' })])]);
  assert.deepEqual([report.status, report.pass, report.accepted], ['fail', false, false]);
});

test('reasoned map overage is a warning without changing raw pass or scorer tier', () => {
  const report = reduceQaReport(run, [check('map', [entry({ value: 2, tier: 'lane', reason: baseline.reason })])]);
  assert.deepEqual([report.status, report.pass, report.accepted], ['warning', false, true]);
  assert.deepEqual([report.findings[0].tier, report.findings[0].evidenceTier], ['lane', 'T1']);
});

test('known id with a worsened value cannot reuse an approved exception', () => {
  const report = reduceQaReport(run, [check('vr', [entry({ value: 2.1 })], { approvedOverages: [baseline] })]);
  assert.deepEqual([report.status, report.pass, report.accepted], ['fail', false, false]);
});

test('a removed known overage is reported rather than silently matching by count', () => {
  const report = reduceQaReport(run, [check('vr', [entry({ id: 'door-B', value: 2 })], { approvedOverages: [baseline] })]);
  assert.deepEqual(report.checks[0].unusedApprovals, ['door-A/bearingDeg']);
  assert.equal(report.accepted, false);
});

test('unknown and road non-acceptance cannot become pass with an empty over list', () => {
  const report = reduceQaReport(run, [check('map', [entry()], { acceptance: { accepted: false, reason: 'Physical crossings missing' } })]);
  assert.deepEqual([report.pass, report.accepted, report.status], [false, false, 'fail']);
  assert.equal(report.checks[0].acceptance.reason, 'Physical crossings missing');
});

test('a recorded known gap lets the report pass the gate while raw pass stays false', () => {
  const gap = { accepted: false, reason: 'Physical crossings missing', knownGap: 'plan todo 24 [~], user decision 2026-11-04' };
  const report = reduceQaReport(run, [check('map', [entry()], { acceptance: gap })]);
  assert.deepEqual([report.pass, report.accepted, report.status], [false, true, 'warning']);
  assert.equal(report.checks[0].acceptance.knownGap, gap.knownGap);
});

test('a known gap without a reason still blocks', () => {
  const report = reduceQaReport(run, [check('map', [entry()], { acceptance: { accepted: false, knownGap: 'plan todo 24' } })]);
  assert.equal(report.accepted, false);
});

for (const [label, results] of [
  ['no checks', []],
  ['empty completed check', [check('vr', [])]],
  ['notRun without reason', [check('vr', [], { status: 'notRun' })]],
  ['NaN measurement', [check('vr', [entry({ value: NaN })])]],
  ['measured T4', [check('vr', [entry({ evidenceTier: 'T4' })])]],
  ['unknown without reason', [check('vr', [entry({ status: 'unknown', value: null })])]],
  ['missing evidence pointer', [check('vr', [entry({ evidence: '' })])]],
]) {
  test(`rejects ${label} instead of manufacturing a green report`, () => {
    assert.throws(() => reduceQaReport(run, results), QaReportError);
  });
}

test('gte support threshold uses the correct direction', () => {
  const report = reduceQaReport(run, [check('map', [entry({ metric: 'support', value: 0.49, threshold: 0.5, operator: 'gte' })])]);
  assert.equal(report.pass, false);
});

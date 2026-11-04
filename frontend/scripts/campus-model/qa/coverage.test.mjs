import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkCoverage, REQUIRED_ROWS } from './coverage.mjs';

// The design's row inventory is independent of the editable mapping table.
const ground = 'Ground_* 지면 클래스';
const complete = () => Object.fromEntries(REQUIRED_ROWS.map(row => [
  row, { generators: ['stages/example.mjs'], reports: ['.build/qa/example.json'] },
]));
const available = new Set(['stages/example.mjs', '.build/qa/example.json']);

test('complete generator and report mappings cover all 18 design rows', () => {
  assert.deepEqual(checkCoverage(complete(), available), { rows: 18, issues: [] });
});

test('removing the ground mapping still reports the required design row', () => {
  const table = complete();
  delete table[ground];
  assert.deepEqual(checkCoverage(table, available).issues, [
    { row: ground, reason: 'mapping missing' },
  ]);
});

for (const field of ['generators', 'reports']) {
  test(`a row without ${field} is unmapped even if the other files exist`, () => {
    const table = complete();
    table[ground][field] = [];
    assert.deepEqual(checkCoverage(table, available).issues, [
      { row: ground, reason: `${field} mapping missing` },
    ]);
  });
}

for (const missing of ['stages/example.mjs', '.build/qa/example.json']) {
  test(`a mapped but unavailable ${missing} fails every affected row`, () => {
    const files = new Set([...available].filter(path => path !== missing));
    const result = checkCoverage(complete(), files);
    assert.deepEqual(result.issues, REQUIRED_ROWS.map(row => ({
      row, reason: `file missing: ${missing}`,
    })));
  });
}

test('every generator and report in a row is required', () => {
  const table = complete();
  table[ground].reports.push('.build/qa/second.json');
  assert.deepEqual(checkCoverage(table, available).issues, [
    { row: ground, reason: 'file missing: .build/qa/second.json' },
  ]);
});

test('unknown row names cannot silently replace a design row', () => {
  const table = { ...complete(), 'Ground typo': complete()[ground] };
  assert.deepEqual(checkCoverage(table, available).issues, [
    { row: 'Ground typo', reason: 'unknown design row' },
  ]);
});

for (const value of [null, [], 'invalid']) {
  test(`rejects a malformed row-table boundary: ${JSON.stringify(value)}`, () => {
    assert.throws(() => checkCoverage(value, available), /row table must be an object/);
  });
}

test('rejects a malformed path list with the affected row name', () => {
  const table = complete();
  table[ground].reports = [42];
  assert.throws(() => checkCoverage(table, available), /Ground_\* 지면 클래스: reports must contain relative paths/);
});

// This fixture proves CLI exit/output and file loading, not real campus coverage.
for (const scenario of ['complete', 'ground removed', 'invalid report']) {
  test(`CLI reports ${scenario} from a temporary row table`, t => {
    const root = mkdtempSync(join(tmpdir(), 'campus-coverage-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'stages'));
    mkdirSync(join(root, '.build/qa'), { recursive: true });
    writeFileSync(join(root, 'stages/example.mjs'), 'export const example = true;\n');
    writeFileSync(join(root, '.build/qa/example.json'),
      scenario === 'invalid report' ? '{broken' : '{"checked":1}\n');
    const table = complete();
    if (scenario === 'ground removed') delete table[ground];
    writeFileSync(join(root, 'rows.json'), JSON.stringify(table));

    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('./coverage.mjs', import.meta.url)),
      '--root', root, '--table', join(root, 'rows.json'),
    ], { encoding: 'utf8' });

    assert.equal(result.status, scenario === 'complete' ? 0 : 1, result.stderr);
    if (scenario === 'complete') assert.equal(result.stdout.trim(), 'COVERAGE OK: 18 rows');
    else {
      assert.match(result.stderr, /Ground_\* 지면 클래스/);
      assert.match(result.stderr, scenario === 'ground removed' ? /mapping missing/ : /invalid report/);
      assert.doesNotMatch(result.stdout, /COVERAGE OK/);
    }
  });
}

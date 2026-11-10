import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isInfrastructureExit,
  labFailureReason,
  parseArgs,
  resolveArgv,
  sanitizeBranch,
} from './lab-test.mjs';

const LAB_STATE_OK = { preflight: 'ok', upload: 'ok', extract: 'ok', setup: 'ok' };

test('parseArgs reads a -- command without --py', () => {
  const args = parseArgs(['--', 'bun', 'run', 'test'], {});
  assert.equal(args.mode, 'run');
  assert.equal(args.py, false);
  assert.deepEqual(args.command, ['bun', 'run', 'test']);
  assert.equal(args.host, 'auto');
  assert.equal(args.timeoutS, 1800);
});

test('parseArgs reads --py and the pytest argv', () => {
  const args = parseArgs(['--py', '--', '-m', 'pytest', 'backend/tests'], { TEST_HOST: 'lab' });
  assert.equal(args.py, true);
  assert.deepEqual(args.command, ['-m', 'pytest', 'backend/tests']);
  assert.equal(args.host, 'lab');
});

test('parseArgs accepts --host in both spellings and the mode flags', () => {
  assert.equal(parseArgs(['--host', 'mac', '--', 'node', '--test', 'x.test.mjs'], {}).host, 'mac');
  assert.equal(parseArgs(['--host=lab', '--setup'], {}).host, 'lab');
  assert.equal(parseArgs(['--doctor'], {}).mode, 'doctor');
  assert.equal(parseArgs(['--setup'], {}).mode, 'setup');
});

test('parseArgs rejects a bad host, an unknown option and two modes', () => {
  assert.throws(() => parseArgs(['--host', 'windows'], {}), /--host must be one of/);
  assert.throws(() => parseArgs(['--nope'], {}), /unknown option/);
  assert.throws(() => parseArgs(['--setup', '--doctor'], {}), /exclusive/);
  assert.throws(() => parseArgs(['--timeout', 'zero'], {}), /positive number/);
});

test('labFailureReason falls back only on infrastructure failure', () => {
  assert.equal(labFailureReason(LAB_STATE_OK), null);
  assert.equal(labFailureReason({ ...LAB_STATE_OK, preflight: 'fail' }), 'lab unreachable');
  assert.equal(labFailureReason({ ...LAB_STATE_OK, upload: 'fail' }), 'lab upload failed');
  assert.equal(labFailureReason({ ...LAB_STATE_OK, extract: 'fail' }), 'lab extract failed');
  assert.equal(labFailureReason({ ...LAB_STATE_OK, setup: 'fail' }), 'lab setup failed');
  // preflight wins over later stages so the reason names the first broken step
  assert.equal(labFailureReason({ preflight: 'fail', upload: 'fail', extract: 'fail', setup: 'fail' }), 'lab unreachable');
});

test('isInfrastructureExit marks only the remote extract and setup codes', () => {
  assert.equal(isInfrastructureExit(96), true);
  assert.equal(isInfrastructureExit(97), true);
  for (const code of [0, 1, 2, 124, 127, 255]) assert.equal(isInfrastructureExit(code), false);
});

test('sanitizeBranch turns a git branch into a Windows directory name', () => {
  assert.equal(sanitizeBranch('feature/gt-w0-frame'), 'feature-gt-w0-frame');
  assert.equal(sanitizeBranch(' dev next '), 'dev-next');
  assert.equal(sanitizeBranch(''), 'detached');
});

test('resolveArgv prefixes the venv python only for --py', () => {
  const pythonPath = '/repo/.venv/bin/python';
  assert.deepEqual(resolveArgv({ py: false, command: ['bun', 'run', 'test'], pythonPath }), ['bun', 'run', 'test']);
  assert.deepEqual(resolveArgv({ py: true, command: ['-m', 'pytest'], pythonPath }), [pythonPath, '-m', 'pytest']);
  assert.deepEqual(resolveArgv({ py: true, command: ['pytest', 'backend/tests'], pythonPath }), [pythonPath, '-m', 'pytest', 'backend/tests']);
  assert.deepEqual(resolveArgv({ py: true, command: ['python', '-V'], pythonPath }), [pythonPath, '-V']);
  // the uv runner form used by todo 31 stays intact
  const uv = ['uv', 'run', '--with', 'pytest', 'pytest', 'x.py'];
  assert.deepEqual(resolveArgv({ py: true, command: uv, pythonPath }), uv);
});

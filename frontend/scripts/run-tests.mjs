import { spawnSync } from 'node:child_process';
import { existsSync, globSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nodeResult = spawnSync(process.execPath, ['--test', 'src/**/*.test.mjs', 'scripts/campus-model/**/*.test.mjs', 'scripts/perf/*.test.mjs'], {
  stdio: 'inherit',
});
const nodePassed = nodeResult.status === 0;

const vitestFiles = globSync('src/**/*.test.jsx').sort();
if (vitestFiles.length === 0) {
  throw new Error('No .test.jsx files found');
}

const vitestPath = require.resolve('vitest/vitest.mjs');
const vitestResult = spawnSync(process.execPath, [vitestPath, 'run', ...vitestFiles], {
  stdio: 'inherit',
});
const vitestPassed = vitestResult.status === 0;

// Static audit rows + token lint (scripts/qa/static-checks.mjs). Advisory until todo 21 creates
// scripts/qa/.static-enforced: every FAIL line is printed, but only an enforced run fails the suite.
let staticStatus = 'skipped';
let staticBlocks = false;
if (!process.argv.includes('--skip-static')) {
  const staticResult = spawnSync(process.execPath, ['scripts/qa/static-checks.mjs'], { stdio: 'inherit' });
  const staticPassed = staticResult.status === 0;
  const enforced = existsSync('scripts/qa/.static-enforced');
  staticStatus = staticPassed ? 'pass' : enforced ? 'fail' : 'advisory-fail';
  staticBlocks = enforced && !staticPassed;
}

console.log(`TEST SUMMARY node=${nodePassed ? 'pass' : 'fail'} vitest=${vitestPassed ? 'pass' : 'fail'} static=${staticStatus}`);
if (!nodePassed || !vitestPassed || staticBlocks) {
  process.exitCode = 1;
}

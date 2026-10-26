import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nodeResult = spawnSync(process.execPath, ['--test', 'src/**/*.test.mjs', 'scripts/campus-model/**/*.test.mjs'], {
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

console.log(`TEST SUMMARY node=${nodePassed ? 'pass' : 'fail'} vitest=${vitestPassed ? 'pass' : 'fail'}`);
if (!nodePassed || !vitestPassed) {
  process.exitCode = 1;
}

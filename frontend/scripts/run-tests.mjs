import { spawn } from 'node:child_process';
import { existsSync, globSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';

const require = createRequire(import.meta.url);

function run(label, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ['inherit', 'pipe', 'pipe'] });
    for (const [input, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      createInterface({ input, crlfDelay: Infinity }).on('line', (line) => {
        output.write(`[${label}] ${line}\n`);
      });
    }
    child.on('error', (error) => {
      console.error(`[${label}] ${error.message}`);
      resolve(false);
    });
    child.on('close', (code) => resolve(code === 0));
  });
}

const vitestFiles = globSync('src/**/*.test.jsx').sort();
if (vitestFiles.length === 0) {
  throw new Error('No .test.jsx files found');
}

const vitestPath = require.resolve('vitest/vitest.mjs');
const skipStatic = process.argv.includes('--skip-static');
const [nodePassed, vitestPassed, staticPassed] = await Promise.all([
  run('node', ['--test', 'src/**/*.test.mjs', 'scripts/campus-model/**/*.test.mjs', 'scripts/perf/**/*.test.mjs', 'scripts/lab/*.test.mjs']),
  run('vitest', [vitestPath, 'run', ...vitestFiles]),
  skipStatic ? Promise.resolve(true) : run('static', ['scripts/qa/static-checks.mjs']),
]);

// Static audit rows + token lint (scripts/qa/static-checks.mjs). Advisory until todo 21 creates
// scripts/qa/.static-enforced: every FAIL line is printed, but only an enforced run fails the suite.
let staticStatus = 'skipped';
let staticBlocks = false;
if (!skipStatic) {
  const enforced = existsSync('scripts/qa/.static-enforced');
  staticStatus = staticPassed ? 'pass' : enforced ? 'fail' : 'advisory-fail';
  staticBlocks = enforced && !staticPassed;
}

console.log(`TEST SUMMARY node=${nodePassed ? 'pass' : 'fail'} vitest=${vitestPassed ? 'pass' : 'fail'} static=${staticStatus}`);
if (!nodePassed || !vitestPassed || staticBlocks) {
  process.exitCode = 1;
}

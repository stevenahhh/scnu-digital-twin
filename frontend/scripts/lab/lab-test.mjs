#!/usr/bin/env bun
/**
 * lab-test.mjs - run tests on the Windows lab PC first, Mac as an infrastructure fallback.
 *
 * Usage (always from the repository root on the Mac):
 *   bun frontend/scripts/lab/lab-test.mjs --setup                 create both hosts' dependencies
 *   bun frontend/scripts/lab/lab-test.mjs --doctor                 print READY lab=yes|no mac=yes|no
 *   bun frontend/scripts/lab/lab-test.mjs -- <cmd...>              run in the uploaded frontend/ (lab) or frontend/ (Mac)
 *   bun frontend/scripts/lab/lab-test.mjs --py -- <args...>        run in the repository root with the worktree .venv python
 *   bun frontend/scripts/lab/lab-test.mjs --host mac -- <cmd...>   force the Mac
 *   bun frontend/scripts/lab/lab-test.mjs --host lab  --py -- uv run --with pytest -- pytest <file>
 *
 * Host: --host lab|mac|auto (default auto, env TEST_HOST), lab host alias from env LAB_HOST (default "lab").
 * Logs: $EVID/lab/<stamp>-lab.log or <stamp>-mac.log, with the first line "TEST HOST: lab" or
 * "TEST HOST: mac-fallback (<reason>)". EVID defaults to <repo>/.omo/evidence/campus-ground-truth-redesign.
 *
 * The Mac fallback only happens on infrastructure failure: the ssh preflight fails twice, the upload or
 * the extract fails, or the remote dependency setup exits 97. A failing test on the lab is a real failure
 * and is returned as is (never retried on the Mac).
 *
 * Remote layout: C:\Users\steve\gt-lab\<branch>\ (repo/, .venv/, tools/, deps/). Only that directory is
 * touched; dt-lab, the other clones and the Funnel ports are never touched.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const FRONTEND_ROOT = path.join(REPO_ROOT, 'frontend');
const HEAVY_WRAPPER = '/Users/gahn/.cache/scnu-heavy/scnu-heavy';
const LAB_BASE_DEFAULT = 'C:\\Users\\steve\\gt-lab';
const REQUIREMENTS = ['weather/requirements.txt', 'backend/simulation/requirements.txt'];
const EVIDENCE_SUBDIR = path.join('.omo', 'evidence', 'campus-ground-truth-redesign');
const EXIT_EXTRACT_FAILURE = 96;
const EXIT_SETUP_FAILURE = 97;
const EXIT_TIMEOUT = 124;
const HOSTS = ['auto', 'lab', 'mac'];
const SKIP_SEGMENTS = new Set(['node_modules', '.venv', '.cache', '.build', '.omo', '.senpi', '.git', '__pycache__', '.pytest_cache', 'dist', 'dist-vworld']);

// ---------------------------------------------------------------------------------------------
// Pure logic (covered by lab-test.test.mjs)
// ---------------------------------------------------------------------------------------------

export function parseArgs(argv, env = {}) {
  const parsed = { mode: 'run', host: null, py: false, command: [], timeoutS: null, help: false };
  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    if (arg === '--') {
      parsed.command = argv.slice(index + 1);
      index = argv.length;
      break;
    }
    if (arg === '--setup' || arg === '--doctor') {
      if (parsed.mode !== 'run' && parsed.mode !== arg.slice(2)) throw new Error(`--${parsed.mode} and ${arg} are exclusive`);
      parsed.mode = arg.slice(2);
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      index += 1;
      continue;
    }
    if (arg === '--py') {
      parsed.py = true;
      index += 1;
      continue;
    }
    if (arg === '--host') {
      if (argv[index + 1] === undefined) throw new Error('--host needs a value (lab|mac|auto)');
      parsed.host = argv[index + 1];
      index += 2;
      continue;
    }
    if (arg.startsWith('--host=')) {
      parsed.host = arg.slice('--host='.length);
      index += 1;
      continue;
    }
    if (arg === '--timeout') {
      if (argv[index + 1] === undefined) throw new Error('--timeout needs a value in seconds');
      parsed.timeoutS = Number(argv[index + 1]);
      index += 2;
      continue;
    }
    if (arg.startsWith('--timeout=')) {
      parsed.timeoutS = Number(arg.slice('--timeout='.length));
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    parsed.command = argv.slice(index);
    index = argv.length;
    break;
  }
  if (parsed.host === null || parsed.host === undefined) parsed.host = env.TEST_HOST || 'auto';
  if (!HOSTS.includes(parsed.host)) throw new Error(`--host must be one of ${HOSTS.join('|')} (got ${parsed.host})`);
  if (parsed.timeoutS === null || parsed.timeoutS === undefined) {
    const fromEnv = Number(env.LAB_TIMEOUT_S || 1800);
    parsed.timeoutS = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 1800;
  }
  if (!Number.isFinite(parsed.timeoutS) || parsed.timeoutS <= 0) throw new Error('--timeout must be a positive number of seconds');
  return parsed;
}

export function sanitizeBranch(branch) {
  const cleaned = String(branch || '').trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'detached';
}

/** A lab infrastructure state -> fallback reason, or null when the lab ran the command. */
export function labFailureReason(state) {
  if (state.preflight !== 'ok') return 'lab unreachable';
  if (state.upload !== 'ok') return 'lab upload failed';
  if (state.extract !== 'ok') return 'lab extract failed';
  if (state.setup !== 'ok') return 'lab setup failed';
  return null;
}

export function isInfrastructureExit(code) {
  return code === EXIT_EXTRACT_FAILURE || code === EXIT_SETUP_FAILURE;
}

/**
 * Turn the user command into the argv that actually runs, given the --py flag.
 * pythonPath is the venv interpreter (the worktree .venv on the Mac, the lab .venv on Windows).
 */
export function resolveArgv({ py, command, pythonPath }) {
  const argv = [...command];
  if (!py || argv.length === 0) return argv;
  const first = argv[0];
  if (first.startsWith('-')) return [pythonPath, ...argv];
  const base = first.replace(/\\/g, '/').split('/').pop().toLowerCase();
  if (['python', 'python.exe', 'python3', 'py', 'py.exe'].includes(base)) return [pythonPath, ...argv.slice(1)];
  if (['pytest', 'pytest.exe'].includes(base)) return [pythonPath, '-m', 'pytest', ...argv.slice(1)];
  return argv;
}

export function usage() {
  return [
    'lab-test.mjs - lab PC first, Mac fallback',
    '',
    '  --setup                        install both hosts\' dependencies (lab upload + bun install + uv venv; Mac .venv + node_modules)',
    '  --doctor                       check both hosts and print READY lab=yes|no mac=yes|no',
    '  -- <cmd...>                    run <cmd> in frontend/ (lab: uploaded copy, Mac: this worktree)',
    '  --py -- <args...>              run in the repository root with the .venv python (e.g. --py -- -m pytest)',
    '  --host lab|mac|auto            force a host (default auto, env TEST_HOST)',
    '  --timeout <seconds>            bound the command (default 1800, env LAB_TIMEOUT_S)',
    '',
    'env: LAB_HOST (ssh alias, default "lab"), LAB_BASE (lab root, default C:\\Users\\steve\\gt-lab),',
    '     EVID (evidence dir, default <repo>/.omo/evidence/campus-ground-truth-redesign)',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------------------------

function sh(cmd, argv, options = {}) {
  const result = spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error };
}

class Tee {
  constructor(filePath, flags = 'w') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.path = filePath;
    this.fd = fs.openSync(filePath, flags);
  }

  write(text) {
    if (!text) return;
    process.stdout.write(text);
    fs.writeSync(this.fd, text);
  }

  close() {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

/** Spawn a process, tee its output into the log, and kill it when it outlives timeoutS. */
const NULL_TEE = { write() {} };

function runTee(cmd, argv, { cwd = REPO_ROOT, env = {}, tee = NULL_TEE, timeoutS = 0, capture = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const outDecoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');
    let output = '';
    const emit = (text) => {
      if (!text) return;
      if (capture) output += text;
      tee.write(text);
    };
    child.stdout.on('data', (chunk) => emit(outDecoder.write(chunk)));
    child.stderr.on('data', (chunk) => emit(errDecoder.write(chunk)));
    let timedOut = false;
    const timer = timeoutS
      ? setTimeout(() => {
          timedOut = true;
          tee.write(`\n[lab-test] local timeout after ${timeoutS}s; killing ${cmd}\n`);
          child.kill('SIGKILL');
        }, timeoutS * 1000)
      : null;
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      tee.write(`[lab-test] spawn failed: ${error.message}\n`);
      resolve({ code: 127, output, timedOut });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      emit(outDecoder.end());
      emit(errDecoder.end());
      resolve({ code: code ?? (timedOut ? EXIT_TIMEOUT : 1), output, timedOut });
    });
  });
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function fileSha256(filePath) {
  return sha256(fs.readFileSync(filePath));
}

// ---------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------

function makeContext() {
  const head = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO_ROOT });
  const branch = sanitizeBranch(head.code === 0 ? head.stdout.trim() : 'detached');
  const labHost = process.env.LAB_HOST || 'lab';
  const labBase = process.env.LAB_BASE || LAB_BASE_DEFAULT;
  const labDir = `${labBase}\\${branch}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const evid = process.env.EVID || path.join(REPO_ROOT, EVIDENCE_SUBDIR);
  const logDir = path.join(evid, 'lab');
  const tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'lab-test-'));
  return {
    branch,
    labHost,
    labDir,
    labDirPosix: labDir.replace(/\\/g, '/'),
    labTools: `${labDir}\\tools`,
    labRepo: `${labDir}\\repo`,
    labVenv: `${labDir}\\.venv`,
    labPython: `${labDir}\\.venv\\Scripts\\python.exe`,
    stamp,
    evid,
    logDir,
    tmpDir,
    ps1Path: path.join(HERE, 'lab.ps1'),
    macPython: path.join(REPO_ROOT, '.venv', 'bin', 'python'),
  };
}

function bunLockHash() {
  return fileSha256(path.join(FRONTEND_ROOT, 'bun.lock'));
}

function requirementsHash() {
  const hash = createHash('sha256');
  for (const rel of REQUIREMENTS) {
    hash.update(rel).update('\0');
    hash.update(fs.readFileSync(path.join(REPO_ROOT, rel)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

// ---------------------------------------------------------------------------------------------
// Lab transport
// ---------------------------------------------------------------------------------------------

function sshBase(ctx) {
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', ctx.labHost];
}

async function sshCommand(ctx, remoteCommand, { tee, timeoutS = 60, capture = true } = {}) {
  return runTee('ssh', [...sshBase(ctx), remoteCommand], { tee, timeoutS, capture });
}

function powershellCommand(scriptPath, jobB64) {
  return `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -JobB64 ${jobB64}`;
}

async function preflight(ctx, tee) {
  let detail = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = await sshCommand(ctx, 'echo ok', { tee: NULL_TEE, timeoutS: 25 });
    detail += `attempt ${attempt}: exit ${result.code}\n`;
    if (result.code === 0 && /ok/.test(result.output)) {
      if (tee) tee.write(`[lab-test] preflight ok (attempt ${attempt})\n`);
      return { ok: true, detail };
    }
    if (tee) tee.write(`[lab-test] preflight attempt ${attempt} failed (exit ${result.code})\n`);
  }
  return { ok: false, detail };
}

async function runRemoteJob(ctx, mode, payload, { tee, timeoutS = 300, capture = true, echo = true } = {}) {
  const job = { mode, ...payload };
  const jobB64 = Buffer.from(JSON.stringify(job), 'utf8').toString('base64');
  return runTee('ssh', [...sshBase(ctx), powershellCommand(`${ctx.labTools}\\lab.ps1`, jobB64)], {
    tee: echo ? tee : NULL_TEE,
    timeoutS,
    capture,
  });
}

async function labPrepare(ctx, tee) {
  // 1. Only C:\Users\steve\gt-lab\<branch>\ is created; no other lab directory is touched.
  const mkdir = `powershell -NoProfile -Command [void](New-Item -ItemType Directory -Force -Path '${ctx.labDir}','${ctx.labTools}')`;
  const made = await sshCommand(ctx, mkdir, { tee, timeoutS: 60 });
  if (made.code !== 0) return { ok: false, reason: 'lab upload failed', detail: made.output };
  // 2. Upload the UTF-8-BOM helper script (cmd.exe is the default shell, so long commands fail).
  const scp = await runTee(
    'scp',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', ctx.ps1Path, `${ctx.labHost}:${ctx.labDirPosix}/tools/lab.ps1`],
    { tee, timeoutS: 120, capture: true },
  );
  if (scp.code !== 0) return { ok: false, reason: 'lab upload failed', detail: scp.output };
  return { ok: true };
}

function listRepoFiles() {
  const result = sh('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: REPO_ROOT });
  if (result.code !== 0) throw new Error(`git ls-files failed: ${result.stderr}`);
  return result.stdout
    .split('\0')
    .filter(Boolean)
    .filter((rel) => !rel.split('/').some((segment) => SKIP_SEGMENTS.has(segment)))
    .filter((rel) => fs.existsSync(path.join(REPO_ROOT, rel)))
    .sort();
}

/** Content key of the upload image: identical bytes -> identical key, so a re-upload is skipped. */
function contentKeyOf(hashes) {
  const hash = createHash('sha256');
  for (const rel of [...hashes.keys()].sort()) {
    hash.update(rel);
    hash.update('\0');
    hash.update(hashes.get(rel));
    hash.update('\n');
  }
  return hash.digest('hex');
}

function parseRemoteManifest(output) {
  const line = (output.match(/^MANIFEST=(.*)$/m) || [])[1];
  if (!line) return null;
  try {
    const decoded = JSON.parse(Buffer.from(line, 'base64').toString('utf8'));
    const map = new Map();
    for (const [rel, sha] of Object.entries(decoded)) map.set(rel, sha);
    return map;
  } catch {
    return null;
  }
}

function buildTar(ctx, name, rels) {
  const listPath = path.join(ctx.tmpDir, `${name}.txt`);
  fs.writeFileSync(listPath, rels.length ? `${rels.join('\n')}\n` : '');
  const tarPath = path.join(ctx.tmpDir, `${name}-${ctx.stamp}.tar`);
  const tar = spawnSync('tar', ['-cf', tarPath, '-T', listPath], {
    cwd: REPO_ROOT,
    env: { ...process.env, COPYFILE_DISABLE: '1' },
    encoding: 'utf8',
  });
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
  return tarPath;
}

async function scpFile(ctx, localPath, remoteName, tee, timeoutS) {
  return runTee(
    'scp',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', localPath, `${ctx.labHost}:${ctx.labDirPosix}/tools/${remoteName}`],
    { tee, timeoutS },
  );
}

async function labSync(ctx, tee, { force = false } = {}) {
  const files = listRepoFiles();
  const hashes = new Map();
  for (const rel of files) hashes.set(rel, fileSha256(path.join(REPO_ROOT, rel)));
  const contentKey = contentKeyOf(hashes);
  const state = { upload: 'ok', extract: 'ok' };
  const status = await runRemoteJob(
    ctx,
    'status',
    { repoDir: ctx.labRepo, toolsDir: ctx.labTools },
    { tee, timeoutS: 60, echo: false },
  );
  const present = /REPO_PRESENT=yes/.test(status.output);
  const remoteKey = (status.output.match(/REPO_SHA256=(\S*)/) || [])[1] || '-';
  const remoteFiles = present ? parseRemoteManifest(status.output) : null;

  if (!force && present && remoteKey === contentKey) {
    tee.write(`[lab-test] lab repo already at ${contentKey.slice(0, 12)} (${files.length} files); skipping transfer\n`);
    return state;
  }

  // Send only files whose bytes changed; a full upload stays the fallback for a first run or a big change.
  let uploadSet = files;
  if (!force && remoteFiles) {
    uploadSet = files.filter((rel) => remoteFiles.get(rel) !== hashes.get(rel));
    if (uploadSet.length > files.length * 0.6) uploadSet = files;
  }
  const deleted = remoteFiles ? [...remoteFiles.keys()].filter((rel) => !hashes.has(rel)) : [];
  tee.write(`[lab-test] upload image ${contentKey.slice(0, 12)}: ${uploadSet.length}/${files.length} files changed, ${deleted.length} removed\n`);

  const tarPath = buildTar(ctx, 'upload', uploadSet);
  const sizeMb = (fs.statSync(tarPath).size / (1024 * 1024)).toFixed(2);
  tee.write(`[lab-test] uploading ${sizeMb} MB\n`);
  if ((await scpFile(ctx, tarPath, `repo-${ctx.stamp}.tar`, tee, 1800)).code !== 0) {
    state.upload = 'fail';
    return state;
  }
  const manifestTxt = path.join(ctx.tmpDir, 'files.txt');
  const manifestJson = path.join(ctx.tmpDir, 'hashes.json');
  fs.writeFileSync(manifestTxt, `${files.join('\n')}\n`);
  fs.writeFileSync(manifestJson, JSON.stringify(Object.fromEntries(hashes)));
  if ((await scpFile(ctx, manifestTxt, 'manifest.txt', tee, 120)).code !== 0) {
    state.upload = 'fail';
    return state;
  }
  if ((await scpFile(ctx, manifestJson, 'hashes.next.json', tee, 120)).code !== 0) {
    state.upload = 'fail';
    return state;
  }
  const extract = await runRemoteJob(
    ctx,
    'extract',
    {
      repoDir: ctx.labRepo,
      toolsDir: ctx.labTools,
      archive: `${ctx.labTools}\\repo-${ctx.stamp}.tar`,
      manifest: `${ctx.labTools}\\manifest.txt`,
      manifestHash: `${ctx.labTools}\\hashes.next.json`,
      contentKey,
    },
    { tee, timeoutS: 1800 },
  );
  if (extract.code !== 0) {
    state.extract = 'fail';
    return state;
  }
  return state;
}

async function labSetupStep(ctx, tee) {
  return runRemoteJob(
    ctx,
    'setup',
    {
      branchDir: ctx.labDir,
      repoDir: ctx.labRepo,
      venvDir: ctx.labVenv,
      uvExe: 'C:\\Python314\\Scripts\\uv.exe',
      bunHash: bunLockHash(),
      pyHash: requirementsHash(),
    },
    { tee, timeoutS: 1800 },
  );
}

// ---------------------------------------------------------------------------------------------
// Mac transport
// ---------------------------------------------------------------------------------------------

function macArgv(ctx, args) {
  const argv = resolveArgv({ py: args.py, command: args.command, pythonPath: ctx.macPython });
  if (fs.existsSync(HEAVY_WRAPPER)) return [HEAVY_WRAPPER, ...argv];
  return argv;
}

async function macRun(ctx, args, tee, timeoutS) {
  const cwd = args.py ? REPO_ROOT : FRONTEND_ROOT;
  const argv = macArgv(ctx, args);
  if (!fs.existsSync(HEAVY_WRAPPER)) {
    tee.write(`[lab-test] WARNING: heavy wrapper missing at ${HEAVY_WRAPPER}; running without a slot\n`);
  }
  tee.write(`[lab-test] mac run: ${argv.join(' ')} (cwd ${cwd})\n`);
  return runTee(argv[0], argv.slice(1), {
    cwd,
    env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', NO_COLOR: '1' },
    tee,
    timeoutS,
  });
}

// ---------------------------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------------------------

async function runOnMac(ctx, args, reason) {
  const tee = new Tee(path.join(ctx.logDir, `${ctx.stamp}-mac.log`));
  try {
    tee.write(reason ? `TEST HOST: mac-fallback (${reason})\n` : 'TEST HOST: mac\n');
    if (reason) tee.write(`[lab-test] the lab could not run this command: ${reason}\n`);
    const result = await macRun(ctx, args, tee, args.timeoutS + 120);
    tee.write(`[lab-test] mac exit ${result.code}\n`);
    return result.code;
  } finally {
    tee.close();
  }
}

async function modeRun(ctx, args) {
  if (args.command.length === 0) throw new Error('nothing to run: pass -- <command...> or --py -- <args...>');
  if (args.host === 'mac') return { code: await runOnMac(ctx, args, null) };
  if (process.platform !== 'darwin') throw new Error('the lab runner must be started from the Mac');

  const pre = await preflight(ctx);
  if (!pre.ok) {
    if (args.host === 'lab') {
      const tee = new Tee(path.join(ctx.logDir, `${ctx.stamp}-lab.log`));
      tee.write(`TEST HOST: lab\n[lab-test] PREFLIGHT FAILED after 2 attempts\n${pre.detail}`);
      tee.close();
      return { code: 1 };
    }
    process.stdout.write(`[lab-test] lab preflight failed twice\n${pre.detail}`);
    return { code: await runOnMac(ctx, args, 'lab unreachable') };
  }

  const tee = new Tee(path.join(ctx.logDir, `${ctx.stamp}-lab.log`));
  try {
    tee.write('TEST HOST: lab\n');
    const prepared = await labPrepare(ctx, tee);
    if (!prepared.ok) {
      const state = { preflight: 'ok', upload: 'fail' };
      const reason = labFailureReason(state);
      tee.write(`[lab-test] infrastructure failure: ${reason}\n${prepared.detail || ''}`);
      tee.close();
      if (args.host === 'lab') return { code: 1 };
      return { code: await runOnMac(ctx, args, reason) };
    }
    const sync = await labSync(ctx, tee, { force: false });
    let state = { preflight: 'ok', upload: sync.upload, extract: sync.extract, setup: 'ok' };
    let reason = labFailureReason(state);
    if (reason) {
      tee.write(`[lab-test] infrastructure failure: ${reason}\n`);
      tee.close();
      if (args.host === 'lab') return { code: 1 };
      return { code: await runOnMac(ctx, args, reason) };
    }
    const setup = await labSetupStep(ctx, tee);
    if (setup.code !== 0) {
      state = { ...state, setup: 'fail' };
      reason = labFailureReason(state);
      tee.write(`[lab-test] infrastructure failure: ${reason} (setup exit ${setup.code})\n`);
      tee.close();
      if (args.host === 'lab') return { code: EXIT_SETUP_FAILURE };
      return { code: await runOnMac(ctx, args, reason) };
    }
    const argv = resolveArgv({ py: args.py, command: args.command, pythonPath: ctx.labPython });
    const result = await runRemoteJob(
      ctx,
      'run',
      {
        toolsDir: ctx.labTools,
        stamp: ctx.stamp,
        exe: argv[0],
        argv,
        cwd: args.py ? ctx.labRepo : `${ctx.labRepo}\\frontend`,
        env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', NO_COLOR: '1' },
        timeoutS: args.timeoutS,
      },
      { tee, timeoutS: args.timeoutS + 120 },
    );
    tee.write(`[lab-test] lab exit ${result.code}\n`);
    if (isInfrastructureExit(result.code)) {
      // The runner's own infra codes never mean "fall back" once the command actually ran.
      tee.write(`[lab-test] note: exit ${result.code} is the test result; a red test is never retried on the Mac\n`);
    }
    return { code: result.code };
  } finally {
    tee.close();
  }
}

async function modeSetup(ctx) {
  const outcome = { lab: 'fail', mac: 'fail', details: [] };
  const labTee = new Tee(path.join(ctx.logDir, `${ctx.stamp}-lab-setup.log`));
  try {
    labTee.write('SETUP lab\n');
    const pre = await preflight(ctx, labTee);
    if (!pre.ok) {
      labTee.write(`[lab-test] preflight failed twice\n${pre.detail}`);
      outcome.details.push('lab: unreachable (ssh preflight failed twice)');
    } else {
      const prepared = await labPrepare(ctx, labTee);
      if (!prepared.ok) {
        outcome.details.push(`lab: ${prepared.reason}`);
      } else {
        const sync = await labSync(ctx, labTee, { force: true });
        if (sync.upload !== 'ok' || sync.extract !== 'ok') {
          outcome.details.push(`lab: upload=${sync.upload} extract=${sync.extract}`);
        } else {
          const setup = await labSetupStep(ctx, labTee);
          if (setup.code === 0) {
            outcome.lab = 'ok';
            outcome.details.push(`lab: deps ready at ${ctx.labDir}`);
          } else {
            outcome.details.push(`lab: setup exit ${setup.code}`);
          }
        }
      }
    }
  } finally {
    labTee.close();
  }

  const macTee = new Tee(path.join(ctx.logDir, `${ctx.stamp}-mac-setup.log`));
  try {
    macTee.write('SETUP mac\n');
    const venvPython = ctx.macPython;
    if (!fs.existsSync(venvPython)) {
      macTee.write('[lab-test] uv venv .venv --python 3.14\n');
      const venv = await runTee(HEAVY_WRAPPER, ['uv', 'venv', '.venv', '--python', '3.14'], { cwd: REPO_ROOT, tee: macTee, timeoutS: 600 });
      if (venv.code !== 0) outcome.details.push(`mac: uv venv exit ${venv.code}`);
    }
    if (fs.existsSync(venvPython)) {
      const marker = path.join(REPO_ROOT, '.venv', `.lab-req-${requirementsHash().slice(0, 16)}`);
      if (!fs.existsSync(marker)) {
        const installArgs = ['uv', 'pip', 'install', ...REQUIREMENTS.flatMap((rel) => ['-r', rel]), '--python', '.venv/bin/python'];
        macTee.write(`[lab-test] ${installArgs.join(' ')}\n`);
        const install = await runTee(HEAVY_WRAPPER, installArgs, { cwd: REPO_ROOT, tee: macTee, timeoutS: 1800 });
        if (install.code === 0) fs.writeFileSync(marker, requirementsHash());
        else outcome.details.push(`mac: uv pip install exit ${install.code}`);
      }
      if (fs.existsSync(marker)) outcome.mac = 'ok';
    } else {
      outcome.details.push('mac: .venv python missing');
    }
    const lockMarker = path.join(FRONTEND_ROOT, 'node_modules', `.lab-lock-${bunLockHash().slice(0, 16)}`);
    {
      // Always confirm node_modules against the lockfile; a matched install is a fast no-op.
      macTee.write('[lab-test] bun install --cwd frontend --frozen-lockfile\n');
      const install = await runTee(HEAVY_WRAPPER, ['bun', 'install', '--cwd', 'frontend', '--frozen-lockfile'], {
        cwd: REPO_ROOT,
        tee: macTee,
        timeoutS: 1800,
      });
      if (install.code === 0) {
        fs.mkdirSync(path.dirname(lockMarker), { recursive: true });
        fs.writeFileSync(lockMarker, bunLockHash());
      } else {
        outcome.mac = 'fail';
        outcome.details.push(`mac: bun install exit ${install.code}`);
      }
    }
    if (outcome.mac === 'ok') outcome.details.push(`mac: deps ready (${REPO_ROOT})`);
  } finally {
    macTee.close();
  }

  const summary = new Tee(path.join(ctx.logDir, `${ctx.stamp}-setup.log`));
  try {
    summary.write(`SETUP SUMMARY lab=${outcome.lab} mac=${outcome.mac}\n`);
    for (const line of outcome.details) summary.write(`  ${line}\n`);
  } finally {
    summary.close();
  }
  process.stdout.write(`SETUP lab=${outcome.lab} mac=${outcome.mac}\n`);
  return outcome.lab === 'ok' || outcome.mac === 'ok' ? 0 : 1;
}

async function modeDoctor(ctx) {
  const report = { lab: 'no', mac: 'no', lines: [] };
  const tee = new Tee(path.join(ctx.logDir, `${ctx.stamp}-doctor.log`));
  try {
    tee.write('DOCTOR\n');
    const pre = await preflight(ctx, tee);
    if (!pre.ok) {
      report.lines.push('lab: unreachable (ssh preflight failed twice)');
    } else {
      const prepared = await labPrepare(ctx, tee);
      if (!prepared.ok) {
        report.lines.push(`lab: ${prepared.reason}`);
      } else {
        const doctor = await runRemoteJob(
          ctx,
          'doctor',
          { branchDir: ctx.labDir, repoDir: ctx.labRepo, venvDir: ctx.labVenv, bunHash: bunLockHash(), pyHash: requirementsHash() },
          { tee, timeoutS: 180 },
        );
        report.lab = /LAB READY=yes/.test(doctor.output) ? 'yes' : 'no';
        for (const line of doctor.output.split('\n')) {
          if (line.startsWith('lab ') || line.startsWith('[lab]')) report.lines.push(line);
        }
      }
    }

    const macProblems = [];
    const lockMarker = path.join(FRONTEND_ROOT, 'node_modules', `.lab-lock-${bunLockHash().slice(0, 16)}`);
    if (!fs.existsSync(lockMarker)) macProblems.push('node_modules not installed for this bun.lock');
    if (!fs.existsSync(ctx.macPython)) macProblems.push('.venv/bin/python missing');
    else {
      const marker = path.join(REPO_ROOT, '.venv', `.lab-req-${requirementsHash().slice(0, 16)}`);
      if (!fs.existsSync(marker)) macProblems.push('.venv requirements not installed for these requirements');
    }
    if (!fs.existsSync(HEAVY_WRAPPER)) macProblems.push(`heavy wrapper missing: ${HEAVY_WRAPPER}`);
    if (macProblems.length === 0) report.mac = 'yes';
    report.lines.push(`mac node_modules: ${fs.existsSync(lockMarker) ? 'ok' : 'missing'}`);
    report.lines.push(`mac .venv: ${fs.existsSync(ctx.macPython) ? 'ok' : 'missing'}`);
    report.lines.push(`mac heavy wrapper: ${fs.existsSync(HEAVY_WRAPPER) ? 'ok' : 'missing'}`);
    for (const problem of macProblems) report.lines.push(`mac problem: ${problem}`);

    // the lab lines were streamed by the doctor job above; only the Mac side is new here
    for (const line of report.lines.filter((entry) => entry.startsWith('mac'))) tee.write(`${line}\n`);
  } finally {
    tee.close();
  }
  process.stdout.write(`READY lab=${report.lab} mac=${report.mac}\n`);
  return report.lab === 'yes' || report.mac === 'yes' ? 0 : 1;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2), process.env);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    return 2;
  }
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const ctx = makeContext();
  try {
    if (args.mode === 'setup') return await modeSetup(ctx);
    if (args.mode === 'doctor') return await modeDoctor(ctx);
    const outcome = await modeRun(ctx, args);
    if (outcome.code !== 0) process.stdout.write(`[lab-test] FAILED exit=${outcome.code}\n`);
    return outcome.code;
  } finally {
    fs.rmSync(ctx.tmpDir, { recursive: true, force: true });
  }
}

const invokedDirectly = typeof import.meta.main === 'boolean'
  ? import.meta.main
  : process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`[lab-test] FATAL ${error && error.stack ? error.stack : error}\n`);
    process.exitCode = 1;
  });
}

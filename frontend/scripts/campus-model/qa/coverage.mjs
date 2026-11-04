#!/usr/bin/env bun
// Design section 20 inventory. Keep it separate from the editable mapping table:
// deleting a mapping must not also delete the obligation to cover that row.
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const REQUIRED_ROWS = Object.freeze([
  'BLD_* 위치·발자국',
  'BLD_* 매스·날개·코어',
  '지붕 색·태양광',
  '입면(창·출입구·악센트)',
  '출입구·캐노피',
  'Topography',
  'Ground_* 지면 클래스',
  'Kerbs, 촉지, 단차',
  '주차 디바이더·장애인 구역·휠스톱',
  '차선·중앙선·가장자리선·연석선',
  '정지선·횡단보도·화살표·글자·과속방지턱',
  '광장 가구·쉼터·정자·정문 구조물·관람석',
  '가로등·신호등',
  '수목',
  '생울타리·화단',
  '간판·현판·LED',
  '캠퍼스 밖 건물·도로·외곽 지형',
  '교통 네트워크 좌표',
]);

/**
 * Pure row-table check. Files and parsed reports are snapshots, not I/O.
 * @param {Record<string, {generators?: readonly string[], reports?: readonly string[]}>} table
 * @param {ReadonlySet<string>} availableFiles
 * @param {ReadonlyMap<string, object>} reports
 */
export function checkCoverage(table, availableFiles, reports = new Map()) {
  if (!table || typeof table !== 'object' || Array.isArray(table)) {
    throw new TypeError('row table must be an object');
  }
  const issues = [];
  for (const row of REQUIRED_ROWS) {
    const entry = table[row];
    if (!entry) {
      issues.push({ row, reason: 'mapping missing' });
      continue;
    }
    for (const field of ['generators', 'reports']) {
      const paths = entry[field];
      if (paths === undefined || (Array.isArray(paths) && paths.length === 0)) {
        issues.push({ row, reason: `${field} mapping missing` });
        continue;
      }
      if (!Array.isArray(paths) || paths.some(p => typeof p !== 'string' ||
          !p.trim() || p.startsWith('/') || p.includes('\\') || p.split('/').includes('..'))) {
        throw new TypeError(`${row}: ${field} must contain relative paths`);
      }
      for (const path of paths) {
        if (!availableFiles.has(path)) {
          issues.push({ row, reason: `file missing: ${path}` });
          continue;
        }
        if (field !== 'reports') continue;
        const checks = reports.get(path)?.checks;
        const matches = Array.isArray(checks) ? checks.filter(check => check.id === row) : [];
        if (matches.length !== 1) {
          issues.push({ row, reason: `category entry missing or duplicate: ${path}` });
          continue;
        }
        const check = matches[0];
        // Coverage includes explicit failures and unknowns, but not empty/notRun
        // receipts or an unrelated report that merely exists.
        if (!['pass', 'fail', 'error', 'unverified', 'warning'].includes(check.status) ||
            !Number.isInteger(check.checked) || !Number.isInteger(check.unknown) ||
            check.checked < 0 || check.unknown < 0 || check.checked + check.unknown === 0 ||
            !Array.isArray(check.findings) || check.findings.length === 0 ||
            check.findings.some(f => typeof f.metric !== 'string' || !f.metric.trim() ||
              typeof f.evidence !== 'string' || !f.evidence.trim() ||
              !['pass', 'fail', 'error', 'unverified', 'warning'].includes(f.status) ||
              !Object.hasOwn(f, 'value') || !Object.hasOwn(f, 'threshold'))) {
          issues.push({ row, reason: `invalid category entry: ${path}` });
        }
      }
    }
  }
  for (const row of Object.keys(table)) {
    if (!REQUIRED_ROWS.includes(row)) issues.push({ row, reason: 'unknown design row' });
  }
  return { rows: REQUIRED_ROWS.length, issues };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: {
      table: { type: 'string', default: fileURLToPath(new URL('./coverage-rows.json', import.meta.url)) },
      root: { type: 'string', default: fileURLToPath(new URL('../', import.meta.url)) },
    } });
    const table = JSON.parse(readFileSync(values.table, 'utf8'));
    // Validate the external table before inspecting any paths.
    checkCoverage(table, new Set());
    const files = new Set();
    const reports = new Map();
    const reportErrors = new Map();
    for (const entry of Object.values(table)) {
      for (const field of ['generators', 'reports']) {
        for (const path of entry?.[field] ?? []) {
          const absolute = resolve(values.root, path);
          if (!statSync(absolute, { throwIfNoEntry: false })?.isFile()) continue;
          files.add(path);
          if (field === 'reports') {
            if (reports.has(path) || reportErrors.has(path)) continue;
            try {
              const report = JSON.parse(readFileSync(absolute, 'utf8'));
              if (!report || typeof report !== 'object' || Object.keys(report).length === 0) {
                reportErrors.set(path, 'expected a nonempty JSON report');
              }
              reports.set(path, report);
            } catch (error) {
              if (!(error instanceof SyntaxError)) throw error;
              reportErrors.set(path, error.message);
            }
          }
        }
      }
    }
    const result = checkCoverage(table, files, reports);
    for (const [row, entry] of Object.entries(table)) {
      for (const path of entry?.reports ?? []) {
        if (reportErrors.has(path)) result.issues.push({
          row, reason: `invalid report: ${path}: ${reportErrors.get(path)}`,
        });
      }
    }
    for (const issue of result.issues) console.error(`UNMAPPED ${issue.row}: ${issue.reason}`);
    if (result.issues.length) {
      console.error(`COVERAGE FAILED: ${new Set(result.issues.map(i => i.row)).size} unmapped / ${result.rows} rows`);
      process.exitCode = 1;
    } else console.log(`COVERAGE OK: ${result.rows} rows`);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`COVERAGE FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}

// Pure QA policy. Adapters retain their raw results and supply explicit entries, not CLI exit codes.
// Identity belongs to the run: every result must carry the same source, input and artifact hashes.
import { isDeepStrictEqual } from 'node:util';

const text = value => typeof value === 'string' && value.trim().length > 0;
const IDENTITY = ['runHash', 'sourceRevision', 'inputHashes', 'rawHash', 'packedHash'];

export class QaReportError extends Error {
  constructor(id, field, reason) {
    super(`${id}: ${field}: ${reason}`);
    this.name = 'QaReportError';
    this.id = id;
    this.field = field;
  }
}

function requireField(condition, id, field, reason) {
  if (!condition) throw new QaReportError(id, field, reason);
}

const summary = checks => {
  const checked = checks.reduce((sum, c) => sum + c.checked, 0);
  const unknown = checks.reduce((sum, c) => sum + c.unknown, 0);
  const accepted = checks.every(c => c.accepted);
  const pass = checks.some(c => c.pass === false) ? false : unknown ? null : true;
  const status = checks.some(c => c.status === 'error') ? 'error'
    : checks.some(c => c.status === 'fail') ? 'fail'
    : checks.every(c => c.status === 'notRun') ? 'notRun'
    : unknown ? 'unverified'
    : checks.some(c => c.status === 'warning') ? 'warning' : 'pass';
  return { status, pass, accepted, checked, unknown };
};

function reduceCheck(result) {
  const { id, kind, status, entries, approvedOverages = [] } = result;
  requireField(text(id), 'check', 'id', 'Required');
  requireField(['map', 'vr', 'overhead', 'invariants', 'pack'].includes(kind), id, 'kind', 'Unsupported QA kind');
  requireField(Array.isArray(entries), id, 'entries', 'Required array');
  switch (status) {
    case 'notRun':
      requireField(text(result.reason), id, 'reason', 'notRun requires a reason');
      requireField(entries.length === 0, id, 'entries', 'notRun cannot contain measured entries');
      return { id, kind, status, reason: result.reason, pass: null, accepted: false, checked: 0, unknown: 1, findings: [] };
    case 'complete': break;
    default: throw new QaReportError(id, 'status', 'Expected complete or notRun');
  }
  requireField(entries.length > 0, id, 'entries', 'Empty checks must be notRun with a reason');
  const used = new Set();
  const keys = new Set();
  const findings = entries.map(entry => {
    const { metric, threshold, value, operator, evidenceTier } = entry;
    requireField(text(entry.id) && text(metric), id, 'entry', 'ID and metric required');
    const key = `${entry.id}/${metric}`;
    requireField(!keys.has(key), id, 'entry', `Duplicate ${key}`);
    keys.add(key);
    requireField(text(entry.evidence), entry.id, 'evidence', 'Evidence pointer required');
    requireField(Object.hasOwn(entry, 'threshold'), entry.id, 'threshold', 'Threshold required, null if not measurable');
    const base = { ...entry, reason: entry.reason ?? null, checkId: id };
    switch (entry.status) {
      case 'error':
        requireField(text(entry.reason), entry.id, 'reason', 'Execution/contract error requires a reason');
        return { ...base, status: 'error', pass: false, accepted: false, checked: 0, unknown: 1 };
      case 'unknown':
        requireField(text(entry.reason), entry.id, 'reason', 'Unknown requires a reason');
        requireField(value === null, entry.id, 'value', 'Unknown cannot claim a measurement');
        return { ...base, status: 'unverified', pass: null, accepted: false, checked: 0, unknown: 1 };
      case 'measured': break;
      default: throw new QaReportError(entry.id, 'status', 'Expected measured, unknown or error');
    }
    requireField(evidenceTier !== 'T4', entry.id, 'evidenceTier', 'T4 must remain unknown');
    requireField(Number.isFinite(value) && Number.isFinite(threshold), entry.id, 'value', 'Finite value and threshold required');
    let pass;
    switch (operator) {
      case 'lte': pass = value <= threshold; break;
      case 'gte': pass = value >= threshold; break;
      case 'eq': pass = value === threshold; break;
      default: throw new QaReportError(entry.id, 'operator', 'Expected lte, gte or eq');
    }
    if (pass) return { ...base, status: 'pass', pass: true, accepted: true, checked: 1, unknown: 0 };
    const approved = approvedOverages.find(a => a.id === entry.id && a.metric === metric &&
      a.value === value && a.threshold === threshold && a.operator === operator && text(a.reason) && text(a.evidence));
    if (approved) used.add(key);
    const reason = approved?.reason ?? entry.reason ?? null;
    // Map overages are warnings when reasoned. VR/overhead need a separately supplied, exact approval.
    // Hard invariant and pack errors can never be waived by an approval or a reason.
    const accepted = kind === 'map' ? text(reason) : ['vr', 'overhead'].includes(kind) && Boolean(approved);
    return {
      ...base, reason, status: accepted ? 'warning' : 'fail', pass: false, accepted, checked: 1, unknown: 0,
      ...(approved ? { approvalEvidence: approved.evidence } : {}),
    };
  });
  const reduced = summary(findings);
  const acceptance = result.acceptance;
  if (acceptance !== undefined) {
    requireField(typeof acceptance.accepted === 'boolean', id, 'acceptance', 'Explicit acceptance boolean required');
    if (!acceptance.accepted) {
      const knownGap = text(acceptance.knownGap) && text(acceptance.reason);
      reduced.pass = false;
      if (!knownGap) reduced.accepted = false;
      if (reduced.status !== 'error') reduced.status = knownGap && reduced.accepted ? 'warning' : 'fail';
    }
  }
  return {
    id, kind, ...reduced, findings,
    unusedApprovals: approvedOverages.filter(a => !used.has(`${a.id}/${a.metric}`)).map(a => `${a.id}/${a.metric}`),
    ...(acceptance === undefined ? {} : { acceptance: structuredClone(acceptance) }),
  };
}

/**
 * run: {runHash, sourceRevision, inputHashes:{name:hash}, rawHash, packedHash}.
 * Artifact hashes may be null before generation; complete checks require both hashes.
 * results: [{...run,id,kind,status:'complete'|'notRun',reason?,entries,approvedOverages?,acceptance?}].
 * Entry: {id,metric,value,threshold,operator:'lte'|'gte'|'eq',status:'measured'|'unknown'|'error',
 *         evidence,reason,evidenceTier?,tier?}. `tier` stays the scorer's tolerance class.
 * Approved overages: exact {id,metric,value,threshold,operator,reason,evidence} from an approved ledger.
 * Raw pass:false survives every accepted warning. Unknown/notRun never count as a measured pass.
 */
export function reduceQaReport(run, results) {
  requireField(text(run.runHash) && text(run.sourceRevision), 'run', 'identity', 'Run hash and source revision required');
  requireField(run.inputHashes && typeof run.inputHashes === 'object' && !Array.isArray(run.inputHashes) &&
    Object.keys(run.inputHashes).length > 0 && Object.values(run.inputHashes).every(text),
  'run', 'inputHashes', 'Non-empty named source hashes required');
  for (const key of ['rawHash', 'packedHash']) {
    requireField(run[key] === null || text(run[key]), 'run', key, 'Hash or explicit null required');
  }
  requireField(Array.isArray(results) && results.length > 0, 'run', 'checks', 'At least one explicit check required');
  const ids = new Set();
  const checks = results.map(result => {
    for (const field of IDENTITY) {
      requireField(isDeepStrictEqual(result[field], run[field]), result.id, field, 'Result belongs to different run inputs or artifacts');
    }
    requireField(!ids.has(result.id), result.id, 'id', 'Duplicate check');
    ids.add(result.id);
    if (result.status === 'complete') {
      requireField(text(run.rawHash) && text(run.packedHash), result.id, 'artifacts', 'Complete QA requires raw and packed hashes');
    }
    return reduceCheck(result);
  });
  return {
    schemaVersion: 1, ...structuredClone(run), ...summary(checks),
    checks, findings: checks.flatMap(c => c.findings),
  };
}

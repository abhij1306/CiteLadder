import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const FRONTEND = path.resolve(import.meta.dirname, '..');
const ROOT = path.resolve(FRONTEND, '..');
const CONFIG_PATH = path.join(ROOT, 'jscpd.json');
const GIT_EXECUTABLE = '/usr/bin/git';
const BIN = process.execPath;
const JSCPD_ENTRYPOINT = path.join(FRONTEND, 'node_modules', 'jscpd', 'run-jscpd.js');
const REVISION = /^(?:HEAD|[0-9a-fA-F]{40})$/;
export const TOOL_VERSION = '5.2.1';
export const SCOPES = {
  frontend: {
    baseline: 'scripts/jscpd-baseline.json',
    scope: ['frontend/apps/app/src', 'frontend/components', 'frontend/lib'],
  },
  api: {
    baseline: 'services/api/jscpd-baseline.json',
    scope: ['frontend/services/api/src', 'frontend/services/api/scripts'],
  },
};
const scanPaths = (scope) => scope.map((directory) => `./${directory.slice('frontend/'.length)}`);
const FINGERPRINT_PATTERN = /^[^|]+\|[^|]+\|[^|]+\|[0-9a-f]{16}\|\d+\|\d+$/;

function normalizeName(value) {
  return path.relative(ROOT, path.resolve(String(value)));
}

function endOfLine(source, index) {
  const newline = source.indexOf('\n', index);
  return newline < 0 ? source.length : newline;
}

function endOfBlockComment(source, index) {
  const end = source.indexOf('*/', index + 2);
  return end < 0 ? source.length : end + 2;
}

function quoteDelimiter(source, index) {
  const quote = source[index];
  return quote === "'" || quote === '"' || quote === '`' ? quote : null;
}

function quotedSegment(source, index, delimiter) {
  let cursor = index + delimiter.length;
  while (cursor < source.length) {
    if (source[cursor] === '\\') cursor += 2;
    else if (source.startsWith(delimiter, cursor)) {
      cursor += delimiter.length;
      break;
    } else cursor += 1;
  }
  return { value: source.slice(index, cursor), next: cursor };
}

function ignoredCommentEnd(source, index) {
  if (source[index] !== '/') return null;
  if (source[index + 1] === '/') return endOfLine(source, index + 2);
  if (source[index + 1] === '*') return endOfBlockComment(source, index);
  return null;
}

function normalizedCloneContent(source) {
  let result = '';
  let index = 0;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    const commentEnd = ignoredCommentEnd(source, index);
    if (commentEnd !== null) {
      index = commentEnd;
      continue;
    }
    const delimiter = quoteDelimiter(source, index);
    if (delimiter) {
      const segment = quotedSegment(source, index, delimiter);
      result += segment.value;
      index = segment.next;
      continue;
    }
    result += source[index];
    index += 1;
  }
  return result;
}

function cloneBody(file) {
  const source = fs
    .readFileSync(path.resolve(String(file.name)), 'utf8')
    .split('\n')
    .slice(file.start - 1, file.end)
    .join('\n');
  return normalizedCloneContent(source);
}

export function cloneFingerprint(clone) {
  const occurrences = [clone.firstFile, clone.secondFile]
    .map((file) => normalizeName(file.name))
    .sort((left, right) => left.localeCompare(right));
  const bodies = [cloneBody(clone.firstFile), cloneBody(clone.secondFile)].sort((left, right) =>
    left.localeCompare(right),
  );
  const contentHash = createHash('sha256').update(bodies.join('\0')).digest('hex').slice(0, 16);
  return `${clone.format}|${occurrences[0]}|${occurrences[1]}|${contentHash}|${clone.lines}|${clone.tokens}`;
}

function frequencies(values) {
  const result = new Map();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function cloneContentSignature(fingerprint) {
  const [format, , , contentHash, lines, tokens] = fingerprint.split('|');
  return `${format}|${contentHash}|${lines}|${tokens}`;
}

export function validateHistoricalBaseline(raw) {
  if (
    raw?.format_version !== 1 ||
    typeof raw.production_percentage !== 'number' ||
    raw.production_percentage < 0 ||
    !Array.isArray(raw.clone_fingerprints) ||
    raw.clone_fingerprints.some(
      (entry) => typeof entry !== 'string' || !FINGERPRINT_PATTERN.test(entry),
    )
  ) {
    throw new Error('invalid jscpd baseline');
  }
  return raw;
}

export function validateBaseline(raw, expectedScope) {
  const baseline = validateHistoricalBaseline(raw);
  if (
    baseline.tool_version !== TOOL_VERSION ||
    JSON.stringify(baseline.scope) !== JSON.stringify(expectedScope)
  ) {
    throw new Error('invalid jscpd baseline');
  }
  return baseline;
}

export function readReport(reportPath) {
  if (!fs.existsSync(reportPath)) {
    return { duplicates: [], statistics: { total: { percentage: 0 } } };
  }
  return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}

function runJscpd(paths, extraArgs = []) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'citeladder-jscpd-'));
  const args = [
    JSCPD_ENTRYPOINT,
    ...paths,
    '--config',
    CONFIG_PATH,
    '--reporters',
    'json',
    '--output',
    output,
    '--exit-code',
    '0',
    '--silent',
    '--no-colors',
    '--no-gitignore',
    '--absolute',
    ...extraArgs,
  ];
  try {
    const result = spawnSync(BIN, args, {
      cwd: FRONTEND,
      encoding: 'utf8',
      shell: false,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`jscpd failed (${result.status}): ${result.stderr || result.stdout}`);
    }
    return readReport(path.join(output, 'jscpd-report.json'));
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
}

function baselineAtRevision(revision, baselineFile) {
  if (!REVISION.test(revision)) throw new Error(`invalid base revision: ${revision}`);
  try {
    return validateHistoricalBaseline(
      JSON.parse(
        execFileSync(GIT_EXECUTABLE, ['show', `${revision}:frontend/${baselineFile}`], {
          cwd: ROOT,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      ),
    );
  } catch (error) {
    const detail = `${error?.stderr ?? ''}${error?.message ?? ''}`;
    if (/does not exist in|exists on disk, but not in|path does not exist/i.test(detail))
      return null;
    throw error;
  }
}

const REPORTED_PRECISION = 4;

function reported(percentage) {
  return Number(Number(percentage).toFixed(REPORTED_PRECISION));
}

export function productionFailures(report, baseline, baseBaseline = null) {
  const failures = [];
  const percentage = Number(report.statistics?.total?.percentage ?? 0);
  const actual = frequencies((report.duplicates ?? []).map(cloneFingerprint));
  const accepted = frequencies(baseline.clone_fingerprints);
  if (reported(percentage) > reported(baseline.production_percentage)) {
    failures.push(
      `production duplication increased ${baseline.production_percentage}% -> ${percentage}%`,
    );
  }
  appendFrequencyFailures(failures, actual, accepted, 'new production clone');
  appendFrequencyFailures(failures, accepted, actual, 'stale accepted clone fingerprint');
  if (baseBaseline) appendBaselineDiffFailures(failures, baseline, baseBaseline);
  return failures;
}

function appendFrequencyFailures(failures, observed, allowed, label) {
  for (const [fingerprint, count] of observed)
    if (count > (allowed.get(fingerprint) ?? 0)) failures.push(`${label}: ${fingerprint}`);
}

function appendBaselineDiffFailures(failures, baseline, baseBaseline) {
  const comparable =
    baseline.tool_version === baseBaseline.tool_version &&
    JSON.stringify(baseline.scope) === JSON.stringify(baseBaseline.scope);
  if (reported(baseline.production_percentage) > reported(baseBaseline.production_percentage))
    failures.push('jscpd percentage threshold was relaxed');
  if (!comparable) return;
  appendFrequencyFailures(
    failures,
    frequencies(baseline.clone_fingerprints.map(cloneContentSignature)),
    frequencies(baseBaseline.clone_fingerprints.map(cloneContentSignature)),
    'new accepted clone content is forbidden',
  );
}

function advisoryTestScan() {
  const frontend = runJscpd(scanPaths(SCOPES.frontend.scope), [
    '--format',
    'typescript,tsx,javascript,jsx',
    '--pattern',
    '**/*.{test,spec}.{ts,tsx,js,jsx}',
  ]);
  const frontendPercentage = Number(frontend.statistics?.total?.percentage ?? 0);
  console.log(`jscpd test scan advisory: ${frontendPercentage.toFixed(4)}% duplicated lines`);
}

function main() {
  if (process.argv.includes('--tests')) {
    advisoryTestScan();
    return;
  }
  const scopeIndex = process.argv.indexOf('--scope');
  const name = process.argv[scopeIndex + 1];
  if (scopeIndex < 0 || !Object.hasOwn(SCOPES, name))
    throw new Error(`--scope must be one of ${Object.keys(SCOPES).join(', ')}`);
  const { baseline: baselineFile, scope } = SCOPES[name];
  const baseline = validateBaseline(
    JSON.parse(fs.readFileSync(path.join(FRONTEND, baselineFile), 'utf8')),
    scope,
  );
  const diffIndex = process.argv.indexOf('--check-policy-diff');
  const revision = diffIndex >= 0 ? process.argv[diffIndex + 1] : undefined;
  if (diffIndex >= 0 && !revision) throw new Error('--check-policy-diff requires a revision');
  const report = runJscpd(scanPaths(scope), ['--format', 'typescript,tsx,javascript,jsx']);
  const failures = productionFailures(
    report,
    baseline,
    revision ? baselineAtRevision(revision, baselineFile) : null,
  );
  if (failures.length) {
    console.error(`jscpd ${name} production gate failed:\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }
  const percentage = Number(report.statistics?.total?.percentage ?? 0);
  console.log(`jscpd ${name} production gate passed: ${percentage.toFixed(4)}%`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main();

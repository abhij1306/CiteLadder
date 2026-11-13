/**
 * Limit authored source files to the token budget in token-size-policy.json
 * (tokens = bytes / 4). `--staged` judges the index (pre-commit); `--base <rev>`
 * judges HEAD's files changed since <rev> (CI), or every file without a base.
 * Tests, generated code, migrations and config data are exempt (the policy's
 * ignore list); an oversized file is split along its seams, never exempted.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const POLICY_PATH = 'frontend/scripts/token-size-policy.json';
const GIT_EXECUTABLE =
  process.platform === 'win32' ? String.raw`C:\Program Files\Git\cmd\git.exe` : '/usr/bin/git';
const REVISION = /^[0-9a-fA-F]{7,40}$|^HEAD$/u;

export const SPLIT_INSTRUCTIONS = [
  'Find the seams: functions and types that change together, a class and its collaborators, a route group, a React component and its subcomponents and hooks.',
  'Move each group into a sibling module in the same owner folder, named for what it holds.',
  'Update every importer to the new path. No barrel files, re-export shims or aliases.',
  'Move code unchanged: no renames of exported symbols and no behaviour change.',
  'Do not shrink the file by deleting comments or compressing code, and do not add it to the ignore list or the baseline.',
  'Keep the split in its own commit when possible.',
];

function globRegex(glob) {
  const source = glob
    .split(/(\*\*\/|\*\*|\*)/u)
    .map((part) => {
      if (part === '**/') return '(?:.*/)?';
      if (part === '**') return '.*';
      if (part === '*') return '[^/]*';
      return part.replaceAll(/[.+?^${}()|[\]\\]/gu, String.raw`\$&`);
    })
    .join('');
  return new RegExp(`^${source}$`, 'u');
}

export function isChecked(policy, file) {
  if (!policy.extensions.includes(path.posix.extname(file))) return false;
  return !policy.ignore.some(({ glob }) => globRegex(glob).test(file));
}

export const tokensOf = (policy, bytes) => Math.ceil(bytes / policy.bytes_per_token);

/**
 * `sizes` maps each changed path and each baseline path to its byte size in the
 * judged tree, or null when it is absent there. `basePolicy` is null when the
 * base has no policy yet.
 */
export function tokenSizeFailures({ policy, basePolicy, changed, sizes }) {
  const limit = policy.limit_tokens;
  const oversized = changed
    .filter((file) => isChecked(policy, file) && !Object.hasOwn(policy.baseline, file))
    .map((file) => ({ file, tokens: tokensOf(policy, sizes.get(file) ?? 0) }))
    .filter(({ tokens }) => tokens > limit);
  const baseline = [];
  if (basePolicy && limit > basePolicy.limit_tokens)
    baseline.push(`limit_tokens raised ${basePolicy.limit_tokens} -> ${limit}; it may not rise`);
  for (const file of Object.keys(policy.baseline)) {
    const bytes = sizes.get(file);
    if (basePolicy && !Object.hasOwn(basePolicy.baseline, file))
      baseline.push(`${file}: new baseline entry; the baseline may only shrink, so split the file`);
    if (bytes == null) baseline.push(`${file}: no longer exists; delete its baseline entry`);
    else if (tokensOf(policy, bytes) <= limit)
      baseline.push(
        `${file}: now ${tokensOf(policy, bytes)} tokens, within the ${limit} limit; delete its baseline entry`,
      );
  }
  return { oversized, baseline };
}

export function failureReport(policy, { oversized, baseline }) {
  const lines = [];
  if (oversized.length) {
    lines.push(
      `Source files over the ${policy.limit_tokens}-token limit (tokens = bytes / ${policy.bytes_per_token}):`,
      ...oversized.map(
        ({ file, tokens }) => `  ${file}: ${tokens} tokens (limit ${policy.limit_tokens})`,
      ),
      '',
      'Split each file before committing:',
      ...SPLIT_INSTRUCTIONS.map((step, index) => `  ${index + 1}. ${step}`),
    );
  }
  if (baseline.length) {
    if (lines.length) lines.push('');
    lines.push(`Token-size baseline (${POLICY_PATH}):`, ...baseline.map((line) => `  ${line}`));
  }
  return lines.join('\n');
}

function git(cwd, args, input) {
  return execFileSync(GIT_EXECUTABLE, args, {
    cwd,
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

const splitZ = (output) => output.split('\0').filter(Boolean);

/** Byte sizes of `paths` in the tree `prefix` names (`:` for the index, `<rev>:` for a commit). */
function blobSizes(cwd, prefix, paths) {
  if (!paths.length) return new Map();
  const output = git(
    cwd,
    ['cat-file', '--batch-check=%(objecttype) %(objectsize)'],
    paths.map((file) => `${prefix}${file}\n`).join(''),
  );
  const lines = output.trimEnd().split('\n');
  return new Map(
    paths.map((file, index) => {
      const [type, size] = lines[index].split(' ');
      return [file, type === 'blob' ? Number(size) : null];
    }),
  );
}

function policyAt(cwd, prefix) {
  try {
    return JSON.parse(git(cwd, ['show', `${prefix}${POLICY_PATH}`]));
  } catch (error) {
    // A policy absent from the base (its first PR) or a repository without commits.
    if (
      /does not exist|exists on disk, but not in|invalid object name/u.test(`${error.stderr ?? ''}`)
    )
      return null;
    throw error;
  }
}

function judgedTree(cwd, args) {
  if (args.includes('--staged')) {
    return {
      prefix: ':',
      basePrefix: 'HEAD:',
      changed: splitZ(git(cwd, ['diff', '--cached', '--name-only', '--diff-filter=d', '-z'])),
    };
  }
  const baseIndex = args.indexOf('--base');
  if (baseIndex < 0) throw new Error('pass --staged or --base <revision>');
  const base = args[baseIndex + 1] ?? '';
  if (!base || /^0+$/u.test(base)) {
    return {
      prefix: 'HEAD:',
      basePrefix: null,
      changed: splitZ(git(cwd, ['ls-tree', '-r', '--name-only', '-z', 'HEAD'])),
    };
  }
  if (!REVISION.test(base)) throw new Error(`invalid base revision: ${base}`);
  return {
    prefix: 'HEAD:',
    basePrefix: `${base}:`,
    changed: splitZ(git(cwd, ['diff', '--name-only', '--diff-filter=d', '-z', `${base}...HEAD`])),
  };
}

export function main(args = process.argv.slice(2), cwd = process.cwd()) {
  const root = git(cwd, ['rev-parse', '--show-toplevel']).trim();
  const { prefix, basePrefix, changed } = judgedTree(root, args);
  const policy = policyAt(root, prefix);
  if (!policy) throw new Error(`${POLICY_PATH} is missing`);
  const basePolicy = basePrefix ? policyAt(root, basePrefix) : null;
  const paths = [...new Set([...changed, ...Object.keys(policy.baseline)])];
  const result = tokenSizeFailures({
    policy,
    basePolicy,
    changed,
    sizes: blobSizes(root, prefix, paths),
  });
  if (!result.oversized.length && !result.baseline.length) return 0;
  process.stderr.write(`${failureReport(policy, result)}\n`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename))
  process.exitCode = main();

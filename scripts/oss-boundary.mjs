#!/usr/bin/env node
/**
 * The open-source boundary: what a port from the private upstream must never
 * bring into this repository. Ports apply upstream diffs wholesale, so this
 * check is what stops a hosted-only file, dependency or reference riding along.
 *
 *   node scripts/oss-boundary.mjs        # scans every tracked file, exit 1 on a finding
 *
 * Out of scope here: secret values (gitleaks scans for those in CI) and
 * product features that merely talk to a cloud, such as the Google Cloud
 * crawler-log source, which self-hosters may use.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Built from parts so this file does not match its own rule.
const PRIVATE_UPSTREAM = new RegExp(['cube', String.raw`[-_ ]?`, '27'].join(''), 'i');

/** Paths that belong to the hosted product, its website or its infrastructure. */
const PATH_RULES = [
  {
    rule: 'marketing-or-docs-site',
    pattern: /(^|\/)(apps\/(marketing|docs|site|www)|components\/(marketing|docs)|docs-site)(\/|$)/,
    why: 'the marketing website and docs site stay in the private repository',
  },
  {
    rule: 'billing',
    pattern: /(^|\/)(billing|payments?|checkout|stripe|razorpay|paddle)([-_.][^/]*)?(\/|$)/i,
    why: 'billing, payments and plans do not exist in the self-hosted build',
  },
  {
    rule: 'login',
    pattern: /(^|\/)(components\/auth|routes\/(login|signup|sign-up|register|invitations?))(\/|$)/,
    why: 'the self-hosted build is a single local workspace with no login',
  },
  {
    rule: 'hosting-infra',
    pattern:
      /(^|\/)(wrangler\.(toml|jsonc?)|cloudbuild\.ya?ml|app\.ya?ml|terraform\/.*|infra\/.*|[^/]+\.tf)$|^\.github\/workflows\/[^/]*(deploy|release-cloud|gcp|workers)[^/]*$/i,
    why: 'deployment of the hosted service stays in the private repository',
  },
  {
    rule: 'secret-file',
    pattern:
      /(^|\/)(\.env(\.(?!example$)[^/]+)?|[^/]+\.(pem|p12|pfx|key)|id_(rsa|ed25519)|service-account[^/]*\.json|credentials\.json)$/i,
    why: 'environment files and keys are never committed; .env.example documents settings',
  },
];

/** Dependencies only the hosted product uses: payments, deploy tooling, analytics. */
const FORBIDDEN_DEPENDENCY =
  /^(stripe|@stripe\/.+|razorpay|@paddle\/.+|wrangler|@cloudflare\/workers-types|firebase(-admin)?|react-ga4|@vercel\/analytics|posthog-(js|node))$/;

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

/** Files this check reads the text of; binaries and the lockfile are path-checked only. */
const TEXT_FILE = /\.(m?[jt]sx?|json|md|ya?ml|toml|sql|css|html|txt|sh|example)$|(^|\/)(Dockerfile|\.[a-z]+ignore)$/i;

/**
 * Every boundary finding for a set of tracked files.
 *
 * @param {ReadonlyArray<{ path: string; text?: string }>} files
 * @returns {{ rule: string; path: string; line?: number; detail: string }[]}
 */
export function boundaryFindings(files) {
  const findings = [];
  for (const { path, text } of files) {
    for (const { rule, pattern, why } of PATH_RULES)
      if (pattern.test(path)) findings.push({ rule, path, detail: why });
    if (PRIVATE_UPSTREAM.test(path))
      findings.push({ rule: 'private-upstream', path, detail: 'names the private repository' });
    if (text === undefined) continue;
    text.split('\n').forEach((content, index) => {
      if (PRIVATE_UPSTREAM.test(content))
        findings.push({
          rule: 'private-upstream',
          path,
          line: index + 1,
          detail: 'names the private repository or its organisation',
        });
    });
    if (/(^|\/)package\.json$/.test(path)) {
      const manifest = JSON.parse(text);
      for (const field of DEPENDENCY_FIELDS)
        for (const name of Object.keys(manifest[field] ?? {}))
          if (FORBIDDEN_DEPENDENCY.test(name))
            findings.push({
              rule: 'hosted-dependency',
              path,
              detail: `${field} has ${name}, which only the hosted product uses`,
            });
    }
  }
  return findings;
}

/** The tracked files of the repository at `root`, with text for the ones worth reading. */
export function trackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .map((path) => ({
      path,
      text: TEXT_FILE.test(path) ? readFileSync(new URL(path, root), 'utf8') : undefined,
    }));
}

export const REPO_ROOT = new URL('../', import.meta.url);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = boundaryFindings(trackedFiles(REPO_ROOT));
  for (const { rule, path, line, detail } of findings)
    console.error(`${path}${line ? `:${line}` : ''}  [${rule}] ${detail}`);
  if (findings.length > 0) {
    console.error(
      `\n${findings.length} open-source boundary finding(s). Remove the hosted-only code from the port; see scripts/oss-boundary.mjs.`,
    );
    process.exit(1);
  }
  console.log('Open-source boundary: no hosted-only files, dependencies or references.');
}

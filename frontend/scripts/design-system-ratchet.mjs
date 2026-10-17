import { readFileSync, writeFileSync } from 'node:fs';

/**
 * The design-system debt ratchet.
 *
 * Findings are counted per file and rule. A count may fall but never rise
 * above its checked-in baseline, and a file or rule missing from the baseline
 * has a baseline of zero, so new drift fails immediately while recorded debt
 * burns down. Counts, not fingerprints: a line move must not fail the gate.
 */

const FORMAT_VERSION = 1;

/** Code-unit order, as a bare sort() gives, so existing baselines keep their key order. */
const byCodeUnit = (left, right) => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

/** `{ file: { rule: count } }` with sorted keys, so the JSON diffs cleanly. */
function countFindings(findings) {
  const counts = {};
  for (const { file, rule } of findings) {
    counts[file] ??= {};
    counts[file][rule] = (counts[file][rule] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.keys(counts)
      .sort(byCodeUnit)
      .map((file) => [
        file,
        Object.fromEntries(
          Object.keys(counts[file])
            .sort(byCodeUnit)
            .map((rule) => [rule, counts[file][rule]]),
        ),
      ]),
  );
}

/** A grown file/rule's headline followed by every finding it now holds. */
function growthViolations(findings, counts, accepted) {
  const violations = [];
  for (const [file, rules] of Object.entries(counts)) {
    for (const [rule, count] of Object.entries(rules)) {
      const allowed = accepted[file]?.[rule] ?? 0;
      if (count <= allowed) continue;
      violations.push(`${file}: ${rule} rose from ${allowed} to ${count}`);
      for (const finding of findings) {
        if (finding.file === file && finding.rule === rule) {
          violations.push(`  ${finding.file}:${finding.line}: ${finding.message} [${rule}]`);
        }
      }
    }
  }
  return violations;
}

function loweredCounts(counts, accepted) {
  const lowered = [];
  for (const [file, rules] of Object.entries(accepted)) {
    for (const [rule, allowed] of Object.entries(rules)) {
      const count = counts[file]?.[rule] ?? 0;
      if (count < allowed) lowered.push(`${file}: ${rule} fell from ${allowed} to ${count}`);
    }
  }
  return lowered;
}

/**
 * Compare findings with a baseline. `violations` lists every finding of a
 * file/rule that grew (any of them may be the new one); `lowered` names the
 * counts that fell and should be written back.
 */
export function ratchetVerdict(findings, baseline) {
  const counts = countFindings(findings);
  const accepted = baseline?.files ?? {};
  return {
    violations: growthViolations(findings, counts, accepted),
    lowered: loweredCounts(counts, accepted),
  };
}

export function readBaseline(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (raw.format_version !== FORMAT_VERSION || typeof raw.files !== 'object') {
    throw new Error(`${path}: invalid design-system baseline`);
  }
  return raw;
}

export function writeBaseline(path, findings) {
  const baseline = { format_version: FORMAT_VERSION, files: countFindings(findings) };
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
  return baseline;
}

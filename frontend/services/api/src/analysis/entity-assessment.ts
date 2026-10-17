import {
  countsAnywhere,
  DENSE_SCRIPT,
  normalizeAlias,
  occurrenceCounts,
  tokensOf,
  type EntityPolicy,
} from './aliases.ts';
import type { ScoringConfig } from './scoring.ts';
import { policy } from '../config.ts';
const word = String.raw`[\p{L}\p{N}_]`;
const escapeRegex = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
const limitation =
  "Explicit-language detection over English phrasing in a 45-character window around the entity's FIRST mention. Not sentiment, not a calibrated judgement, and not a reading of the whole answer.";

/** Every raw-text match of `alias`; a space-free script matches inside words. */
function aliasMatches(alias: string, answer: string): RegExpExecArray[] {
  const normalized = normalizeAlias(alias);
  if (!normalized) return [];
  const words = normalized.split(' ');
  const tokens = words.map((token) => (token === 'and' ? '(?:and|&)' : escapeRegex(token)));
  // The separator is disjoint from the token alphabet (letters, marks, digits,
  // '_', and '&' when an "and" token can match it), so a near-miss cannot
  // backtrack polynomially over a long answer.
  const separator = words.includes('and')
    ? String.raw`[^\p{L}\p{M}\p{N}_&]*`
    : String.raw`[^\p{L}\p{M}\p{N}_]*`;
  const body = tokens.join(separator);
  const pattern = DENSE_SCRIPT.test(normalized) ? body : `(?<!${word})${body}(?!${word})`;
  return [...answer.matchAll(new RegExp(pattern, 'giu'))];
}

/** Raw alias matches in answer order, and whether one counts under the matching policy. */
function matchesOf(aliases: readonly string[], answer: string, matching?: EntityPolicy) {
  const matches = aliases
    .flatMap((alias) => aliasMatches(alias, answer))
    .sort((a, b) => a.index - b.index);
  const counts = (match: RegExpExecArray) => {
    // Only a policy that reads the surroundings needs the answer tokenized.
    if (countsAnywhere(matching)) return true;
    const before = tokensOf(answer.slice(0, match.index));
    const own = tokensOf(match[0]);
    const after = tokensOf(answer.slice(match.index + match[0].length));
    return occurrenceCounts(
      [...before, ...own, ...after],
      { start: before.length, end: before.length + own.length },
      matching,
    );
  };
  return { matches, counts };
}

/** Every raw match that counts under the entity's matching policy, in answer order. */
export function countedMatches(
  aliases: readonly string[],
  answer: string,
  matching?: EntityPolicy,
): RegExpExecArray[] {
  const { matches, counts } = matchesOf(aliases, answer, matching);
  return matches.filter(counts);
}

/** The first counted match; stops at it, since the assessment reads only the first mention. */
function firstMatch(aliases: readonly string[], answer: string, matching?: EntityPolicy) {
  const { matches, counts } = matchesOf(aliases, answer, matching);
  return matches.find(counts);
}
function assessment(
  name: string,
  aliases: readonly string[],
  answer: string,
  kind: string,
  matching?: EntityPolicy,
) {
  const row = (
    state: string,
    spans: { start: number; end: number; text: string }[],
    detail = limitation,
  ) => ({
    entity_id: `${kind}:${normalizeAlias(name)}`,
    entity_name: name,
    entity_kind: kind,
    state,
    evidence_spans: spans,
    method: 'deterministic_explicit_language',
    analyzer_version: policy.audits.analysis.entity_assessment_version,
    model: null,
    template_version: null,
    limitation: detail,
  });
  if (!answer.trim()) return row('unavailable', [], 'Answer text is unavailable.');
  const match = firstMatch(aliases, answer, matching);
  if (!match) return row('absent', []);
  const points = Array.from(answer),
    offset = Array.from(answer.slice(0, match.index)).length;
  const endOffset = offset + Array.from(match[0]).length;
  const before = points
    .slice(Math.max(0, offset - 45), offset)
    .join('')
    .toLowerCase();
  const after = points
    .slice(endOffset, endOffset + 45)
    .join('')
    .toLowerCase();
  const afterPredicate = after.replace(/^\W+/u, '').replace(/^(?:is|are|was|were)\s*/u, '');
  let state = 'mentioned';
  if (
    /(?:avoid|do not recommend|not recommended|recommend against)(?:\s+(?:the|a|an|this|that))*\s*$/u.test(
      before,
    ) ||
    /^(?:not recommended|best avoided|not a good (?:choice|pick|fit))\b/u.test(afterPredicate)
  )
    state = 'recommended_against';
  else if (
    /(?:recommend|recommended|top pick|best choice|choose)(?:\s+(?:the|a|an|this|that))*\s*$/u.test(
      before,
    ) ||
    /^(?:recommended|the top pick|the best choice)\b/u.test(afterPredicate)
  )
    state = 'recommended';
  else if (
    /(?:consider|may prefer|could choose|option)(?:\s+(?:the|a|an|this|that))*\s*$/u.test(before)
  )
    state = 'hedged';
  const start = Math.max(0, offset - 60),
    end = Math.min(points.length, endOffset + 60);
  return row(state, [{ start, end, text: points.slice(start, end).join('') }]);
}
/** The frozen brand and competitors an answer is assessed for, brand first. */
export function trackedEntities(config: ScoringConfig) {
  return [
    {
      id: `brand:${normalizeAlias(config.brandName)}`,
      name: config.brandName,
      aliases: config.brandAliases,
      kind: 'brand',
      matching: config.brandMatching,
    },
    ...config.competitors.map((c) => ({
      ...c,
      id: `competitor:${normalizeAlias(c.name)}`,
      kind: 'competitor',
    })),
  ].filter((entity) => entity.name);
}
export function assessEntities(answer: string, config: ScoringConfig) {
  return trackedEntities(config).map((entity) =>
    assessment(entity.name, entity.aliases, answer, entity.kind, entity.matching),
  );
}

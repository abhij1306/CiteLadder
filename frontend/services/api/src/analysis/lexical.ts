import { policy } from '../config.ts';

const stopWords = new Set(policy.content_differentiation.stop_words);
/** Distinct lexical terms shared by persisted content comparisons and grounding. */
export function lexicalTokens(value: string, minLength = 2) {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((token) => token.length >= minLength && !stopWords.has(token)),
  );
}

/** The share of `terms` that `tokens` contains: an owned page's normalized coverage of a query. */
export function termCoverage(terms: ReadonlySet<string>, tokens: ReadonlySet<string>): number {
  if (!terms.size) return 0;
  let covered = 0;
  for (const term of terms) if (tokens.has(term)) covered += 1;
  return covered / terms.size;
}

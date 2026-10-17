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

/**
 * Brand and competitor name matching: `&` reads as "and", punctuation other
 * than underscores separates words, and a name matches on word boundaries,
 * including its separator-free spelling ("Ace Hardware" names "acehardware").
 * Words join only through a configured alias (AR-6): separate words in the
 * text never join to spell a name, so "your sales force" does not name
 * Salesforce unless "Sales Force" is one of its aliases. Text in scripts written without spaces (Chinese, Japanese, Thai) is
 * word-segmented first, so a name inside a sentence is still a whole-token run.
 *
 * An entity's matching policy can require context: under `context_required`
 * an occurrence counts only with a context term within the configured token
 * window, and an occurrence inside an exclusion phrase never counts.
 */
import { policy } from '../config.ts';
import { casefold } from '../casefold.ts';
import type { EntityPolicy } from './entity-matching.ts';

export type { EntityPolicy };

/** Scripts written without spaces between words. */
export const DENSE_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
const WORDS = new Intl.Segmenter(undefined, { granularity: 'word' });

export function normalizeAlias(value: string): string {
  return (
    casefold(value.normalize('NFKC'))
      .replaceAll('&', ' and ')
      // Combining marks are part of a word (Thai and Devanagari vowel signs).
      .replaceAll(/[^\p{L}\p{M}\p{N}_ ]/gu, ' ')
      .trim()
      .replaceAll(/\s+/gu, ' ')
  );
}

/** `normalizeAlias` with tokens of space-free scripts split into their words. */
export function normalizeText(value: string): string {
  const normalized = normalizeAlias(value);
  if (!DENSE_SCRIPT.test(normalized)) return normalized;
  return normalized
    .split(' ')
    .flatMap((token) =>
      DENSE_SCRIPT.test(token)
        ? [...WORDS.segment(token)]
            .filter((segment) => segment.isWordLike)
            .map((segment) => segment.segment)
        : [token],
    )
    .join(' ');
}

type Occurrence = { start: number; end: number; offset: number; codePoints: number };

/**
 * The end of the token run from `start` that spells the alias `words`, or
 * null. One token may spell several of the alias's words run together
 * ("acehardware" for "Ace Hardware"), but separate tokens never join to spell
 * one word ("sales force" is not "Salesforce"). The exception is a word in a
 * space-free script, which may span the tokens segmentation split it into.
 */
function runEnd(tokens: readonly string[], start: number, words: readonly string[]) {
  let index = start;
  let word = 0;
  while (word < words.length) {
    const step = DENSE_SCRIPT.test(words[word]!)
      ? segmentedWord(tokens, index, words[word]!)
      : joinedWords(tokens[index], words, word);
    if (!step) return null;
    index += step.tokens;
    word += step.words;
  }
  return index;
}

/** Tokens from `index` that segmentation split one space-free `word` into. */
function segmentedWord(tokens: readonly string[], index: number, word: string) {
  let candidate = '';
  let next = index;
  while (next < tokens.length && candidate.length < word.length) candidate += tokens[next++];
  return candidate === word ? { tokens: next - index, words: 1 } : null;
}

/** The alias words from `word` that `token` spells, run together or alone. */
function joinedWords(token: string | undefined, words: readonly string[], word: number) {
  if (token === undefined) return null;
  let candidate = '';
  let next = word;
  while (next < words.length && candidate.length < token.length) candidate += words[next++];
  return candidate === token ? { tokens: 1, words: next - word } : null;
}

/** Every whole-token run of `tokens` spelling the alias `words`, with its offsets. */
function* occurrences(tokens: readonly string[], words: readonly string[]): Generator<Occurrence> {
  let offset = 0,
    codePoints = 0;
  for (let start = 0; start < tokens.length; start++) {
    const end = runEnd(tokens, start, words);
    if (end !== null) yield { start, end, offset, codePoints };
    offset += tokens[start]!.length + 1;
    codePoints += Array.from(tokens[start]!).length + 1;
  }
}

/** `value` as normalized tokens, the unit every occurrence check compares. */
export const tokensOf = (value: string) => normalizeText(value).split(' ').filter(Boolean);

// A frozen policy's phrases never change, so each policy is tokenized once.
const policyTokens = new WeakMap<EntityPolicy, { exclusions: string[][]; context: string[][] }>();
function tokenized(entity: EntityPolicy) {
  let cached = policyTokens.get(entity);
  if (!cached) {
    const phrases = (values: readonly string[]) =>
      values.map(tokensOf).filter((words) => words.length);
    cached = {
      exclusions: phrases(entity.exclusion_phrases),
      context: phrases(entity.context_terms),
    };
    policyTokens.set(entity, cached);
  }
  return cached;
}

/** Whether every occurrence counts under `entity` without looking at its surroundings. */
export const countsAnywhere = (entity: EntityPolicy | undefined) =>
  !entity || (entity.mode === 'always' && !entity.exclusion_phrases.length);

const phraseAt = (tokens: readonly string[], words: readonly string[], index: number) =>
  index >= 0 && words.every((word, offset) => tokens[index + offset] === word);

/**
 * Whether the occurrence spanning `tokens[start, end)` counts under `entity`:
 * never inside an exclusion phrase, and with context required only when a
 * context term sits within the window on either side.
 */
export function occurrenceCounts(
  tokens: readonly string[],
  span: { start: number; end: number },
  entity: EntityPolicy | undefined,
): boolean {
  if (!entity) return true;
  const { exclusions, context } = tokenized(entity);
  for (const words of exclusions) {
    for (let index = span.end - words.length; index <= span.start; index++)
      if (phraseAt(tokens, words, index)) return false;
  }
  if (entity.mode === 'always') return true;
  const window = policy.audits.analysis.context_window_tokens;
  const low = Math.max(0, span.start - window),
    high = Math.min(tokens.length, span.end + window);
  return context.some((words) => {
    for (let index = low; index + words.length <= high; index++) {
      const outside = index + words.length <= span.start || index >= span.end;
      if (outside && phraseAt(tokens, words, index)) return true;
    }
    return false;
  });
}

/** The first counting occurrence of any alias in already-normalized text. */
function firstOccurrence(
  normalizedText: string,
  aliases: readonly string[],
  entity?: EntityPolicy,
): Occurrence | null {
  if (!normalizedText) return null;
  const tokens = normalizedText.split(' ');
  let first: Occurrence | null = null;
  for (const alias of aliases) {
    const words = normalizeAlias(alias).split(' ').filter(Boolean);
    if (!words.length) continue;
    for (const found of occurrences(tokens, words)) {
      if (first && found.offset >= first.offset) break;
      if (occurrenceCounts(tokens, found, entity)) {
        first = found;
        break;
      }
    }
  }
  return first;
}

/** Whether `text` names the entity through any alias, under its matching policy. */
export function namesEntity(
  text: string,
  aliases: readonly string[],
  entity?: EntityPolicy,
): boolean {
  return firstOccurrence(normalizeText(text), aliases, entity) !== null;
}

/** Whether `text` names `name`; a spaced name also matches its separator-free spelling. */
export function namesAlias(text: string, name: string): boolean {
  return namesEntity(text, [name]);
}

/**
 * Code-point offset of the entity's first counting occurrence in already
 * normalized text, or null when it is not named.
 */
export function entityOffset(
  normalizedText: string,
  aliases: readonly string[],
  entity?: EntityPolicy,
): number | null {
  return firstOccurrence(normalizedText, aliases, entity)?.codePoints ?? null;
}

/** Code-point offset in the normalized answer, as persisted ranks record it. */
export function firstAliasOffset(
  alias: string,
  normalized: string,
  entity?: EntityPolicy,
): number | null {
  return entityOffset(normalized, [alias], entity);
}

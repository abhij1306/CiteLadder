/**
 * Brand and competitor name matching: `&` reads as "and", punctuation other
 * than underscores separates words, and a name matches on word boundaries including its
 * separator-free spelling ("Ace Hardware" names "acehardware"). Text in scripts
 * written without spaces (Chinese, Japanese, Thai) is word-segmented first, so
 * a name inside a sentence is still a whole-token run.
 *
 * An entity's matching policy can require context: under `context_required`
 * an occurrence counts only with a context term within the configured token
 * window, and an occurrence inside an exclusion phrase never counts.
 */
import { policy } from '../config.ts';
import { searchPolicy } from '../search-surfaces/dataforseo.ts';
import type { EntityPolicy } from './entity-matching.ts';

export type { EntityPolicy };

/** Scripts written without spaces between words. */
export const DENSE_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
const WORDS = new Intl.Segmenter(undefined, { granularity: 'word' });

export function normalizeAlias(value: string): string {
  return (
    value
      .normalize('NFKC')
      .replaceAll(
        /./gsu,
        (character) =>
          searchPolicy.casefold_overrides[
            character as keyof typeof searchPolicy.casefold_overrides
          ] ?? character.toLowerCase(),
      )
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

/** Every whole-token run of `tokens` spelling `compact`, with its offsets. */
function* occurrences(tokens: readonly string[], compact: string): Generator<Occurrence> {
  let offset = 0,
    codePoints = 0;
  for (let start = 0; start < tokens.length; start++) {
    let candidate = '';
    for (let end = start; end < tokens.length; end++) {
      candidate += tokens[end];
      if (candidate === compact) {
        yield { start, end: end + 1, offset, codePoints };
        break;
      }
      if (candidate.length >= compact.length) break;
    }
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
    const compact = normalizeAlias(alias).replaceAll(' ', '');
    if (!compact) continue;
    for (const found of occurrences(tokens, compact)) {
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

/** Whether `text` names `name`; separator-free and spaced spellings are the same name. */
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

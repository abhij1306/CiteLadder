import { policy } from '../config.ts';
import { casefold } from '../casefold.ts';
import { siteDomain } from './domains.ts';
import type { EntityPolicy } from './entity-matching.ts';

export type { EntityPolicy };

export const DENSE_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
const WORDS = new Intl.Segmenter(undefined, { granularity: 'word' });

export function normalizeAlias(value: string): string {
  return casefold(value.normalize('NFKC'))
    .replaceAll('&', ' and ')
    .replaceAll(/[^\p{L}\p{M}\p{N}_ ]/gu, ' ')
    .trim()
    .replaceAll(/\s+/gu, ' ');
}

export function aliasSpellings(alias: string): string[][] {
  const words = normalizeAlias(alias).split(' ').filter(Boolean);
  if (!words.length) return [];
  const min = policy.audits.analysis.alias_connector_part_min_chars;
  const spellings = [words];
  words.forEach((word, index) => {
    for (let at = word.indexOf('and', min); at !== -1; at = word.indexOf('and', at + 1)) {
      const [head, tail] = [word.slice(0, at), word.slice(at + 3)];
      if (head.length < min || tail.length < min) continue;
      spellings.push([...words.slice(0, index), head, 'and', tail, ...words.slice(index + 1)]);
    }
  });
  return spellings;
}

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

function segmentedWord(tokens: readonly string[], index: number, word: string) {
  let candidate = '';
  let next = index;
  while (next < tokens.length && candidate.length < word.length) candidate += tokens[next++];
  return candidate === word ? { tokens: next - index, words: 1 } : null;
}

function joinedWords(token: string | undefined, words: readonly string[], word: number) {
  if (token === undefined) return null;
  let candidate = '';
  let next = word;
  while (next < words.length && candidate.length < token.length) candidate += words[next++];
  return candidate === token ? { tokens: 1, words: next - word } : null;
}

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

export const tokensOf = (value: string) => normalizeText(value).split(' ').filter(Boolean);

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

export const countsAnywhere = (entity: EntityPolicy | undefined) =>
  !entity || (entity.mode === 'always' && !entity.exclusion_phrases.length);

const phraseAt = (tokens: readonly string[], words: readonly string[], index: number) =>
  index >= 0 && words.every((word, offset) => tokens[index + offset] === word);

const namesSeveralWords = (words: readonly string[]) =>
  words.length > 1 && !words.some((word) => DENSE_SCRIPT.test(word));

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
  if (entity.mode === 'always' || namesSeveralWords(tokens.slice(span.start, span.end)))
    return true;
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

function firstOccurrence(
  normalizedText: string,
  aliases: readonly string[],
  entity?: EntityPolicy,
): Occurrence | null {
  if (!normalizedText) return null;
  const tokens = normalizedText.split(' ');
  let first: Occurrence | null = null;
  for (const words of aliases.flatMap(aliasSpellings)) {
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

export function namesEntity(
  text: string,
  aliases: readonly string[],
  entity?: EntityPolicy,
): boolean {
  return firstOccurrence(normalizeText(text), aliases, entity) !== null;
}

export function namesAlias(text: string, name: string): boolean {
  return namesEntity(text, [name]);
}

export function entityOffset(
  normalizedText: string,
  aliases: readonly string[],
  entity?: EntityPolicy,
): number | null {
  return firstOccurrence(normalizedText, aliases, entity)?.codePoints ?? null;
}

export function firstAliasOffset(
  alias: string,
  normalized: string,
  entity?: EntityPolicy,
): number | null {
  return entityOffset(normalized, [alias], entity);
}

export function aliasSuggestions(input: {
  brandName: string;
  aliases: readonly string[];
  domains: readonly string[];
}): string[] {
  const names = [input.brandName, ...input.aliases];
  const labels = input.domains.flatMap((domain) => siteDomain(domain)?.split('.')[0] ?? []);
  return [...new Set(labels)].filter((label) => !namesEntity(label, names));
}

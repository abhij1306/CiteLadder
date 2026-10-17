/**
 * Topical binding: a prompt is admitted only when it shares a non-stopword
 * token, or contains an exact multi-word phrase, with the project's identity
 * vocabulary (brand name and aliases, owned-domain host labels, topics and the
 * brand profile). Competitors never contribute, so naming one cannot admit an
 * off-domain prompt, and the vocabulary is never returned by any API.
 *
 * An empty vocabulary fails closed. A prompt filed under a topic also binds
 * against that topic's persisted name and description, never the request's
 * free-text theme.
 */
import { asApiErrorCode } from '@citeladder/contracts/error-codes';

import { DENSE_SCRIPT } from '../analysis/aliases.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record, strings } from '../db/json.ts';
import { ApiError } from '../errors.ts';

const {
  min_token_chars: MIN_TOKEN,
  min_dense_token_chars: MIN_DENSE_TOKEN,
  stopwords,
  business_context_fields: CONTEXT_FIELDS,
} = policy.prompts.binding;
const STOPWORDS = new Set(stopwords);
// ICU word boundaries also split scripts written without spaces (Chinese,
// Japanese, Thai); for spaced scripts they match the separator split below.
const WORDS = new Intl.Segmenter(undefined, { granularity: 'word' });

export type BindingFailure = 'off_topic' | 'vocabulary_empty';
export type Vocabulary = { tokens: ReadonlySet<string>; phrases: ReadonlySet<string> };

/** A failure's published error code and guidance. */
export const BINDING_FAILURES: Record<BindingFailure, { code: string; message: string }> = {
  off_topic: {
    code: policy.prompts.binding.off_topic,
    message:
      "Prompt text does not share any brand, owned-domain, or category term with this project's " +
      'identity (brand name/aliases, owned domains, topics, or brand profile).',
  },
  vocabulary_empty: {
    code: policy.prompts.binding.vocabulary_empty,
    message:
      'This project has no brand identity to bind prompts against yet. Complete the project ' +
      'identity (brand name/aliases, owned domains, topics, or brand profile) or use prompt ' +
      'generation first.',
  },
};

/**
 * Fold Latin diacritics ("café" → "cafe"), lower-case, and join the words of
 * any script with single spaces. Letters outside ASCII are kept, so a Hindi,
 * Arabic or Chinese identity binds its own-language prompts.
 */
function normalize(text: string): string {
  const folded = text
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/gu, '')
    .normalize('NFC')
    .toLowerCase();
  return [...WORDS.segment(folded)]
    .filter((segment) => segment.isWordLike)
    .flatMap((segment) => segment.segment.split(/[^\p{L}\p{N}\p{M}]+/u))
    .filter(Boolean)
    .join(' ');
}

const eligible = (token: string) =>
  token.length >= (DENSE_SCRIPT.test(token) ? MIN_DENSE_TOKEN : MIN_TOKEN) && !STOPWORDS.has(token);

/**
 * Fold a word so it matches its own plural. "-ies" folds to "y" first, so
 * "accessories" meets "accessory"; "-ie" keeps "movie"/"movies" together;
 * "-es" is stripped only after a sibilant ("dresses" → "dress", "shoes" →
 * "shoe"); a bare "s" is dropped unless doubled.
 */
function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('ie')) return `${token.slice(0, -2)}y`;
  if (
    token.length > 4 &&
    token.endsWith('es') &&
    ('sxz'.includes(token.slice(-3, -2)) || ['ch', 'sh'].includes(token.slice(-4, -2)))
  )
    return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/** Comparable topic tokens for `text`, plural-folded, for "is this about that" checks. */
export function bindingTokens(text: string): Set<string> {
  return new Set(tokensOf(text).map(stem));
}

/** How many of `a`'s comparable tokens `b` also has. */
export function sharedTokens(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let count = 0;
  for (const token of a) if (b.has(token)) count += 1;
  return count;
}

function tokensOf(text: string): string[] {
  const normalized = normalize(text);
  return normalized ? normalized.split(' ').filter(eligible) : [];
}

/** A multi-word identity string's exact phrase, or '' for a single word. */
function phraseOf(text: string): string {
  const normalized = normalize(text);
  return normalized.includes(' ') ? normalized : '';
}

function hostLabels(host: string): string[] {
  const bare = host.trim().toLowerCase().split('://').at(-1)!.split('/')[0]!.split(':')[0]!;
  return bare.split('.').filter(Boolean);
}

function buildVocabulary(input: {
  names?: readonly string[];
  hosts?: readonly string[];
  texts?: readonly string[];
}): Vocabulary {
  const tokens = new Set<string>();
  const phrases = new Set<string>();
  for (const value of [...(input.names ?? []), ...(input.texts ?? [])]) {
    tokensOf(value).forEach((token) => tokens.add(token));
    const phrase = phraseOf(value);
    if (phrase) phrases.add(phrase);
  }
  for (const host of input.hosts ?? []) {
    hostLabels(host).forEach((label) => tokensOf(label).forEach((token) => tokens.add(token)));
  }
  return { tokens, phrases };
}

/** Why `text` does not bind, or null when it does. */
export function bindingFailure(
  text: string,
  vocabulary: Vocabulary,
  topicText = '',
): BindingFailure | null {
  if (vocabulary.tokens.size === 0 && vocabulary.phrases.size === 0) return 'vocabulary_empty';
  const topic = topicText.trim() ? buildVocabulary({ texts: [topicText] }) : null;
  const normalized = normalize(text);
  const hasToken = (token: string) =>
    vocabulary.tokens.has(token) || (topic?.tokens.has(token) ?? false);
  if (normalized.split(' ').some((token) => eligible(token) && hasToken(token))) return null;
  const padded = ` ${normalized} `;
  const phrases = [...vocabulary.phrases, ...(topic?.phrases ?? [])];
  return phrases.some((phrase) => padded.includes(` ${phrase} `)) ? null : 'off_topic';
}

function businessContextValues(
  context: Record<string, unknown>,
  excluded: readonly string[],
): string[] {
  return CONTEXT_FIELDS.filter((field) => !excluded.includes(field)).flatMap((field) => {
    const raw = context[field];
    const candidates = Array.isArray(raw) ? raw : [raw];
    return candidates.flatMap((value) => {
      if (typeof value === 'string') return [value];
      return Array.isArray(value) ? strings(value) : [];
    });
  });
}

/**
 * The project's identity vocabulary; the caller authorized the project.
 * `excluded` business-context fields do not bind (generated text omits
 * service areas, so naming a place cannot stand in for an offering).
 */
export async function loadVocabulary(
  db: Database,
  projectId: string,
  excluded: readonly string[] = [],
): Promise<Vocabulary> {
  const [brand, domains, topics] = await Promise.all([
    db
      .selectFrom('brands')
      .leftJoin('brand_profiles', 'brand_profiles.brand_id', 'brands.id')
      .select([
        'brands.id',
        'brands.name',
        'brand_profiles.products_services',
        'brand_profiles.business_context',
        'brand_profiles.description',
        'brand_profiles.positioning',
        'brand_profiles.target_audience',
      ])
      .where('brands.project_id', '=', projectId)
      .executeTakeFirst(),
    db.selectFrom('owned_domains').select('domain').where('project_id', '=', projectId).execute(),
    db
      .selectFrom('topics')
      .select(['name', 'description'])
      .where('project_id', '=', projectId)
      .execute(),
  ]);
  const names: string[] = [];
  const texts: string[] = topics.flatMap((topic) => [topic.name, topic.description]);
  if (brand !== undefined) {
    const aliases = await db
      .selectFrom('brand_aliases')
      .select('alias')
      .where('brand_id', '=', brand.id)
      .execute();
    names.push(brand.name, ...aliases.map((row) => row.alias));
    texts.push(
      ...strings(brand.products_services),
      ...businessContextValues(record(brand.business_context), excluded),
      brand.description ?? '',
      brand.positioning ?? '',
      brand.target_audience ?? '',
    );
  }
  return buildVocabulary({ names, hosts: domains.map((row) => row.domain), texts });
}

/** A coded 422 for one rejected prompt, or for a batch with per-item details. */
export function bindingError(
  failure: BindingFailure,
  message: string = BINDING_FAILURES[failure].message,
  details?: Record<string, unknown>,
): ApiError {
  return new ApiError(422, message, {
    code: asApiErrorCode(BINDING_FAILURES[failure].code),
    details,
  });
}

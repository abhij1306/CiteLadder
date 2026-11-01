/**
 * Deterministic measures of a generated prompt set: what run provenance
 * records as `distribution` and what the evaluation thresholds read. No model
 * output and no embeddings; every value is recomputable from the texts.
 */
import { namesAlias } from '../analysis/aliases.ts';
import { policy } from '../config.ts';
import { bindingTokens, sharedTokens } from './binding.ts';
import type { Draft } from './generation-drafts.ts';
import { namesPlace } from './generation-plan.ts';
import { promptTextHash } from './normalization.ts';
import type { ObservedQuery } from './observed-queries.ts';

/** A set's opening is its first word: "Which" twenty times is one opening. */
const OPENING_WORDS = 1;

export const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
/** An unfilled template slot such as `[city]` or `{product}`. */
export const hasPlaceholder = (text: string) => /[[{<][^[\]{}<>]*[\]}>]/u.test(text);

type Counts = Record<string, number>;
const tally = (values: readonly string[]): Counts => {
  const counts: Counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
};
const share = (part: number, whole: number) => (whole ? part / whole : 0);

/** Counts by cohort, stage, intent, offering and persona, and located versus bare cells. */
export function distribution(drafts: readonly Draft[], geo: readonly string[]) {
  return {
    total: drafts.length,
    cohort: tally(drafts.map((draft) => draft.slot.cohort)),
    stage: tally(drafts.map((draft) => draft.buyer_stage)),
    intent: tally(drafts.map((draft) => draft.prompt_intent)),
    offering: tally(drafts.map((draft) => draft.slot.buyer_need.offering ?? '')),
    persona: tally(drafts.flatMap((draft) => draft.slot.buyer_need.audience ?? [])),
    // Measured on the text: a planned market and a place the model added alike.
    located: drafts.filter((draft) => namesPlace(draft.text, geo)).length,
    bare: drafts.filter((draft) =>
      Object.keys(draft.slot.buyer_need).every((key) => key === 'offering' || key === 'market'),
    ).length,
  };
}

const STOPWORDS = new Set(policy.prompts.binding.stopwords);
/**
 * A prompt's comparable tokens: binding tokens, plural-folded, without the
 * stopwords a fold can produce ("nets" folds to the stopword "net"), so a
 * singular and a plural phrasing compare equal.
 */
export const promptTokens = (text: string) =>
  new Set([...bindingTokens(text)].filter((token) => !STOPWORDS.has(token)));

/** Token overlap of two prompts: shared comparable tokens over all of them. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  const union = new Set([...a, ...b]).size;
  return union ? sharedTokens(a, b) / union : 0;
}

/**
 * Whether two prompts' tokens overlap at least `near_duplicate_jaccard`: one
 * answer would answer both. The one near-duplicate measure for admission and
 * the set metrics.
 */
export const nearDuplicate = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size > 0 && jaccard(a, b) >= policy.prompts.generation.near_duplicate_jaccard;

export type SetMetricsInput = {
  texts: readonly string[];
  stages: readonly string[];
  intents: readonly string[];
  offerings: readonly string[];
  /** The offering each text was planned for, by index. */
  offeringOf: readonly string[];
  category: readonly string[];
  geo: readonly string[];
  brands: readonly string[];
};

/** Set-level quality measures the evaluation thresholds are written against. */
export function setMetrics(input: SetMetricsInput) {
  const { texts } = input;
  const tokens = texts.map(promptTokens);
  const nearDuplicates = tokens.filter((own, index) =>
    tokens.some((other, peer) => peer !== index && nearDuplicate(own, other)),
  ).length;
  const openings = tally(texts.map((text) => words(text).slice(0, OPENING_WORDS).join(' ')));
  const restated = texts.filter((_, index) => {
    const allowed = new Set([
      ...bindingTokens(input.offeringOf[index] ?? ''),
      ...input.category.flatMap((term) => [...bindingTokens(term)]),
    ]);
    const own = tokens[index]!;
    return own.size > 0 && [...own].every((token) => allowed.has(token));
  }).length;
  const covered = new Set(input.offeringOf);
  return {
    count: texts.length,
    located_share: share(texts.filter((text) => namesPlace(text, input.geo)).length, texts.length),
    stages_covered: new Set(input.stages).size,
    intents_covered: new Set(input.intents).size,
    offerings_uncovered: input.offerings.filter((offering) => !covered.has(offering)).length,
    near_duplicate_rate: share(nearDuplicates, texts.length),
    opening_concentration: share(Math.max(0, ...Object.values(openings)), texts.length),
    category_restatement_rate: share(restated, texts.length),
    branded_leakage: texts.filter((text) => input.brands.some((name) => namesAlias(text, name)))
      .length,
    placeholder_leakage: texts.filter(hasPlaceholder).length,
    mean_words: share(
      texts.reduce((sum, text) => sum + words(text).length, 0),
      texts.length,
    ),
  };
}

/**
 * Share of prompts phrased like an observed search of their own topic: token
 * Jaccard at least `likeness_min_jaccard` with one, without being its exact
 * copy. Operator evaluation only; no threshold fails on it.
 */
export function observedLikeness(
  prompts: readonly { text: string; topic_id: string }[],
  observed: readonly Pick<ObservedQuery, 'text' | 'topic_id'>[],
): number {
  const min = policy.prompts.generation.observed.likeness_min_jaccard;
  const queries = observed.map((query) => ({
    topic_id: query.topic_id,
    tokens: bindingTokens(query.text),
    hash: promptTextHash(query.text),
  }));
  const alike = prompts.filter((prompt) => {
    const own = bindingTokens(prompt.text),
      hash = promptTextHash(prompt.text);
    const peers = queries.filter((query) => query.topic_id === prompt.topic_id);
    return (
      !peers.some((query) => query.hash === hash) &&
      peers.some((query) => jaccard(own, query.tokens) >= min)
    );
  });
  return share(alike.length, prompts.length);
}

/** Threshold names a generated set fails; empty when it is within all of them. */
export function thresholdFailures(
  metrics: ReturnType<typeof setMetrics>,
  context: { market_scope: string; requested: number },
): string[] {
  const T = policy.prompts.generation.eval_thresholds;
  const [low, high] = T.located_share[context.market_scope] ?? T.located_share.national!;
  const failures: Record<string, boolean> = {
    located_share: metrics.located_share < low || metrics.located_share > high,
    stage_coverage:
      context.requested >= T.all_stages_from_count &&
      metrics.stages_covered < policy.prompts.generation.planned_stages.length,
    offering_coverage: metrics.offerings_uncovered > 0,
    near_duplicate_rate: metrics.near_duplicate_rate > T.near_duplicate_rate_max,
    opening_concentration: metrics.opening_concentration > T.opening_concentration_max,
    branded_leakage: metrics.branded_leakage > 0,
    placeholder_leakage: metrics.placeholder_leakage > 0,
    mean_words: metrics.mean_words < T.mean_words[0] || metrics.mean_words > T.mean_words[1],
    shortfall: context.requested - metrics.count > T.shortfall_max * context.requested,
  };
  return Object.keys(failures).filter((name) => failures[name]);
}

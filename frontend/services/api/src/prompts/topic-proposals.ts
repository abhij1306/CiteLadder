/**
 * Topic proposals: the buyer-facing categories a business's saved
 * offerings fall into (owner decision B), never product-line names. One
 * bounded model call proposes them; deterministic code then keeps only
 * categories grounded in a saved offering, strips the brand, its aliases,
 * product-line names and specifications, merges near-duplicates and caps the
 * list, reporting everything it did not keep. Nothing here writes: generation
 * creates the topics, and a preview can show the same result.
 */
import { z } from 'zod';

import { namesAlias } from '../analysis/aliases.ts';
import { policy } from '../config.ts';
import { getLogger } from '../logging.ts';
import { ModelError } from '../models/http.ts';
import type { ModelGateway } from '../models/gateway.ts';
import { sharedTokens } from './binding.ts';
import { jaccard, promptTokens } from './generation-metrics.ts';

const G = policy.prompts.generation;

export type TopicProposalInput = {
  /** The saved offerings; proposals never reach beyond them. */
  offerings: readonly string[];
  /** Names of the project's existing topics: a proposal repeating one is dropped. */
  existing: readonly string[];
  /** The tracked brand and its aliases. */
  brandNames: readonly string[];
  /** Category vocabulary buyers use, which is never a product-line name. */
  categoryTerms: readonly string[];
  /** How many proposals may be kept; the rest are reported as overflow. */
  limit: number;
};
type TopicProposal = { name: string; offerings: string[] };
type TopicDropReason = 'unsupported' | 'empty' | 'branded' | 'existing' | 'merged';
export type TopicProposals = {
  /** `model` when the model's proposal was used, `offerings` for the deterministic fallback. */
  source: 'model' | 'offerings';
  topics: TopicProposal[];
  /** Admissible proposals beyond `limit`, in order: reported, never silently dropped. */
  overflow: TopicProposal[];
  dropped: { name: string; reason: TopicDropReason }[];
  /** The model call's identity when one answered. */
  model: Record<string, unknown> | null;
};

const proposalSchema = z.object({
  topics: z.array(z.object({ name: z.string(), offerings: z.array(z.string()) })),
});
const logger = getLogger('app.domain.prompts.topic_proposals');

const wordsOf = (text: string) => text.trim().split(/\s+/u).filter(Boolean);
const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
/** What may separate a phrase's words in text: whitespace or punctuation. */
const WORD_GAP = String.raw`[\s\p{P}]+`;
/** `text` without whole-word occurrences of `phrase`, case-insensitively. */
function removePhrase(text: string, phrase: string): string {
  const parts = wordsOf(phrase).map(escape);
  if (!parts.length) return text;
  const body = parts.join(WORD_GAP);
  const pattern = new RegExp(String.raw`(?<![\p{L}\p{N}])${body}(?![\p{L}\p{N}])`, 'giu');
  return text.replaceAll(pattern, ' ');
}

const EDGE = /[\s\p{P}]/u;
/** `text` without leading and trailing whitespace or punctuation. */
function trimEdges(text: string): string {
  let start = 0,
    end = text.length;
  while (start < end && EDGE.test(text.charAt(start))) start++;
  while (end > start && EDGE.test(text.charAt(end - 1))) end--;
  return text.slice(start, end);
}

/** Words that never make a product-line name on their own: category and common vocabulary. */
function commonVocabulary(categoryTerms: readonly string[]): Set<string> {
  return new Set([
    ...categoryTerms.flatMap((term) => [...promptTokens(term)]),
    ...G.brand_common_words.flatMap((term) => [...promptTokens(term)]),
    ...G.provider_phrases.flatMap((term) => [...promptTokens(term)]),
  ]);
}

/**
 * Product-line and model names inside the offerings: runs of capitalised
 * words, except a single sentence-initial word ("Junior golf net") and runs
 * made only of category or common words ("Home"). "Pro Series golf net" and
 * "Clear Air Zone side barriers" yield "Pro Series" and "Clear Air Zone".
 */
export function productLineTerms(
  offerings: readonly string[],
  categoryTerms: readonly string[],
): string[] {
  const common = commonVocabulary(categoryTerms);
  const generic = (run: readonly string[]) =>
    run.every((token) => [...promptTokens(token)].every((t) => common.has(t)));
  const terms = offerings
    .flatMap((offering) => offering.split(/[(),:;/|–—]+/u))
    .flatMap((segment) => capitalRuns(wordsOf(segment)))
    // A lone sentence-initial capital is ordinary sentence case.
    .filter(({ start, run }) => !(start === 0 && run.length === 1) && !generic(run))
    .map(({ run }) => run.join(' '));
  return [...new Set(terms)];
}

/** Each maximal run of capitalised tokens, with the index it starts at. */
function capitalRuns(tokens: readonly string[]): { start: number; run: string[] }[] {
  const runs: { start: number; run: string[] }[] = [];
  tokens.forEach((token, index) => {
    if (!/^\p{Lu}/u.test(token)) return;
    const last = runs.at(-1);
    if (last && last.start + last.run.length === index) last.run.push(token);
    else runs.push({ start: index, run: [token] });
  });
  return runs;
}

/**
 * A proposed name as a buyer-facing category: parenthetical qualifiers,
 * specifications (any word with a digit), the brand, its aliases and
 * product-line names removed. Null when too little is left to name a category.
 */
function categoryName(name: string, banned: readonly string[]): string | null {
  let text = name.replaceAll(/\([^)]*\)?/gu, ' ');
  for (const phrase of banned) text = removePhrase(text, phrase);
  // Words are joined by single spaces, so one space before punctuation is all there is.
  const kept = trimEdges(
    wordsOf(text)
      .filter((word) => !/\d/u.test(word))
      .join(' '),
  ).replaceAll(/ ([,.;:])/gu, '$1');
  const tokens = promptTokens(kept);
  if (!tokens.size) return null;
  // A stripped name left with one word ("net") no longer names a category.
  if (tokens.size < 2 && promptTokens(name).size > tokens.size) return null;
  const all = wordsOf(kept),
    capped = all.slice(0, G.topic_name_max_words);
  // A cut name does not end on a connective ("bays for").
  while (all.length > capped.length && capped.length > 1) {
    const last = capped.at(-1);
    if (last === undefined || promptTokens(last).size) break;
    capped.pop();
  }
  const category = trimEdges(capped.join(' ')).slice(0, policy.prompts.topic_name_max_chars).trim();
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** Raw proposals: the model's categories, or each offering as its own. */
async function rawProposals(
  input: TopicProposalInput,
  gateway: ModelGateway | null,
  deadline: AbortSignal,
): Promise<Pick<TopicProposals, 'source' | 'model'> & { raw: TopicProposal[] }> {
  const fallback = {
    source: 'offerings' as const,
    model: null,
    raw: input.offerings.map((offering) => ({ name: offering, offerings: [offering] })),
  };
  if (!gateway) return fallback;
  try {
    const response = await gateway.structured(
      G.topic_system,
      JSON.stringify({ offerings: input.offerings, category_terms: input.categoryTerms }),
      proposalSchema,
      deadline,
    );
    const { content: _content, ...identity } = response.result;
    return { source: 'model', model: identity, raw: response.value.topics };
  } catch (error) {
    if (!(error instanceof ModelError) && !deadline.aborted) throw error;
    logger.info('topic proposal fell back to offerings', {
      error_type: error instanceof ModelError ? error.code : 'deadline',
    });
    return fallback;
  }
}

/**
 * Buyer-facing topics for the saved offerings. Every kept proposal names at
 * least one saved offering and shares a word with its offerings or the
 * category vocabulary, so nothing is invented; an offering no kept proposal
 * covers is proposed from its own cleaned name. Model failure falls back to
 * the offerings themselves, cleaned the same way.
 */
export async function proposeTopics(
  input: TopicProposalInput,
  gateway: ModelGateway | null,
  deadline: AbortSignal,
): Promise<TopicProposals> {
  const { source, model, raw } = await rawProposals(input, gateway, deadline);
  const confirmed = new Map(
    input.offerings.map((offering) => [offering.trim().toLowerCase(), offering]),
  );
  const banned = [
    ...input.brandNames,
    ...productLineTerms(input.offerings, input.categoryTerms),
  ].filter((term) => term.trim());
  const category = input.categoryTerms.flatMap((term) => [...promptTokens(term)]);
  const dropped: TopicProposals['dropped'] = [];
  const kept: (TopicProposal & { tokens: Set<string> })[] = [];
  const existing = input.existing.map((name) => promptTokens(name));
  const sameCategory = (a: Set<string>, b: Set<string>) => jaccard(a, b) >= G.topic_merge_jaccard;
  /** Why a cleaned proposal cannot be kept as a new category, or null when it can. */
  const rejection = (offerings: string[], name: string | null): TopicDropReason | null => {
    if (!offerings.length) return 'unsupported';
    if (!name) return 'empty';
    if (input.brandNames.some((brand) => namesAlias(name, brand))) return 'branded';
    const grounding = new Set([
      ...offerings.flatMap((item) => [...promptTokens(item)]),
      ...category,
    ]);
    if (!sharedTokens(promptTokens(name), grounding)) return 'unsupported';
    return existing.some((other) => sameCategory(promptTokens(name), other)) ? 'existing' : null;
  };
  const admit = (proposal: TopicProposal) => {
    const offerings = [
      ...new Set(
        proposal.offerings.flatMap((item) => confirmed.get(item.trim().toLowerCase()) ?? []),
      ),
    ];
    const name = categoryName(proposal.name, banned);
    const reason = rejection(offerings, name);
    if (reason || !name) {
      dropped.push({ name: name ?? proposal.name, reason: reason ?? 'empty' });
      return;
    }
    const tokens = promptTokens(name);
    const twin = kept.find((other) => sameCategory(tokens, other.tokens));
    if (!twin) {
      kept.push({ name, offerings, tokens });
      return;
    }
    twin.offerings = [...new Set([...twin.offerings, ...offerings])];
    dropped.push({ name, reason: 'merged' });
  };
  for (const proposal of raw) admit(proposal);
  const covered = new Set(kept.flatMap((proposal) => proposal.offerings));
  for (const offering of input.offerings)
    if (!covered.has(offering)) admit({ name: offering, offerings: [offering] });
  const topics = kept.map(({ name, offerings }) => ({ name, offerings }));
  const limit = Math.max(0, input.limit);
  return {
    source,
    model,
    topics: topics.slice(0, limit),
    overflow: topics.slice(limit),
    dropped,
  };
}

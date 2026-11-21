import { z } from 'zod';

import { namesAlias } from '../analysis/aliases.ts';
import { policy } from '../config.ts';
import { jaccard } from '../lists.ts';
import { getLogger } from '../logging.ts';
import { ModelError } from '../models/http.ts';
import type { ModelGateway } from '../models/gateway.ts';
import { sharedTokens } from './binding.ts';
import { promptTokens } from './generation-metrics.ts';

const G = policy.prompts.generation;

export type TopicProposalInput = {
  offerings: readonly string[];
  existing: readonly string[];
  brandNames: readonly string[];
  categoryTerms: readonly string[];
  limit: number;
};
type TopicProposal = { name: string; offerings: string[] };
type TopicDropReason = 'unsupported' | 'empty' | 'branded' | 'existing' | 'merged';
export type TopicProposals = {
  source: 'model' | 'offerings';
  topics: TopicProposal[];
  overflow: TopicProposal[];
  dropped: { name: string; reason: TopicDropReason }[];
  model: Record<string, unknown> | null;
};

const proposalSchema = z.object({
  topics: z.array(z.object({ name: z.string(), offerings: z.array(z.string()) })),
});
const logger = getLogger('app.domain.prompts.topic_proposals');

const wordsOf = (text: string) => text.trim().split(/\s+/u).filter(Boolean);
const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
const WORD_GAP = String.raw`[\s\p{P}]+`;
function removePhrase(text: string, phrase: string): string {
  const parts = wordsOf(phrase).map(escape);
  if (!parts.length) return text;
  const body = parts.join(WORD_GAP);
  const pattern = new RegExp(String.raw`(?<![\p{L}\p{N}])${body}(?![\p{L}\p{N}])`, 'giu');
  return text.replaceAll(pattern, ' ');
}

const EDGE = /[\s\p{P}]/u;
function trimEdges(text: string): string {
  let start = 0,
    end = text.length;
  while (start < end && EDGE.test(text.charAt(start))) start++;
  while (end > start && EDGE.test(text.charAt(end - 1))) end--;
  return text.slice(start, end);
}

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
    .filter(({ start, run }) => !(start === 0 && run.length === 1) && !generic(run))
    .map(({ run }) => run.join(' '));
  return [...new Set(terms)];
}

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

function categoryName(name: string, banned: readonly string[]): string | null {
  let text = name.replaceAll(/\([^)]*\)?/gu, ' ');
  for (const phrase of banned) text = removePhrase(text, phrase);
  const kept = trimEdges(
    wordsOf(text)
      .filter((word) => !/\d/u.test(word))
      .join(' '),
  ).replaceAll(/ ([,.;:])/gu, '$1');
  const tokens = promptTokens(kept);
  if (!tokens.size) return null;
  if (tokens.size < 2 && promptTokens(name).size > tokens.size) return null;
  const all = wordsOf(kept),
    capped = all.slice(0, G.topic_name_max_words);
  while (all.length > capped.length && capped.length > 1) {
    const last = capped.at(-1);
    if (last === undefined || promptTokens(last).size) break;
    capped.pop();
  }
  const category = trimEdges(capped.join(' ')).slice(0, policy.prompts.topic_name_max_chars).trim();
  return category.charAt(0).toUpperCase() + category.slice(1);
}

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

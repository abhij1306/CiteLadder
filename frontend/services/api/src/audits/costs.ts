import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Database } from '../db/database.ts';
import { policy } from '../config.ts';
import { usageCount } from '../answer-engines/parse.ts';

export const costPolicy = policy.costs;
export type RouteIdentity = {
  logical_engine: string;
  transport_provider: string;
  transport_model: string;
};
export type RateCard = {
  uncached_input_microusd_per_million: number | null;
  cached_input_microusd_per_million: number | null;
  output_microusd_per_million: number | null;
  reasoning_microusd_per_million: number | null;
  search_fee_microusd: number | null;
  currency: string;
  effective_date: string;
  pricing_version: string;
};
const sameRoute = (a: RouteIdentity, b: RouteIdentity) =>
  a.logical_engine === b.logical_engine &&
  a.transport_provider === b.transport_provider &&
  a.transport_model === b.transport_model;
export function rateCard(
  route: RouteIdentity,
  version = costPolicy.pricing_version,
): RateCard | null {
  const catalog = costPolicy.catalogs[version as keyof typeof costPolicy.catalogs];
  if (!catalog) return null;
  return (
    catalog.find((item) => sameRoute(item.identity, route))?.pricing ?? {
      ...costPolicy.unverified_pricing,
      pricing_version: version,
    }
  );
}
type CostStatus = 'complete' | 'partial' | 'unknown';
export function costStatus(values: readonly (number | null)[]): CostStatus {
  const known = values.filter((value) => value !== null).length;
  if (known === 0) return 'unknown';
  return known === values.length ? 'complete' : 'partial';
}
export function knownTotal(values: readonly (number | null)[]) {
  return values.some((value) => value !== null)
    ? values.reduce<number>((total, value) => total + (value ?? 0), 0)
    : null;
}
export function estimateTokens(text: string) {
  return Math.max(
    1,
    Math.ceil(Array.from(text).length / costPolicy.estimate_input_chars_per_token),
  );
}
export function previewCost(
  route: RouteIdentity,
  input: { inputTokens: number; outputTokens: number; executions: number; retrieval: boolean },
) {
  const pricing = rateCard(route);
  const line = (tokens: number, rate: number | null | undefined) =>
    rate == null ? null : Math.ceil((tokens * rate) / costPolicy.tokens_per_million);
  const tokenLines = [
    line(input.inputTokens, pricing?.uncached_input_microusd_per_million),
    line(input.outputTokens, pricing?.output_microusd_per_million),
  ];
  const tokenCost = tokenLines.every((value) => value !== null) ? knownTotal(tokenLines) : null;
  const calls: Record<string, number> = costPolicy.estimate_search_calls;
  const searches =
    input.retrieval && calls[route.logical_engine] !== undefined
      ? input.executions * calls[route.logical_engine]!
      : null;
  const searchCost =
    searches !== null && pricing?.search_fee_microusd != null
      ? searches * pricing.search_fee_microusd
      : null;
  const required = [tokenCost, ...(input.retrieval ? [searchCost] : [])];
  return {
    estimated_token_cost_microusd: tokenCost,
    estimated_search_cost_microusd: searchCost,
    estimated_total_cost_microusd: knownTotal(required),
    estimated_search_calls: searches,
    cost_status: costStatus(required),
  };
}

/** Applicable usage without a verified rate makes a total partial, even when other lines are known. */
export function projectCost(usage: unknown, pricing: RateCard) {
  const source = z.record(z.string(), z.unknown()).safeParse(usage).data ?? {};
  const count = (key: string) => usageCount(source[key]);
  const uncached = count('uncached_input_tokens');
  const cached = count('cached_input_tokens');
  const output = count('output_tokens');
  const reasoning = count('reasoning_tokens');
  const searches = count('search_requests');
  const reported = count('provider_cost_microusd');
  const token = (value: number | null, rate: number | null) => {
    if (value === null || rate === null) return null;
    const result = Number((BigInt(value) * BigInt(rate)) / BigInt(costPolicy.tokens_per_million));
    if (!Number.isSafeInteger(result)) throw new Error('execution_cost_overflow');
    return result;
  };
  const uncachedCost = token(uncached, pricing.uncached_input_microusd_per_million);
  const cachedCost = token(cached, pricing.cached_input_microusd_per_million);
  const outputCost = token(output, pricing.output_microusd_per_million);
  const reasoningCost = token(reasoning, pricing.reasoning_microusd_per_million);
  const searchCost =
    searches !== null && pricing.search_fee_microusd !== null
      ? searches * pricing.search_fee_microusd
      : null;
  const lineCosts = [uncachedCost, cachedCost, outputCost, reasoningCost, searchCost];
  const counts = [uncached, cached, output, reasoning, searches];
  const applicable = lineCosts.filter((_value, index) => counts[index] !== null);
  const projected =
    applicable.length && applicable.every((value) => value !== null)
      ? knownTotal(applicable)
      : null;
  const total = count('total_tokens') ?? knownTotal([uncached, cached, output, reasoning]);
  const anyKnown = [total, reported, ...counts, ...lineCosts].some((value) => value !== null);
  let status: CostStatus = 'unknown';
  if (projected !== null) status = 'complete';
  else if (anyKnown) status = 'partial';
  return {
    projection_status: status,
    uncached_input_tokens: uncached,
    cached_input_tokens: cached,
    output_tokens: output,
    reasoning_tokens: reasoning,
    total_tokens: total,
    search_requests: searches,
    uncached_input_cost_microusd: uncachedCost,
    cached_input_cost_microusd: cachedCost,
    output_cost_microusd: outputCost,
    reasoning_cost_microusd: reasoningCost,
    search_cost_microusd: searchCost,
    provider_reported_cost_microusd: reported,
    projected_total_cost_microusd: projected,
  };
}
/** Caller owns the transaction. Each immutable artifact/version pair is inserted once. */
export async function appendCostProjection(
  db: Database,
  workspaceId: string,
  artifactId: string,
  pricingVersion = costPolicy.pricing_version,
  formulaVersion = costPolicy.formula_version,
) {
  const artifact = await db
    .selectFrom('raw_response_artifacts as r')
    .innerJoin('audits as a', 'a.id', 'r.audit_id')
    .selectAll('r')
    .where('a.workspace_id', '=', workspaceId)
    .where('r.id', '=', artifactId)
    .forUpdate('r')
    .executeTakeFirst();
  if (!artifact) return null;
  const prior = await db
    .selectFrom('execution_cost_projections')
    .selectAll()
    .where('raw_response_artifact_id', '=', artifactId)
    .where('pricing_version', '=', pricingVersion)
    .where('formula_version', '=', formulaVersion)
    .executeTakeFirst();
  if (prior) return prior;
  const pricing = rateCard(artifact, pricingVersion);
  if (!pricing) return null;
  const count = await db
    .selectFrom('provider_attempts')
    .select(sql<string>`count(*)`.as('attempts'))
    .where('task_id', '=', artifact.task_id)
    .executeTakeFirstOrThrow();
  return db
    .insertInto('execution_cost_projections')
    .values({
      id: randomUUID(),
      raw_response_artifact_id: artifact.id,
      audit_id: artifact.audit_id,
      task_id: artifact.task_id,
      ...projectCost(artifact.usage, pricing),
      attempt_count: Number(count.attempts),
      pricing_version: pricingVersion,
      formula_version: formulaVersion,
      created_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

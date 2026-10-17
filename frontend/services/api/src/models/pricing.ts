/**
 * Model token pricing, used only to record what each provider call cost the
 * operator (`platform_calls.cost_microusd`). Nothing is charged or gated on it.
 */
import usage from '../config/ai-usage.json' with { type: 'json' };
import { gatewaySettings } from './gateway.ts';

export const PRICING_REVISION = usage.revision;
export type ModelPrice = (typeof usage.models)[keyof typeof usage.models];
export type MeteredFeature =
  | 'agent'
  | 'prompt_generation'
  | 'project_research'
  | 'commerce_buyer_prompts'
  | 'answer_perception'
  | 'fact_verification'
  | 'commerce_shelf'
  | 'prompt_quality_judge'
  | 'internal_link_judge'
  | 'commerce_competitor_discovery'
  | 'research_evidence'
  | 'search_intelligence';

/**
 * The model's configured price. The configured gateway's model is priced at the
 * default price until it has its own; any other unpriced model has none.
 */
export function modelPrice(
  model: string,
  gatewayModel = gatewaySettings().model,
): ModelPrice | null {
  const models: Record<string, ModelPrice> = usage.models;
  if (Object.hasOwn(models, model)) return models[model]!;
  return model && model === gatewayModel ? models[usage.gateway_default_price]! : null;
}

/**
 * Token counts as the gateway reports them. Input includes cached and
 * cache-written input; output includes thinking, which providers bill as
 * output. A report without a cache-write count wrote none.
 */
export type TokenUsage = {
  input_tokens?: number | null;
  cached_input_tokens?: number | null;
  cache_write_input_tokens?: number | null;
  output_tokens?: number | null;
};

/** A reported token count, or `null` unless it is a non-negative safe integer. */
export function tokenCount(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

type Tokens = { input: number; cached: number; written: number; output: number };

/** Exact token counts from reported usage; `null` when the usage cannot be read. */
function readUsage(usage: TokenUsage): Tokens | null {
  const input = tokenCount(usage.input_tokens),
    cached = tokenCount(usage.cached_input_tokens ?? 0),
    written = tokenCount(usage.cache_write_input_tokens ?? 0),
    output = tokenCount(usage.output_tokens);
  if (input === null || cached === null || written === null || output === null) return null;
  if (cached + written > input) return null;
  return { input, cached, written, output };
}

/**
 * The tokens' cost in micro-USD at the provider's published rates, multiplied
 * by a million to stay exact: cache reads at the cached rate, cache writes at
 * the write rate, the rest of the input at the base rate.
 */
function microusdTimesMillion(price: ModelPrice, { input, cached, written, output }: Tokens) {
  return (
    BigInt(input - cached - written) * BigInt(price.input_microusd_per_million) +
    BigInt(cached) * BigInt(price.cached_input_microusd_per_million) +
    BigInt(written) * BigInt(price.cache_write_input_microusd_per_million) +
    BigInt(output) * BigInt(price.output_microusd_per_million)
  );
}

/** The cost of a call in micro-USD, rounded up; `null` when the usage cannot be read. */
export function costMicrousd(price: ModelPrice, usage: TokenUsage): number | null {
  const tokens = readUsage(usage);
  return tokens && Number((microusdTimesMillion(price, tokens) + 999_999n) / 1_000_000n);
}

import { z } from 'zod';

/** An execution consumes frozen request policy; it never supplies a policy default. */
export const answerRequestSchema = z.object({
  logical_engine: z.enum(['chatgpt', 'gemini', 'claude']),
  transport_provider: z.enum(['openai', 'google', 'anthropic']),
  transport_model: z.string().min(1),
  prompt: z.string().min(1),
  system_instruction: z.string(),
  timeout_seconds: z.number().positive(),
  max_output_tokens: z.number().int().positive(),
  retrieval_enabled: z.boolean(),
  reasoning_effort: z.string(),
  country_code: z.string(),
  anthropic_max_uses: z.number().int().nonnegative(),
  openai_max_tool_calls: z.number().int().nonnegative(),
});
export type AnswerRequest = z.infer<typeof answerRequestSchema>;
export type FinishReason =
  | 'stop'
  | 'length'
  | 'tool_error'
  | 'content_filter'
  | 'cancelled'
  | 'error'
  | 'unknown';
export type Usage = {
  uncached_input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  web_search_requests: number | null;
  provider_cost_microusd: number | null;
};
/** Persist the established granular shape, including the aliases used by historical readers. */
export function normalizedUsage(usage: Usage) {
  const { web_search_requests: searches, ...counts } = usage;
  return {
    ...counts,
    search_requests: searches,
    total_input_tokens: usage.uncached_input_tokens,
    total_output_tokens: usage.output_tokens,
  };
}
export type SearchEvent = {
  sequence: number;
  query: string;
  call_id: string;
  call_sequence: number;
  query_sequence: number;
};
export type Citation = {
  ordinal: number;
  url: string;
  title: string;
  domain: string;
  start_index: number | null;
  end_index: number | null;
  cited_text: string;
};
/** A page the engine read while answering, whether or not the answer cites it. */
export type RetrievedSource = {
  ordinal: number;
  url: string;
  title: string;
  domain: string;
};
export type Answer = Pick<
  AnswerRequest,
  'logical_engine' | 'transport_provider' | 'transport_model'
> & {
  answer_text: string;
  search_used: boolean;
  search_events: SearchEvent[];
  citations: Citation[];
  /** `null` when the surface does not expose what it read; `[]` is an observed empty read. */
  retrieved_sources: RetrievedSource[] | null;
  finish_reason: FinishReason;
  raw_finish_reason: string;
  normalized_usage: Usage;
  provider_metadata: Record<string, unknown>;
  latency_ms: number;
};
export class ProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | undefined;
  constructor(code: string, retryable = false, retryAfterSeconds?: number) {
    super(`Provider execution failed: ${code}`);
    this.code = code;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

import { z } from 'zod';
import type {
  Answer,
  AnswerRequest,
  Citation,
  FinishReason,
  RetrievedSource,
  SearchEvent,
  Usage,
} from './contracts.ts';

type ObjectValue = Record<string, unknown>;
const objectSchema = z.record(z.string(), z.unknown());
const object = (value: unknown): ObjectValue => objectSchema.safeParse(value).data ?? {};
const objects = (value: unknown): ObjectValue[] =>
  Array.isArray(value)
    ? value.filter((item) => objectSchema.safeParse(item).success).map(object)
    : [];
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
/** Missing, malformed and negative counters remain unknown; reported zero remains zero. */
export function usageCount(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\+?\d+$/u.test(value.trim())) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}
function counter(source: ObjectValue, ...keys: string[]) {
  for (const key of keys) {
    if (key in source) return usageCount(source[key]);
  }
  return null;
}
const sum = (...values: (number | null)[]) =>
  values.some((value) => value !== null)
    ? values.reduce<number>((total, value) => total + (value ?? 0), 0)
    : null;
const subtract = (total: number | null, part: number | null) =>
  total !== null && part !== null ? Math.max(0, total - part) : total;
function domain(value: string) {
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname
      .toLowerCase()
      .replace(/^www\./u, '')
      .replace(/\.$/u, '');
  } catch {
    return '';
  }
}
function citation(
  block: ObjectValue,
  annotation: ObjectValue,
  ordinal: number,
  transport: string,
): Citation | undefined {
  const url = text(annotation.url);
  const title = text(annotation.title);
  if (!url && !(transport !== 'anthropic' && title)) return;
  const chars = Array.from(typeof block.text === 'string' ? block.text : '');
  let start = transport === 'anthropic' ? null : counter(annotation, 'start_index', 'startIndex');
  let end = transport === 'anthropic' ? null : counter(annotation, 'end_index', 'endIndex');
  let citedText =
    transport === 'anthropic' && typeof annotation.cited_text === 'string'
      ? annotation.cited_text
      : '';
  if (start !== null && end !== null && start < end && end <= chars.length) {
    citedText = chars.slice(start, end).join('');
  } else {
    start = null;
    end = null;
  }
  return {
    ordinal,
    url,
    title,
    domain: domain(transport === 'google' ? title : url || title),
    start_index: start,
    end_index: end,
    cited_text: citedText,
  };
}
function callArguments(call: ObjectValue, transport: string) {
  if (transport === 'openai') return call.action;
  return transport === 'google' ? (call.arguments ?? call.args) : call.input;
}
function outputItems(source: ObjectValue, transport: string) {
  if (transport === 'openai') return source.output;
  return transport === 'google' ? source.steps : source.content;
}
function isSearchCall(item: ObjectValue, transport: string) {
  if (transport === 'openai') return item.type === 'web_search_call';
  if (transport === 'google') return (item.type ?? item.step_type) === 'google_search_call';
  return item.type === 'server_tool_use' && item.name === 'web_search';
}
function events(calls: ObjectValue[], transport: string): SearchEvent[] {
  return calls
    .flatMap((call, callIndex) => {
      const args = object(callArguments(call, transport));
      const query = transport === 'google' ? '' : text(args.query);
      const listed = Array.isArray(args.queries) ? args.queries.map(text).filter(Boolean) : [];
      // OpenAI repeats the first listed query as `query`; record each query once.
      const queries = [...(query && !listed.includes(query) ? [query] : []), ...listed];
      // OpenAI and Anthropic preserve a count-only search when query text is absent.
      const countOnly = transport === 'google' ? [] : [''];
      const values = queries.length ? queries : countOnly;
      return values.map((value, index) => ({
        sequence: 0,
        query: value,
        call_id: text(call.id ?? call.call_id),
        call_sequence: callIndex,
        query_sequence: index,
      }));
    })
    .map((event, sequence) => ({ ...event, sequence }));
}
/**
 * What the engine read: OpenAI's consulted sources on each search call and
 * Anthropic's search results. Google does not expose them, so it stays unknown.
 */
function retrievedSources(
  items: ObjectValue[],
  calls: ObjectValue[],
  transport: string,
): RetrievedSource[] | null {
  if (transport === 'google') return null;
  const results =
    transport === 'openai'
      ? calls.flatMap((call) => objects(object(call.action).sources))
      : items
          .filter((item) => item.type === 'web_search_tool_result')
          .flatMap((item) => objects(item.content))
          .filter((result) => result.type === 'web_search_result');
  const seen = new Set<string>();
  const sources: RetrievedSource[] = [];
  for (const result of results) {
    const url = text(result.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({ ordinal: sources.length, url, title: text(result.title), domain: domain(url) });
  }
  return sources;
}
const GOOGLE_FINISH: Record<string, FinishReason> = {
  STOP: 'stop',
  MAX_TOKENS: 'length',
  SAFETY: 'content_filter',
  RECITATION: 'content_filter',
  BLOCKLIST: 'content_filter',
  PROHIBITED_CONTENT: 'content_filter',
  SPII: 'content_filter',
  IMAGE_SAFETY: 'content_filter',
  OTHER: 'error',
  ERROR: 'error',
  FAILED: 'error',
  MALFORMED_FUNCTION_CALL: 'error',
  UNEXPECTED_TOOL_CALL: 'error',
  CANCELLED: 'cancelled',
};
const OPENAI_FINISH: Record<string, FinishReason> = {
  completed: 'stop',
  failed: 'error',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  max_output_tokens: 'length',
  max_tokens: 'length',
  content_filter: 'content_filter',
};
const ANTHROPIC_FINISH: Record<string, FinishReason> = {
  end_turn: 'stop',
  stop_sequence: 'stop',
  max_tokens: 'length',
  tool_use: 'unknown',
  pause_turn: 'unknown',
  refusal: 'content_filter',
};

/** Provider objects never pass through: only observable answer/search evidence is retained. */
export function parseAnswer(payload: unknown, request: AnswerRequest, latencyMs = 0): Answer {
  const source = objectSchema.parse(payload);
  const transport = request.transport_provider;
  const items = objects(outputItems(source, transport));
  const calls = items.filter((item) => isSearchCall(item, transport));
  const searchEvents = events(calls, transport);
  const blocks =
    transport === 'anthropic'
      ? items.filter((item) => item.type === 'text')
      : items
          .filter((item) =>
            transport === 'openai'
              ? item.type === 'message'
              : (item.type ?? item.step_type) === 'model_output',
          )
          .flatMap((item) => objects(item.content))
          .filter((block) =>
            transport === 'openai'
              ? block.type === 'output_text'
              : block.type === 'text' || block.type === undefined,
          );
  const citations = blocks
    .flatMap((block) =>
      objects(transport === 'anthropic' ? block.citations : block.annotations)
        .filter(
          (annotation) =>
            annotation.type ===
            (transport === 'anthropic' ? 'web_search_result_location' : 'url_citation'),
        )
        .map((annotation) => citation(block, annotation, 0, transport))
        .filter((item): item is Citation => item !== undefined),
    )
    .map((item, ordinal) => ({ ...item, ordinal }));
  const rawUsage = object(source.usage ?? source.usageMetadata);
  const usage: Usage = {
    uncached_input_tokens: null,
    cached_input_tokens: null,
    output_tokens: null,
    reasoning_tokens: null,
    total_tokens: null,
    web_search_requests: null,
    provider_cost_microusd: null,
  };
  let rawFinish: string;
  let finish: FinishReason;
  if (transport === 'openai') {
    const input = counter(rawUsage, 'input_tokens');
    const output = counter(rawUsage, 'output_tokens');
    usage.cached_input_tokens = counter(
      object(rawUsage.input_tokens_details),
      'cached_tokens',
      'cached_input_tokens',
    );
    usage.uncached_input_tokens = subtract(input, usage.cached_input_tokens);
    usage.reasoning_tokens = counter(object(rawUsage.output_tokens_details), 'reasoning_tokens');
    usage.output_tokens = subtract(output, usage.reasoning_tokens);
    usage.total_tokens = counter(rawUsage, 'total_tokens') ?? sum(input, output);
    usage.web_search_requests = calls.length;
    rawFinish = text(object(source.incomplete_details).reason) || text(source.status);
    // A refusal arrives as a message block on a `completed` response.
    const refused = items
      .filter((item) => item.type === 'message')
      .some((item) => objects(item.content).some((block) => block.type === 'refusal'));
    finish = refused ? 'content_filter' : (OPENAI_FINISH[rawFinish] ?? 'unknown');
  } else if (transport === 'google') {
    const input = counter(rawUsage, 'promptTokenCount', 'prompt_token_count');
    usage.cached_input_tokens = counter(
      rawUsage,
      'cachedContentTokenCount',
      'cached_content_token_count',
    );
    usage.uncached_input_tokens = subtract(input, usage.cached_input_tokens);
    usage.output_tokens = counter(rawUsage, 'candidatesTokenCount', 'candidates_token_count');
    usage.reasoning_tokens = counter(rawUsage, 'thoughtsTokenCount', 'thoughts_token_count');
    usage.total_tokens =
      counter(rawUsage, 'totalTokenCount', 'total_token_count', 'total_tokens') ??
      sum(input, usage.output_tokens, usage.reasoning_tokens);
    usage.web_search_requests = calls.length;
    const candidate = objects(source.candidates).find((item) =>
      text(item.finish_reason ?? item.finishReason),
    );
    rawFinish =
      text(source.finish_reason ?? source.finishReason) ||
      text(candidate?.finish_reason ?? candidate?.finishReason) ||
      text(source.status);
    finish = GOOGLE_FINISH[rawFinish.toUpperCase()] ?? 'unknown';
  } else {
    usage.uncached_input_tokens = sum(
      counter(rawUsage, 'input_tokens'),
      counter(rawUsage, 'cache_creation_input_tokens', 'cacheCreationInputTokens'),
    );
    usage.cached_input_tokens = counter(
      rawUsage,
      'cache_read_input_tokens',
      'cacheReadInputTokens',
    );
    usage.output_tokens = counter(rawUsage, 'output_tokens');
    usage.total_tokens =
      counter(rawUsage, 'total_tokens') ??
      sum(usage.uncached_input_tokens, usage.cached_input_tokens, usage.output_tokens);
    usage.web_search_requests =
      counter(object(rawUsage.server_tool_use), 'web_search_requests') ?? (calls.length || null);
    rawFinish = text(source.stop_reason);
    finish = ANTHROPIC_FINISH[rawFinish] ?? 'unknown';
  }
  const model = text(source.model) || request.transport_model;
  return {
    logical_engine: request.logical_engine,
    transport_provider: transport,
    transport_model: model,
    answer_text: blocks
      .map((block) => text(block.text))
      .filter(Boolean)
      .join('\n\n'),
    search_used:
      transport === 'openai'
        ? calls.length > 0 || citations.length > 0
        : (usage.web_search_requests ?? 0) > 0,
    search_events: searchEvents,
    citations,
    retrieved_sources: retrievedSources(items, calls, transport),
    finish_reason: finish,
    raw_finish_reason: rawFinish,
    normalized_usage: usage,
    latency_ms: latencyMs,
    provider_metadata: {
      id: text(source.id),
      model,
      status: text(source.status),
      raw_finish_reason: rawFinish,
      usage,
      search_events: searchEvents,
      query_text_available: transport !== 'google' && searchEvents.some((event) => event.query),
      citations,
    },
  };
}

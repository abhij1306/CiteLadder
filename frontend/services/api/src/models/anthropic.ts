import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  BetaMessageParam,
  BetaUsage,
  BetaWebSearchTool20250305,
} from '@anthropic-ai/sdk/resources/beta/messages';

import { getLogger } from '../logging.ts';
import {
  blockText,
  blockToolCalls,
  outputCap,
  parseBlocks,
  type CacheDiagnosis,
  type ConversationMessage,
  type ConversationStop,
  type Converse,
  type UsageIteration,
  WEB_SEARCH,
} from './conversation.ts';
import type { GatewaySettings } from './gateway.ts';
import {
  abortCode,
  callDeadline,
  ModelError,
  providerErrorCode,
  retryAfterHeader,
  type Complete,
  type Transport,
} from './http.ts';

const logger = getLogger('app.connectors.agent.client');

export function isAnthropicEndpoint(endpoint: URL) {
  return endpoint.hostname === 'api.anthropic.com';
}

type Settings = Pick<
  GatewaySettings,
  'apiKey' | 'model' | 'timeoutSeconds' | 'maxOutputTokens' | 'attempts'
>;

function modelError(error: unknown, signal: AbortSignal) {
  if (error instanceof ModelError) return error;
  if (error instanceof APIConnectionTimeoutError) return new ModelError('timeout');
  if (error instanceof APIUserAbortError) return new ModelError(abortCode(signal));
  if (error instanceof APIConnectionError) return new ModelError('connection');
  if (error instanceof APIError && error.status !== undefined) {
    logger.warning('default agent call failed', {
      status: error.status,
      error_code: providerErrorCode(error.status),
    });
    return new ModelError(
      'http',
      error.status,
      retryAfterHeader(error.headers?.get('retry-after')),
    );
  }
  return new ModelError(error instanceof APIError ? 'connection' : 'parse');
}

function anthropicClient(settings: Settings, transport: Transport, endpoint: URL) {
  return new Anthropic({
    apiKey: settings.apiKey,
    // The SDK adds /v1 itself; a configured /v1 suffix is accepted.
    baseURL: endpoint.origin,
    timeout: settings.timeoutSeconds * 1000,
    maxRetries: Math.max(0, settings.attempts - 1),
    fetch: transport.fetch,
  });
}

const deadline = (settings: Settings, signal?: AbortSignal) =>
  callDeadline(settings.timeoutSeconds, signal);

export function anthropicCompletion(
  settings: Settings,
  transport: Transport,
  endpoint: URL,
): Complete {
  const client = anthropicClient(settings, transport, endpoint);
  return async (system, user, signal, onText, schema) => {
    const started = performance.now();
    let text = '';
    let message;
    const callSignal = deadline(settings, signal);
    try {
      const stream = client.messages.stream(
        {
          model: settings.model,
          max_tokens: settings.maxOutputTokens,
          system,
          messages: [{ role: 'user', content: user }],
          ...(schema ? { output_config: { format: { type: 'json_schema', schema } } } : {}),
        },
        { signal: callSignal },
      );
      if (onText)
        stream.on('text', (delta) => {
          text += delta;
          onText(text);
        });
      message = await stream.finalMessage();
    } catch (error) {
      throw modelError(error, callSignal);
    }
    const content = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    if (!content.trim()) throw new ModelError('parse');
    const latency = Math.round(performance.now() - started);
    logger.info('default agent call ok', { latency_ms: latency, model: settings.model });
    const { usage } = message;
    const cached = usage.cache_read_input_tokens ?? null;
    const written = usage.cache_creation_input_tokens ?? null;
    return {
      content,
      provider_adapter: 'anthropic',
      endpoint_host: endpoint.hostname,
      requested_model: settings.model,
      returned_model: message.model || settings.model,
      finish_status: message.stop_reason ?? 'unknown',
      // Input counts every prompt token, cached or not, as OpenAI-compatible usage does.
      usage: {
        input_tokens:
          cached === null || written === null ? null : usage.input_tokens + cached + written,
        output_tokens: usage.output_tokens,
        cached_input_tokens: cached,
      },
      latency_ms: latency,
    };
  };
}

const ANTHROPIC_STOPS: Record<string, ConversationStop> = {
  end_turn: 'end_turn',
  stop_sequence: 'end_turn',
  tool_use: 'tool_use',
  max_tokens: 'max_tokens',
  model_context_window_exceeded: 'context_window',
  refusal: 'refusal',
  pause_turn: 'pause_turn',
};

function webSearchRequests(usage: BetaUsage) {
  return usage.server_tool_use?.web_search_requests ?? 0;
}

function conversationUsage(usage: BetaUsage): Record<string, number | null> {
  const compactions = (usage.iterations ?? []).flatMap((entry) =>
    entry.type === 'compaction' ? [entry] : [],
  );
  const sum = (pick: (entry: (typeof compactions)[number]) => number) =>
    compactions.reduce((total, entry) => total + pick(entry), 0);
  const cached = usage.cache_read_input_tokens;
  const written = usage.cache_creation_input_tokens;
  if (cached === null || written === null)
    return {
      input_tokens: null,
      output_tokens: usage.output_tokens,
      cached_input_tokens: null,
      web_search_requests: webSearchRequests(usage),
    };
  const read = cached + sum((entry) => entry.cache_read_input_tokens);
  const write = written + sum((entry) => entry.cache_creation_input_tokens);
  const hourWrites =
    (usage.cache_creation?.ephemeral_1h_input_tokens ?? written) +
    sum(
      (entry) =>
        entry.cache_creation?.ephemeral_1h_input_tokens ?? entry.cache_creation_input_tokens,
    );
  return {
    input_tokens: usage.input_tokens + sum((entry) => entry.input_tokens) + read + write,
    output_tokens: usage.output_tokens + sum((entry) => entry.output_tokens),
    cached_input_tokens: read,
    cache_write_input_tokens: write,
    // The breakdown arrives at stream start; a later total never makes it the larger.
    cache_write_1h_input_tokens: Math.min(hourWrites, write),
    reasoning_tokens: usage.output_tokens_details?.thinking_tokens ?? null,
    web_search_requests: webSearchRequests(usage),
  };
}

function usageIterations(usage: BetaUsage): UsageIteration[] {
  return (usage.iterations ?? []).flatMap((entry) =>
    'input_tokens' in entry
      ? [
          {
            type: entry.type,
            input_tokens: entry.input_tokens,
            output_tokens: entry.output_tokens,
            cache_read_input_tokens: entry.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens: entry.cache_creation_input_tokens ?? 0,
          },
        ]
      : [],
  );
}

function cacheDiagnosis(
  previousResponseId: string | null,
  diagnostics: BetaMessage['diagnostics'],
): CacheDiagnosis {
  if (previousResponseId === null) return { reason: 'not_requested' };
  if (!diagnostics) return { reason: 'none' };
  const miss = diagnostics.cache_miss_reason;
  if (!miss) return { reason: 'pending' };
  switch (miss.type) {
    case 'previous_message_not_found':
    case 'unavailable':
      return { reason: miss.type };
    case 'model_changed':
    case 'system_changed':
    case 'tools_changed':
    case 'messages_changed':
      return { reason: miss.type, missed_input_tokens: miss.cache_missed_input_tokens };
    default: {
      const _exhaustive: never = miss;
      return _exhaustive;
    }
  }
}

const HOUR_CACHE = { type: 'ephemeral', ttl: '1h' } as const;

function webSearchTool(maxUses: number): BetaWebSearchTool20250305 {
  return { type: 'web_search_20250305', name: WEB_SEARCH, max_uses: maxUses };
}

export function cachedMessages(messages: readonly ConversationMessage[]): BetaMessageParam[] {
  const compactedAt = messages.findLastIndex((message) =>
    message.content.some((block) => block.type === 'compaction'),
  );
  const boundary = messages.length - 3;
  return messages.map((message, index) => {
    const marked = message.content.map((block, position) => {
      const last = position === message.content.length - 1;
      const atBoundary =
        index === boundary && index > compactedAt && message.role === 'user' && last;
      const compaction =
        index === compactedAt &&
        block.type === 'compaction' &&
        position === message.content.findLastIndex((item) => item.type === 'compaction');
      return atBoundary || compaction ? { ...block, cache_control: HOUR_CACHE } : block;
    });
    return { role: message.role, content: marked } as BetaMessageParam;
  });
}

export function anthropicConversation(
  settings: Settings,
  transport: Transport,
  endpoint: URL,
): Converse {
  const client = anthropicClient(settings, transport, endpoint);
  return async (request, signal, listener) => {
    const started = performance.now();
    let message;
    const callSignal = deadline(settings, signal);
    try {
      const stream = client.beta.messages.stream(
        {
          model: settings.model,
          max_tokens: outputCap(request, settings.maxOutputTokens),
          betas: ['compact-2026-01-12'],
          system: [{ type: 'text', text: request.system, cache_control: HOUR_CACHE }],
          tools: [
            ...request.tools.map(({ name, description, input_schema, stream_input }) => ({
              name,
              description,
              input_schema: { ...input_schema, type: 'object' as const },
              ...(stream_input ? { eager_input_streaming: true } : {}),
            })),
            // Last, so the client tools before it keep their cached bytes. The
            // basic version runs on every model and adds no code-execution blocks.
            ...(request.webSearches > 0 ? [webSearchTool(request.webSearches)] : []),
          ],
          messages: cachedMessages(request.messages),
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { effort: request.effort },
          cache_control: HOUR_CACHE,
          diagnostics: { previous_message_id: request.previousResponseId },
          context_management: {
            edits: [
              {
                type: 'compact_20260112',
                trigger: { type: 'input_tokens', value: request.compactAtTokens },
              },
            ],
          },
        },
        { signal: callSignal },
      );
      if (listener?.text) stream.on('text', (delta) => listener.text?.(delta));
      if (listener?.thinking) stream.on('thinking', (delta) => listener.thinking?.(delta));
      if (listener?.toolInput)
        stream.on('streamEvent', (event, snapshot) => {
          if (event.type !== 'content_block_delta' || event.delta.type !== 'input_json_delta')
            return;
          const block = snapshot.content[event.index];
          if (block?.type === 'tool_use') listener.toolInput?.(block.name, block.input);
        });
      if (listener?.serverTool)
        stream.on('streamEvent', (event) => {
          if (event.type !== 'content_block_start') return;
          const block = event.content_block;
          if (block.type === 'server_tool_use')
            listener.serverTool?.({ id: block.id, name: block.name, status: 'started' });
          else if (block.type === 'web_search_tool_result')
            listener.serverTool?.({
              id: block.tool_use_id,
              name: WEB_SEARCH,
              status: Array.isArray(block.content) ? 'completed' : 'failed',
            });
        });
      message = await stream.finalMessage();
    } catch (error) {
      throw modelError(error, callSignal);
    }
    const blocks = parseBlocks(message.content);
    const latency = Math.round(performance.now() - started);
    const cache = cacheDiagnosis(request.previousResponseId, message.diagnostics);
    const iterations = usageIterations(message.usage);
    logger.info('default agent call ok', {
      latency_ms: latency,
      model: settings.model,
      cache_read_input_tokens: message.usage.cache_read_input_tokens,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens,
      cache_creation_1h_input_tokens: message.usage.cache_creation?.ephemeral_1h_input_tokens,
      cache_miss_reason: cache.reason,
      cache_missed_input_tokens: 'missed_input_tokens' in cache ? cache.missed_input_tokens : null,
      compacted: iterations.some((entry) => entry.type === 'compaction'),
    });
    return {
      blocks,
      text: blockText(blocks),
      toolCalls: blockToolCalls(blocks),
      stop: ANTHROPIC_STOPS[message.stop_reason ?? ''] ?? 'other',
      provider_adapter: 'anthropic',
      endpoint_host: endpoint.hostname,
      requested_model: settings.model,
      returned_model: message.model || settings.model,
      finish_status: message.stop_reason ?? 'unknown',
      usage: conversationUsage(message.usage),
      latency_ms: latency,
      response_id: message.id,
      cache,
      iterations,
    };
  };
}

import Anthropic, { APIConnectionError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import type { BetaMessageParam, BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages';

import { getLogger } from '../logging.ts';
import {
  blockText,
  blockToolCalls,
  parseBlocks,
  type ConversationStop,
  type Converse,
} from './conversation.ts';
import type { GatewaySettings } from './gateway.ts';
import {
  callDeadline,
  ModelError,
  providerErrorCode,
  type Complete,
  type Transport,
} from './http.ts';

const logger = getLogger('app.connectors.agent.client');

/** Anthropic's own API; any other destination speaks OpenAI-compatible chat completions. */
export function isAnthropicEndpoint(endpoint: URL) {
  return endpoint.hostname === 'api.anthropic.com';
}

type Settings = Pick<
  GatewaySettings,
  'apiKey' | 'model' | 'timeoutSeconds' | 'maxOutputTokens' | 'attempts'
>;

/** The SDK's failures as the gateway's own codes: no provider body or credential enters them. */
function modelError(error: unknown) {
  if (error instanceof ModelError) return error;
  if (error instanceof APIUserAbortError || error instanceof APIConnectionError)
    return new ModelError('connection');
  if (error instanceof APIError && error.status !== undefined) {
    logger.warning('default agent call failed', {
      status: error.status,
      error_code: providerErrorCode(error.status),
    });
    const retryAfter = error.headers?.get('retry-after') ?? undefined;
    return new ModelError('http', error.status, retryAfter);
  }
  // A stream that ends in an error event, or a response the SDK cannot read.
  return new ModelError(error instanceof APIError ? 'connection' : 'parse');
}

/**
 * Messages API calls through the official SDK. A schema is enforced as a
 * structured output; the reply always streams so a long answer never meets the
 * SDK's non-streaming time guard, and a listener sees the text as it arrives.
 */
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

/** One deadline across the SDK's retries, as the OpenAI-compatible path keeps. */
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
    try {
      const stream = client.messages.stream(
        {
          model: settings.model,
          max_tokens: settings.maxOutputTokens,
          system,
          messages: [{ role: 'user', content: user }],
          ...(schema ? { output_config: { format: { type: 'json_schema', schema } } } : {}),
        },
        { signal: deadline(settings, signal) },
      );
      if (onText)
        stream.on('text', (delta) => {
          text += delta;
          onText(text);
        });
      message = await stream.finalMessage();
    } catch (error) {
      throw modelError(error);
    }
    const content = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    // A refusal or an empty turn carries no answer to read.
    if (!content.trim()) throw new ModelError('parse');
    const latency = Math.round(performance.now() - started);
    logger.info('default agent call ok', { latency_ms: latency, model: settings.model });
    const { usage } = message;
    // An omitted cache count is unknown, not zero; so is any total built from it.
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
  model_context_window_exceeded: 'max_tokens',
  refusal: 'refusal',
};

/**
 * Prompt tokens by class. Input counts every prompt token, cached or not, as
 * OpenAI-compatible usage does; a compaction's own tokens are billed too but
 * are not in the top-level counts, so they are added from its iteration.
 */
function conversationUsage(usage: BetaUsage): Record<string, number | null> {
  const compactions = (usage.iterations ?? []).flatMap((entry) =>
    entry.type === 'compaction' ? [entry] : [],
  );
  const sum = (pick: (entry: (typeof compactions)[number]) => number) =>
    compactions.reduce((total, entry) => total + pick(entry), 0);
  const cached = usage.cache_read_input_tokens;
  const written = usage.cache_creation_input_tokens;
  // An omitted cache count is unknown, not zero; so is any total built from it.
  if (cached === null || written === null)
    return { input_tokens: null, output_tokens: usage.output_tokens, cached_input_tokens: null };
  const read = cached + sum((entry) => entry.cache_read_input_tokens);
  const write = written + sum((entry) => entry.cache_creation_input_tokens);
  return {
    input_tokens: usage.input_tokens + sum((entry) => entry.input_tokens) + read + write,
    output_tokens: usage.output_tokens + sum((entry) => entry.output_tokens),
    cached_input_tokens: read,
    cache_write_input_tokens: write,
    // Thinking is billed inside output; its share is recorded for the audit.
    reasoning_tokens: usage.output_tokens_details?.thinking_tokens ?? null,
  };
}

/**
 * Native tool calling. The stable system prefix carries one cache breakpoint;
 * top-level automatic caching covers the growing conversation; server-side
 * compaction bounds a long chat. Messages are sent exactly as stored, so a
 * replayed transcript keeps its thinking blocks and its cache.
 */
export function anthropicConversation(
  settings: Settings,
  transport: Transport,
  endpoint: URL,
): Converse {
  const client = anthropicClient(settings, transport, endpoint);
  return async (request, signal, listener) => {
    const started = performance.now();
    let message;
    try {
      const stream = client.beta.messages.stream(
        {
          model: settings.model,
          max_tokens: settings.maxOutputTokens,
          betas: ['compact-2026-01-12'],
          system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
          tools: request.tools.map(({ name, description, input_schema, stream_input }) => ({
            name,
            description,
            input_schema: { ...input_schema, type: 'object' as const },
            ...(stream_input ? { eager_input_streaming: true } : {}),
          })),
          // Stored provider blocks are replayed verbatim; the API validates them.
          messages: request.messages as BetaMessageParam[],
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { effort: request.effort },
          cache_control: { type: 'ephemeral' },
          context_management: {
            edits: [
              {
                type: 'compact_20260112',
                trigger: { type: 'input_tokens', value: request.compactAtTokens },
              },
            ],
          },
        },
        { signal: deadline(settings, signal) },
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
      message = await stream.finalMessage();
    } catch (error) {
      throw modelError(error);
    }
    const blocks = parseBlocks(message.content);
    const latency = Math.round(performance.now() - started);
    logger.info('default agent call ok', {
      latency_ms: latency,
      model: settings.model,
      cache_read_input_tokens: message.usage.cache_read_input_tokens,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens,
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
    };
  };
}

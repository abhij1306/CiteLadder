import { z } from 'zod';

import { policy, resolveSettingSpec } from '../config.ts';
import { getLogger } from '../logging.ts';
import {
  callDeadline,
  chatCompletionsUrl,
  defaultTransport,
  ModelError,
  modelJson,
  parseEndpoint,
  postModel,
  providerErrorCode,
  transientStatus,
  type Complete,
  type Transport,
} from './http.ts';
import { anthropicCompletion, anthropicConversation, isAnthropicEndpoint } from './anthropic.ts';
import type { Converse } from './conversation.ts';
import { assertMetered } from './meter-scope.ts';
import { openAIConversation } from './openai-conversation.ts';
import { normalizedUsage } from './usage.ts';

export type GatewaySettings = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
  maxOutputTokens: number;
  attempts: number;
  baseDelaySeconds: number;
  maxDelaySeconds: number;
};

export function gatewaySettings(
  env: Record<string, string | undefined> = process.env,
): GatewaySettings {
  const spec = policy.models.gateway;
  const setting = (name: keyof typeof spec) => resolveSettingSpec(spec[name], env);
  return {
    apiKey: String(setting('api_key')).trim(),
    baseUrl: String(setting('base_url')).trim(),
    model: String(setting('model')).trim(),
    timeoutSeconds: Number(setting('timeout_seconds')),
    maxOutputTokens: Number(setting('max_output_tokens')),
    attempts: policy.models.max_attempts,
    baseDelaySeconds: Number(setting('retry_base_delay_seconds')),
    maxDelaySeconds: Number(setting('retry_max_delay_seconds')),
  };
}

const completionChoice = z.object({
  message: z.object({ content: z.string().trim().min(1) }),
  finish_reason: z.string().nullish(),
});
const completion = z.object({
  model: z.string().optional(),
  // At least one choice: the first is the answer.
  choices: z.tuple([completionChoice], completionChoice),
  usage: z.record(z.string(), z.unknown()).optional(),
});
const streamChunk = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        delta: z.object({ content: z.string().nullish() }).nullish(),
        finish_reason: z.string().nullish(),
      }),
    )
    .optional(),
  usage: z.record(z.string(), z.unknown()).nullish(),
});
type Completion = z.infer<typeof completion>;

/**
 * An OpenAI-compatible event stream folded into the buffered completion shape,
 * so settlement and parsing never depend on how the text arrived.
 */
async function streamedCompletion(
  response: Response,
  onText: (content: string) => void,
): Promise<Completion> {
  if (!response.body) throw new ModelError('parse');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let content = '';
  let model: string | undefined;
  let finish: string | null = null;
  let usage: Record<string, unknown> | undefined;
  const line = (raw: string) => {
    const data = raw.startsWith('data:') ? raw.slice(5).trim() : '';
    if (!data || data === '[DONE]') return;
    let chunk;
    try {
      chunk = streamChunk.parse(JSON.parse(data));
    } catch {
      throw new ModelError('parse');
    }
    model = chunk.model ?? model;
    usage = chunk.usage ?? usage;
    const choice = chunk.choices?.[0];
    content += choice?.delta?.content ?? '';
    finish = choice?.finish_reason ?? finish;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) line(raw.trim());
    onText(content);
  }
  line(buffer.trim());
  return completion.parse({
    model,
    choices: [{ message: { content }, finish_reason: finish }],
    usage,
  });
}

const logger = getLogger('app.connectors.agent.client');

/** The provider's answer, folded from its stream when a listener asked for one. */
async function readCompletion(
  response: Response,
  onText?: (content: string) => void,
): Promise<Completion> {
  // A provider may ignore the stream request; its JSON answer is read as usual.
  if (onText && response.ok && response.headers.get('content-type')?.includes('event-stream')) {
    try {
      return await streamedCompletion(response, onText);
    } catch (error) {
      if (error instanceof ModelError) throw error;
      // A dropped stream is a connection failure, which the caller may retry.
      throw new ModelError('connection');
    }
  }
  const parsed = completion.safeParse(await modelJson(response));
  if (!parsed.success) throw new ModelError('parse');
  return parsed.data;
}
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']);
const PRIVATE_IPV4 = /^(?:10\.\d+|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d+\.\d+$/u;

/**
 * A host on this machine or the private network: loopback, Docker's host
 * alias, an RFC 1918 address, or a single-label name such as a Compose service
 * (`ollama`). A self-hosted model server there may be reached over plain HTTP.
 */
function isPrivateHost(hostname: string) {
  return LOOPBACK_HOSTS.has(hostname) || PRIVATE_IPV4.test(hostname) || !hostname.includes('.');
}

/** The start of a rejection's body, read without buffering an oversized one. */
async function errorExcerpt(response: Response, limit = 8192) {
  const reader = response.clone().body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  while (text.length < limit) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return text.slice(0, limit);
}

/** The prompt-only form of a schema, for destinations without strict structured outputs. */
function withSchema(user: string, schema: unknown) {
  return `${user}\n\nReturn only JSON matching this schema:\n${JSON.stringify(schema)}`;
}

/** Model text without a leading ``` / ```json fence or a trailing ``` fence. */
function unfenced(content: string) {
  let text = content.trim();
  if (text.startsWith('```')) {
    text = text.slice(3);
    if (text.slice(0, 4).toLowerCase() === 'json') text = text.slice(4);
  }
  if (text.endsWith('```')) text = text.slice(0, -3);
  return text.trim();
}

export function createModelGateway(
  settings = gatewaySettings(),
  transport: Transport = defaultTransport,
) {
  if (![settings.apiKey, settings.baseUrl, settings.model].every((part) => part.trim())) {
    throw new ModelError('not_configured');
  }
  const endpoint = parseEndpoint(settings.baseUrl);
  // Plain HTTP would expose the key and business context; allow it only on
  // this machine or the private network.
  const secure =
    endpoint.protocol === 'https:' ||
    (endpoint.protocol === 'http:' && isPrivateHost(endpoint.hostname));
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !secure) {
    throw new ModelError('not_configured');
  }
  // The configured base URL alone chooses the API, so switching provider is configuration.
  const anthropic = isAnthropicEndpoint(endpoint);
  const send = anthropic
    ? anthropicCompletion(settings, transport, endpoint)
    : openAICompletion(settings, transport, endpoint);
  const talk = anthropic
    ? anthropicConversation(settings, transport, endpoint)
    : openAIConversation(settings, transport, endpoint);
  // Every gateway model call runs inside a metering scope.
  const complete: Complete = async (...args) => {
    assertMetered('model_gateway');
    return send(...args);
  };
  /** Native tool calling for the Agent; a sibling of `complete`, never a widening of it. */
  const converse: Converse = async (...args) => {
    assertMetered('model_gateway');
    return talk(...args);
  };
  return {
    model: settings.model,
    maxOutputTokens: settings.maxOutputTokens,
    baseUrlHost: endpoint.hostname,
    adapter: anthropic ? ('anthropic' as const) : ('openai_compatible' as const),
    converse,
    ...gatewayCalls(complete),
  };
}

/** The structured-call surface over one `complete`, metered or raw. */
export function gatewayCalls(complete: Complete) {
  return {
    complete,
    async completeStructured(
      system: string,
      user: string,
      schema: Record<string, unknown>,
      signal?: AbortSignal,
      onText?: (content: string) => void,
    ) {
      const result = await complete(system, user, signal, onText, schema);
      return { ...result, content: unfenced(result.content) };
    },
    async structured<T>(system: string, user: string, schema: z.ZodType<T>, signal?: AbortSignal) {
      // Callers' schemas may hold optional fields, which strict outputs refuse: the prompt carries them.
      const result = await complete(system, withSchema(user, z.toJSONSchema(schema)), signal);
      try {
        return { value: schema.parse(JSON.parse(unfenced(result.content))), result };
      } catch {
        // The provider billed an answer the caller cannot use; its usage is still recorded.
        throw new ModelError('parse', undefined, undefined, result.usage);
      }
    },
  };
}
export type ModelGateway = ReturnType<typeof createModelGateway>;

/** OpenAI-compatible chat completions, learning per destination what it refuses. */
function openAICompletion(
  settings: GatewaySettings,
  transport: Transport,
  endpoint: URL,
): Complete {
  // Learned per destination: an older output-cap name, and no strict structured outputs.
  let legacyCap = false;
  let promptSchema = false;
  const retry = { ...settings, retryStatus: transientStatus, retryConnection: true };
  const url = chatCompletionsUrl(endpoint);
  return async (system, user, signal, onText, schema) => {
    // A listener asks for a stream; the caller gives one only to transports that pass it through.
    const stream = Boolean(onText);
    const started = performance.now();
    // Retries share one call's timeout, the envelope of a single provider call.
    const deadline = callDeadline(settings.timeoutSeconds, signal);
    const send = (legacy: boolean, strict: boolean) =>
      postModel(
        url,
        settings.apiKey,
        {
          model: settings.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: schema && !strict ? withSchema(user, schema) : user },
          ],
          [legacy ? 'max_tokens' : 'max_completion_tokens']: settings.maxOutputTokens,
          ...(schema && strict
            ? {
                response_format: {
                  type: 'json_schema',
                  json_schema: { name: 'response', strict: true, schema },
                },
              }
            : {}),
          ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
        },
        retry,
        transport,
        deadline,
      );
    const wantsStrict = Boolean(schema) && !promptSchema;
    let legacy = legacyCap;
    let strict = wantsStrict;
    let response = await send(legacy, strict);
    // A destination may reject the newer cap name or strict schemas: ask again without each.
    for (let fallback = 0; fallback < 2 && [400, 422].includes(response.status); fallback++) {
      if (!legacy && (await errorExcerpt(response)).includes('max_completion_tokens'))
        legacy = true;
      else if (strict) strict = false;
      else break;
      response = await send(legacy, strict);
    }
    if (response.ok) {
      legacyCap = legacy;
      if (wantsStrict && !strict) promptSchema = true;
    }
    if (!response.ok)
      logger.warning('default agent call failed', {
        status: response.status,
        model: settings.model,
        error_code: providerErrorCode(response.status),
      });
    const body = await readCompletion(response, stream ? onText : undefined);
    const usage = normalizedUsage(body.usage);
    const latency = Math.round(performance.now() - started);
    logger.info('default agent call ok', { latency_ms: latency, model: settings.model });
    return {
      content: body.choices[0].message.content,
      provider_adapter: 'openai_compatible',
      endpoint_host: endpoint.hostname,
      requested_model: settings.model,
      returned_model: body.model || settings.model,
      finish_status: body.choices[0].finish_reason ?? 'unknown',
      usage,
      latency_ms: latency,
    };
  };
}

/**
 * Native tool calling over OpenAI chat completions. The stored conversation
 * uses Messages API blocks; this adapter translates them, drops blocks chat
 * completions cannot carry (thinking, compaction), and writes its own answer
 * back as text and tool_use blocks so a transcript replays the same way.
 */
import { z } from 'zod';

import { getLogger } from '../logging.ts';
import {
  blockText,
  blockToolCalls,
  parseBlocks,
  toolInput,
  type ConversationBlock,
  type ConversationListener,
  type ConversationMessage,
  type ConversationStop,
  type Converse,
  type Json,
} from './conversation.ts';
import type { GatewaySettings } from './gateway.ts';
import {
  callDeadline,
  chatCompletionsUrl,
  ModelError,
  modelJson,
  postModel,
  providerErrorCode,
  transientStatus,
  type Transport,
} from './http.ts';
import { normalizedUsage } from './usage.ts';

const logger = getLogger('app.connectors.agent.client');

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'tool'; tool_call_id: string; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: {
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }[];
    };

function resultText(block: ConversationBlock) {
  const content = block.content;
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? blockText(parseBlocks(content)) : '';
}

/** One stored message as chat-completion messages; tool results come first, as the API requires. */
function chatMessages(message: ConversationMessage): ChatMessage[] {
  if (message.role === 'assistant') {
    const calls = blockToolCalls(message.content);
    const text = blockText(message.content, '\n\n');
    return [
      {
        role: 'assistant',
        content: text || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: JSON.stringify(call.input) },
              })),
            }
          : {}),
      },
    ];
  }
  const results: ChatMessage[] = message.content.flatMap((block) =>
    block.type === 'tool_result'
      ? [
          {
            role: 'tool' as const,
            tool_call_id: String(block.tool_use_id ?? ''),
            content: resultText(block),
          },
        ]
      : [],
  );
  const text = blockText(message.content, '\n\n');
  return text ? [...results, { role: 'user', content: text }] : results;
}

const toolCallDelta = z.object({
  index: z.number().int().nonnegative(),
  id: z.string().nullish(),
  function: z.object({ name: z.string().nullish(), arguments: z.string().nullish() }).nullish(),
});
const chunkSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        delta: z
          .object({ content: z.string().nullish(), tool_calls: z.array(toolCallDelta).nullish() })
          .nullish(),
        finish_reason: z.string().nullish(),
      }),
    )
    .optional(),
  usage: z.record(z.string(), z.unknown()).nullish(),
});
const completionSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                function: z.object({ name: z.string(), arguments: z.string() }),
              }),
            )
            .nullish(),
        }),
        finish_reason: z.string().nullish(),
      }),
    )
    .min(1),
  usage: z.record(z.string(), z.unknown()).optional(),
});

type Folded = {
  model?: string;
  text: string;
  calls: { id: string; name: string; arguments: string }[];
  finish: string | null;
  usage?: Record<string, unknown>;
};

/** Folds an event stream into one answer, telling the listener each new piece of text. */
async function folded(response: Response, listener?: ConversationListener): Promise<Folded> {
  if (!response.body) throw new ModelError('parse');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const answer: Folded = { text: '', calls: [], finish: null };
  const line = (raw: string) => {
    const data = raw.startsWith('data:') ? raw.slice(5).trim() : '';
    if (!data || data === '[DONE]') return;
    let chunk;
    try {
      chunk = chunkSchema.parse(JSON.parse(data));
    } catch {
      throw new ModelError('parse');
    }
    answer.model = chunk.model ?? answer.model;
    answer.usage = chunk.usage ?? answer.usage;
    const choice = chunk.choices?.[0];
    const delta = choice?.delta?.content ?? '';
    if (delta) {
      answer.text += delta;
      listener?.text?.(delta);
    }
    for (const call of choice?.delta?.tool_calls ?? []) {
      const slot = (answer.calls[call.index] ??= { id: '', name: '', arguments: '' });
      slot.id ||= call.id ?? '';
      slot.name ||= call.function?.name ?? '';
      slot.arguments += call.function?.arguments ?? '';
    }
    answer.finish = choice?.finish_reason ?? answer.finish;
  };
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) line(raw.trim());
  }
  line(buffer.trim());
  return answer;
}

async function readAnswer(response: Response, listener?: ConversationListener): Promise<Folded> {
  if (response.ok && response.headers.get('content-type')?.includes('event-stream')) {
    try {
      return await folded(response, listener);
    } catch (error) {
      if (error instanceof ModelError) throw error;
      // A dropped stream is a connection failure, which the caller may retry.
      throw new ModelError('connection');
    }
  }
  // A destination may ignore the stream request; its JSON answer is read as usual.
  const parsed = completionSchema.safeParse(await modelJson(response));
  if (!parsed.success) throw new ModelError('parse');
  const [choice] = parsed.data.choices;
  return {
    model: parsed.data.model,
    text: choice?.message.content ?? '',
    calls: (choice?.message.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    })),
    finish: choice?.finish_reason ?? null,
    usage: parsed.data.usage,
  };
}

/** Tool arguments as the model wrote them; unreadable JSON becomes `{}`, which the tool refuses. */
function decodedArguments(text: string): Record<string, Json> {
  try {
    return toolInput(JSON.parse(text || '{}'));
  } catch {
    return {};
  }
}

const OPENAI_STOPS: Record<string, ConversationStop> = {
  stop: 'end_turn',
  tool_calls: 'tool_use',
  length: 'max_tokens',
  content_filter: 'refusal',
};

export function openAIConversation(
  settings: GatewaySettings,
  transport: Transport,
  endpoint: URL,
): Converse {
  const retry = { ...settings, retryStatus: transientStatus, retryConnection: true };
  const url = chatCompletionsUrl(endpoint);
  return async (request, signal, listener) => {
    const started = performance.now();
    const deadline = callDeadline(settings.timeoutSeconds, signal);
    const response = await postModel(
      url,
      settings.apiKey,
      {
        model: settings.model,
        messages: [
          { role: 'system', content: request.system },
          ...request.messages.flatMap(chatMessages),
        ],
        tools: request.tools.map(({ name, description, input_schema }) => ({
          type: 'function',
          function: { name, description, parameters: input_schema },
        })),
        parallel_tool_calls: true,
        reasoning_effort: request.effort,
        max_completion_tokens: settings.maxOutputTokens,
        // One key for the shared prefix improves cache routing.
        prompt_cache_key: 'citeladder-agent',
        stream: true,
        stream_options: { include_usage: true },
      },
      retry,
      transport,
      deadline,
    );
    if (!response.ok)
      logger.warning('default agent call failed', {
        status: response.status,
        model: settings.model,
        error_code: providerErrorCode(response.status),
      });
    const answer = await readAnswer(response, listener);
    const blocks: ConversationBlock[] = [
      ...(answer.text ? [{ type: 'text', text: answer.text }] : []),
      ...answer.calls.map((call) => ({
        type: 'tool_use',
        id: call.id,
        name: call.name,
        input: decodedArguments(call.arguments),
      })),
    ];
    const latency = Math.round(performance.now() - started);
    logger.info('default agent call ok', { latency_ms: latency, model: settings.model });
    return {
      blocks,
      text: answer.text,
      toolCalls: blockToolCalls(blocks),
      stop: OPENAI_STOPS[answer.finish ?? ''] ?? 'other',
      provider_adapter: 'openai_compatible',
      endpoint_host: endpoint.hostname,
      requested_model: settings.model,
      returned_model: answer.model || settings.model,
      finish_status: answer.finish ?? 'unknown',
      // Chat completions charge no cache write.
      usage: { ...normalizedUsage(answer.usage), cache_write_input_tokens: 0 },
      latency_ms: latency,
    };
  };
}

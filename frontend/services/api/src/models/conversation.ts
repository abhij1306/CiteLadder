import { z } from 'zod';
import { plainJson } from '../db/json.ts';

export type Json = z.infer<ReturnType<typeof z.json>>;

export type ConversationBlock = { type: string; [key: string]: Json | undefined };
export type ConversationMessage = {
  role: 'user' | 'assistant';
  content: ConversationBlock[];
};
export type ConversationTool = {
  name: string;
  description: string;
  input_schema: Record<string, Json>;
  stream_input?: boolean;
};
type ReasoningEffort = 'low' | 'medium' | 'high';
export type ConversationRequest = {
  system: string;
  tools: ConversationTool[];
  messages: ConversationMessage[];
  effort: ReasoningEffort;
  compactAtTokens: number;
  previousResponseId: string | null;
  webSearches: number;
  /**
   * The output cap (thinking included) this call is sent with when lower than
   * the route's; omitted is the route's configured cap.
   */
  maxOutputTokens?: number;
};
export function outputCap(
  request: Pick<ConversationRequest, 'maxOutputTokens'>,
  configured: number,
) {
  return Math.min(configured, request.maxOutputTokens ?? configured);
}
export type CacheDiagnosis =
  | { reason: 'not_requested' | 'none' | 'pending' | 'previous_message_not_found' | 'unavailable' }
  | {
      reason: 'model_changed' | 'system_changed' | 'tools_changed' | 'messages_changed';
      missed_input_tokens: number;
    };
export type UsageIteration = {
  type: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};
export type ToolCall = { id: string; name: string; input: Record<string, Json> };
export type ConversationStop =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'context_window'
  | 'refusal'
  | 'pause_turn'
  | 'other';
export type ConversationResult = {
  blocks: ConversationBlock[];
  text: string;
  toolCalls: ToolCall[];
  stop: ConversationStop;
  provider_adapter: string;
  endpoint_host: string;
  requested_model: string;
  returned_model: string;
  finish_status: string;
  usage: Record<string, number | null>;
  latency_ms: number;
  response_id: string;
  cache: CacheDiagnosis;
  iterations: UsageIteration[];
};
export type ConversationListener = {
  text?: (delta: string) => void;
  thinking?: (delta: string) => void;
  toolInput?: (name: string, input: unknown) => void;
  serverTool?: (event: ServerToolEvent) => void;
};
export type ServerToolEvent = {
  id: string;
  name: string;
  status: 'started' | 'completed' | 'failed';
};
export type Converse = (
  request: ConversationRequest,
  signal?: AbortSignal,
  listener?: ConversationListener,
) => Promise<ConversationResult>;

/**
 * The UTF-8 bytes a provider reads, recorded on each model attempt. A
 * compaction block replaces everything before it, so earlier messages, still
 * sent for append-only replay, are not read and not counted.
 */
export function conversationInputBytes(request: ConversationRequest) {
  const start = request.messages.findLastIndex((message) =>
    message.content.some((block) => block.type === 'compaction'),
  );
  const { system, tools, messages } = request;
  const read = start < 0 ? messages : messages.slice(start);
  return Buffer.byteLength(JSON.stringify({ system, tools, messages: read }), 'utf8');
}

const blockShape = z.object({ type: z.string() }).catchall(z.json());
/**
 * Content blocks, validated but returned as given: an object schema would
 * rebuild each block with its own key order, and replay must keep the bytes.
 */
export const blocksSchema = z.array(
  z.custom<ConversationBlock>((value) => blockShape.safeParse(value).success),
);
export function parseBlocks(value: unknown): ConversationBlock[] {
  return blocksSchema.parse(plainJson(value));
}
export function blockText(blocks: readonly ConversationBlock[], separator = '') {
  return blocks
    .flatMap((block) => (block.type === 'text' ? [String(block.text ?? '')] : []))
    .join(separator);
}

export function blockToolCalls(blocks: readonly ConversationBlock[]): ToolCall[] {
  return blocks.flatMap((block) =>
    block.type === 'tool_use'
      ? [
          {
            id: String(block.id ?? ''),
            name: String(block.name ?? ''),
            input: toolInput(block.input),
          },
        ]
      : [],
  );
}

export const WEB_SEARCH = 'web_search';
export type WebSource = { url: string; title: string };
type WebSearchCall = { id: string; query: string };
type WebSearchResult = {
  callId: string;
  sources: WebSource[] | null;
};
const searchCallSchema = z.object({
  id: z.string(),
  name: z.literal(WEB_SEARCH),
  input: z.object({ query: z.string() }).catch({ query: '' }),
});
const searchResultSchema = z.object({
  tool_use_id: z.string(),
  content: z.union([
    z.array(z.object({ url: z.string(), title: z.string().catch('') }).loose()),
    z.object({ error_code: z.string() }).loose(),
  ]),
});
/**
 * The web searches in a block list: the calls the model made and the results
 * that came back. With a read in the same response, a call's result arrives
 * at the start of the next response instead, so the two are listed apart.
 */
export function webSearchBlocks(blocks: readonly ConversationBlock[]) {
  const calls: WebSearchCall[] = [];
  const results: WebSearchResult[] = [];
  for (const block of blocks) {
    if (block.type === 'server_tool_use') {
      const call = searchCallSchema.safeParse(block);
      if (call.success) calls.push({ id: call.data.id, query: call.data.input.query });
    } else if (block.type === 'web_search_tool_result') {
      const result = searchResultSchema.safeParse(block);
      if (!result.success) continue;
      const { content } = result.data;
      results.push({
        callId: result.data.tool_use_id,
        sources: Array.isArray(content)
          ? content.map(({ url, title }) => ({ url, title: title || url }))
          : null,
      });
    }
  }
  return { calls, results };
}

function pendingServerTool(blocks: readonly ConversationBlock[]) {
  const answered = new Set(
    blocks.flatMap((block) =>
      typeof block.tool_use_id === 'string' && block.type !== 'tool_result'
        ? [block.tool_use_id]
        : [],
    ),
  );
  return (block: ConversationBlock) =>
    block.type === 'server_tool_use' && typeof block.id === 'string' && !answered.has(block.id);
}

export function hasPendingServerTool(blocks: readonly ConversationBlock[]) {
  return blocks.some(pendingServerTool(blocks));
}

/**
 * The blocks without provider-hosted calls that never got their result, for a
 * response no later call continues. An empty result keeps a placeholder text,
 * since an empty assistant message makes every later replay invalid.
 */
export function withoutPendingServerTools(blocks: readonly ConversationBlock[]) {
  const pending = pendingServerTool(blocks);
  const kept = blocks.filter((block) => !pending(block));
  return kept.length ? kept : [{ type: 'text', text: '(no answer)' }];
}

const inputSchema = z.record(z.string(), z.json());
export function toolInput(value: unknown): Record<string, Json> {
  const parsed = inputSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

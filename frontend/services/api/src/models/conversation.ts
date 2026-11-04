/**
 * The native tool-calling conversation shape shared by both provider adapters.
 * Blocks follow the Messages API: Anthropic receives them verbatim (stored as
 * `json` and validated without being rebuilt), so a replayed transcript is
 * byte-identical; the OpenAI adapter translates them.
 */
import { z } from 'zod';
import { plainJson } from '../db/json.ts';

export type Json = z.infer<ReturnType<typeof z.json>>;

/** One content block exactly as a provider returned it, or as the caller wrote it. */
export type ConversationBlock = { type: string; [key: string]: Json | undefined };
export type ConversationMessage = {
  role: 'user' | 'assistant';
  content: ConversationBlock[];
};
export type ConversationTool = {
  name: string;
  description: string;
  input_schema: Record<string, Json>;
  /** Stream this tool's input as it is written (Anthropic), so a document is seen live. */
  stream_input?: boolean;
};
type ReasoningEffort = 'low' | 'medium' | 'high';
export type ConversationRequest = {
  /** The stable prefix: identical for every chat, so providers serve it from cache. */
  system: string;
  /** Sorted by name; part of the cached prefix. */
  tools: ConversationTool[];
  messages: ConversationMessage[];
  effort: ReasoningEffort;
  /** Anthropic server-side compaction triggers at this many input tokens. */
  compactAtTokens: number;
  /**
   * The provider's id for the chat's previous response, or `null` for a chat's
   * first call: Anthropic compares the two prompts and reports why the cache missed.
   */
  previousResponseId: string | null;
  /**
   * How many provider-hosted web searches this call may run; 0 offers none.
   * Anthropic only: chat completions have no hosted search and ignore it.
   */
  webSearches: number;
};
/**
 * Why the prompt cache could not reuse the previous call's prefix. `not_requested`
 * had no previous response to compare; `none` compared and found no change;
 * `pending` came back before the comparison finished. Changed reasons carry the
 * provider's estimate of the input that followed the change.
 */
export type CacheDiagnosis =
  | { reason: 'not_requested' | 'none' | 'pending' | 'previous_message_not_found' | 'unavailable' }
  | {
      reason: 'model_changed' | 'system_changed' | 'tools_changed' | 'messages_changed';
      missed_input_tokens: number;
    };
/** One sampling step of a call: a compaction summary or the answer itself. */
export type UsageIteration = {
  type: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};
export type ToolCall = { id: string; name: string; input: Record<string, Json> };
/**
 * How a response ended, the same whichever API produced it: `max_tokens` is the
 * output cap (thinking included), `context_window` the model's input limit and
 * `pause_turn` a provider-hosted tool loop that the next call continues.
 */
export type ConversationStop =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'context_window'
  | 'refusal'
  | 'pause_turn'
  | 'other';
export type ConversationResult = {
  /** The assistant content exactly as returned, for append-only replay. */
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
  /** The provider's id for this response; '' when it sent none. */
  response_id: string;
  cache: CacheDiagnosis;
  /** Per-step usage when the provider reports it, compaction steps included. */
  iterations: UsageIteration[];
};
/** Display listeners for one call; nothing here is persisted. */
export type ConversationListener = {
  /** Each new piece of answer text. */
  text?: (delta: string) => void;
  /** Each new piece of a thinking summary. */
  thinking?: (delta: string) => void;
  /** A streamed tool input so far, partially parsed. */
  toolInput?: (name: string, input: unknown) => void;
  /** A provider-hosted tool call started, or returned its result. */
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

const blockShape = z.object({ type: z.string() }).catchall(z.json());
/**
 * Content blocks, validated but returned as given: an object schema would
 * rebuild each block with its own key order, and replay must keep the bytes.
 */
export const blocksSchema = z.array(
  z.custom<ConversationBlock>((value) => blockShape.safeParse(value).success),
);
/** Provider content as plain JSON blocks; anything else is an unreadable answer. */
export function parseBlocks(value: unknown): ConversationBlock[] {
  return blocksSchema.parse(plainJson(value));
}
/** The answer text of a block list; blocks that are separate passages need a `separator`. */
export function blockText(blocks: readonly ConversationBlock[], separator = '') {
  return blocks
    .flatMap((block) => (block.type === 'text' ? [String(block.text ?? '')] : []))
    .join(separator);
}

/** The tool calls of a block list, in the order the model wrote them. */
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
/** A web page a provider-hosted search returned: untrusted observation, never a fact. */
export type WebSource = { url: string; title: string };
type WebSearchCall = { id: string; query: string };
type WebSearchResult = {
  callId: string;
  /** `null` when the search failed; an empty list is a search that matched nothing. */
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

/** A provider-hosted call in these blocks still waits for its result in the next call. */
export function hasPendingServerTool(blocks: readonly ConversationBlock[]) {
  const answered = new Set(
    blocks.flatMap((block) =>
      typeof block.tool_use_id === 'string' && block.type !== 'tool_result'
        ? [block.tool_use_id]
        : [],
    ),
  );
  return blocks.some(
    (block) =>
      block.type === 'server_tool_use' && typeof block.id === 'string' && !answered.has(block.id),
  );
}

const inputSchema = z.record(z.string(), z.json());
/** A tool input is a JSON object; anything else becomes `{}`, which the tool then refuses. */
export function toolInput(value: unknown): Record<string, Json> {
  const parsed = inputSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

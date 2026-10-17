/**
 * The native tool-calling conversation shape shared by both provider adapters.
 * Blocks follow the Messages API: Anthropic receives them verbatim, so a
 * replayed transcript is byte-identical; the OpenAI adapter translates them.
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
};
export type ToolCall = { id: string; name: string; input: Record<string, Json> };
/** How a response ended, the same whichever API produced it. */
export type ConversationStop = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';
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
};
/** Display listeners for one call; nothing here is persisted. */
export type ConversationListener = {
  /** Each new piece of answer text. */
  text?: (delta: string) => void;
  /** Each new piece of a thinking summary. */
  thinking?: (delta: string) => void;
  /** A streamed tool input so far, partially parsed. */
  toolInput?: (name: string, input: unknown) => void;
};
export type Converse = (
  request: ConversationRequest,
  signal?: AbortSignal,
  listener?: ConversationListener,
) => Promise<ConversationResult>;

export const blocksSchema = z.array(z.object({ type: z.string() }).catchall(z.json()));
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

const inputSchema = z.record(z.string(), z.json());
/** A tool input is a JSON object; anything else becomes `{}`, which the tool then refuses. */
export function toolInput(value: unknown): Record<string, Json> {
  const parsed = inputSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db/database.ts';
import { authorize } from './access.ts';
import { abortable } from './async.ts';
import { argumentProblem, inputSchema } from '../mcp/tools.ts';
import { callerMessage } from '../mcp/types.ts';
import type { ConversationTool } from '../models/conversation.ts';
import { compareText } from '../text-order.ts';
import { agentPolicy, type Scope, type Json } from './contracts.ts';

type ToolResult = {
  state: 'available' | 'unavailable';
  data: Json;
  artifactRefs: { id: string; record_uri?: string; [key: string]: Json | undefined }[];
  omissions: Json[];
};
export type ToolOutcome = {
  status: 'completed' | 'unavailable' | 'failed' | 'refused';
  text: string;
  refs: ToolResult['artifactRefs'];
  omissions: Json[];
  hash: string;
  error: string;
};
export type ReadTool = {
  name: string;
  description: string;
  arguments: z.ZodType<Record<string, Json>>;
  read: (
    scope: Scope,
    args: Record<string, Json>,
    signal: AbortSignal,
    maxChars: number,
  ) => Promise<ToolResult>;
};

const jsonObject = z.record(z.string(), z.json());
/**
 * What the model is offered: the same compact input schema MCP publishes, so
 * the provider checks the arguments the tool will parse, sorted by name so the
 * cached prompt prefix never changes order.
 */
export function toolDefinitions(
  tools: readonly Pick<ReadTool, 'name' | 'description' | 'arguments'>[],
): ConversationTool[] {
  return tools
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: jsonObject.parse(inputSchema(tool.arguments)),
    }))
    .toSorted((a, b) => compareText(a.name, b.name));
}

/** Server-pinned scope; registry entries are read adapters, never HTTP or SQL tools. */
export class ToolRegistry {
  readonly #tools: Map<string, ReadTool>;
  readonly version: string;
  constructor(version: string, tools: readonly ReadTool[]) {
    this.version = version;
    this.#tools = new Map(tools.map((tool) => [tool.name, tool]));
    if (this.#tools.size !== tools.length) throw new TypeError('Duplicate Agent tool');
  }
  catalog() {
    return toolDefinitions([...this.#tools.values()]);
  }
  has(name: string) {
    return this.#tools.has(name);
  }
  async execute(
    db: Database,
    scope: Scope,
    name: string,
    args: Record<string, Json>,
    signal: AbortSignal,
    maxChars = agentPolicy.tool_result_max_chars,
  ): Promise<ToolOutcome> {
    await authorize(db, scope);
    const tool = this.#tools.get(name);
    // Refusals tell the model how to correct the call; it reads them as a tool result.
    if (!tool)
      return refused('unknown_tool', `Unknown tool ${name}. Call one of the listed tools.`);
    if (Object.hasOwn(args, 'project_id') || Object.hasOwn(args, 'workspace_id'))
      return refused(
        'invalid_arguments',
        'The project is fixed for this chat. Remove project_id and workspace_id.',
      );
    const parsed = tool.arguments.safeParse(args);
    if (!parsed.success) return refused('invalid_arguments', argumentProblem(parsed.error));
    try {
      const result = await abortable(() => tool.read(scope, parsed.data, signal, maxChars), signal);
      const serialized = JSON.stringify(result.data);
      const bounded = boundToolData(result.data, maxChars, name === 'get_project_business_context');
      return {
        status: result.state === 'unavailable' ? 'unavailable' : 'completed',
        text: bounded.text,
        refs: result.artifactRefs,
        omissions: [...result.omissions, ...bounded.omissions],
        hash: createHash('sha256').update(serialized).digest('hex'),
        error: '',
      };
    } catch (error) {
      // A correctable argument is refused with the owner's reason; anything else failed.
      const problem = callerMessage(error);
      if (problem !== null) return refused('invalid_arguments', problem);
      return {
        ...refused('tool_failed', 'This read failed. Try a different read or answer without it.'),
        status: 'failed',
      };
    }
  }
}
function packNestedEvidence(
  selected: Record<string, Json>,
  omitted: string[],
  key: string,
  value: Record<string, Json>,
  fits: () => boolean,
) {
  const nested: Record<string, Json> = {};
  selected[key] = nested;
  omitted.splice(omitted.indexOf(key), 1, ...Object.keys(value).map((field) => `${key}.${field}`));
  for (const [field, child] of Object.entries(value)) {
    const path = `${key}.${field}`;
    const at = omitted.indexOf(path);
    nested[field] = child;
    omitted.splice(at, 1);
    if (!fits()) {
      delete nested[field];
      omitted.splice(at, 0, path);
    }
  }
}
export function boundToolData(data: Json, maxChars: number, splitOverview = false) {
  const full = JSON.stringify(data);
  if (full.length <= maxChars) return { text: full, supplied: true, omissions: [] };
  const selected: Record<string, Json> = {};
  const fields = data && typeof data === 'object' && !Array.isArray(data) ? data : { value: data };
  const omitted = Object.keys(fields);
  const envelope = () =>
    JSON.stringify({ data: selected, complete: false, omitted_sections: omitted });
  for (const [key, value] of Object.entries(fields)) {
    selected[key] = value;
    const index = omitted.indexOf(key);
    omitted.splice(index, 1);
    if (envelope().length > maxChars) {
      delete selected[key];
      omitted.splice(index, 0, key);
      // Composite overviews contain independent evidence families. Keep whole
      // smaller families instead of losing the entire overview to one large one.
      if (
        splitOverview &&
        key === 'evidence' &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        packNestedEvidence(selected, omitted, key, value, () => envelope().length <= maxChars);
      }
    }
  }
  const text = envelope();
  return {
    text:
      text.length <= maxChars
        ? text
        : JSON.stringify({ complete: false, reason: 'tool_result_size_limit' }),
    supplied: Object.keys(selected).length > 0 && text.length <= maxChars,
    omissions: [{ reason: 'tool_result_truncated', count: 1, sections: omitted }],
  };
}
/** A call not run: `error` is the recorded code, `text` what the model is told. */
export function refused(error: string, text: string): ToolOutcome {
  return { status: 'refused', text, refs: [], omissions: [], hash: '', error };
}

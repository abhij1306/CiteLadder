import { z } from 'zod';
import { CHANGE_KINDS } from '../changes/kinds.ts';
import type { Database } from '../db/database.ts';
import { isRecord, plainJson } from '../db/json.ts';
import { principalForCall } from './data.ts';
import { McpInputError, type Evidence, type EvidencePrincipal } from './types.ts';
import { type Definition } from './tool-definitions.ts';
import { accountTools } from './tools-account.ts';
import { visibilityTools } from './tools-visibility.ts';
import { promptTools } from './tools-prompts.ts';
import { siteTools } from './tools-site.ts';
import { trafficTools } from './tools-traffic.ts';
import { searchTools } from './tools-search.ts';
import { appTools } from './tools-apps.ts';

export const definitions = {
  ...accountTools,
  ...visibilityTools,
  ...promptTools,
  ...siteTools,
  ...trafficTools,
  ...searchTools,
  ...appTools,
};
type ToolName = keyof typeof definitions;
export const presentationTools: ReadonlySet<string> = new Set<ToolName>([
  'render_visibility',
  'render_site_health',
  'open_analytics',
]);

const FORMATS = new Set(['uuid', 'date', 'date-time']);
function compact(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(compact);
  if (!isRecord(node)) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (
      key === '$schema' ||
      (key === 'pattern' && FORMATS.has(String(node.format))) ||
      (['minimum', 'maximum'].includes(key) && Math.abs(Number(value)) === Number.MAX_SAFE_INTEGER)
    )
      continue;
    out[key] = compact(value);
  }
  const options = out.anyOf;
  if (Array.isArray(options) && Object.keys(out).length === 1) {
    const kept = options.filter(
      (option) =>
        !(option && typeof option === 'object' && 'type' in option && option.type === 'null'),
    );
    if (kept.length === 1) return kept[0];
  }
  return out;
}
export function inputSchema(schema: z.ZodType) {
  return compact(z.toJSONSchema(schema, { io: 'input' }));
}
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
export function withoutSentencesNaming(description: string, names: ReadonlySet<string>) {
  return description
    .split(/(?<=\.)\s+/u)
    .filter(
      (sentence) =>
        ![...sentence.matchAll(/\b[a-z]+(?:_[a-z]+)+\b/gu)].some(([word]) => names.has(word)),
    )
    .join(' ');
}
const changeKindNames: ReadonlySet<string> = new Set(CHANGE_KINDS);

export const tools = Object.entries(definitions).map(([name, definition]) => ({
  name,
  title: definition.title,
  description: withoutSentencesNaming(definition.description, changeKindNames),
  inputSchema: inputSchema(definition.schema),
  annotations,
}));

const output = z.record(z.string(), z.json());
function isToolName(name: string): name is ToolName {
  return Object.hasOwn(definitions, name);
}
export function argumentProblem(error: z.ZodError) {
  return `Invalid arguments: ${error.issues
    .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
    .join('; ')}`;
}

export async function dispatchTool(
  db: Database,
  principal: EvidencePrincipal,
  name: string,
  input: unknown,
  origin: string,
  maxBytes?: number,
): Promise<Evidence> {
  if (!isToolName(name)) throw new McpInputError(`Unknown tool: ${name}`);
  const definition: Definition<z.ZodObject> = definitions[name];
  const parsed = definition.schema.safeParse(input);
  if (!parsed.success) throw new McpInputError(argumentProblem(parsed.error));
  const call = principalForCall(principal);
  const result = await definition.read({ db, principal: call, origin, maxBytes }, parsed.data);
  return output.parse(plainJson(result));
}

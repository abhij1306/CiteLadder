/** The shared MCP catalogue runs under live membership on the chat's fixed project. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db/database.ts';
import { policy } from '../config.ts';
import { definitions, dispatchTool, presentationTools } from '../mcp/tools.ts';
import { parseRecordId } from '../mcp/retrieval.ts';
import { stoppableReads } from './async.ts';
import { ToolRegistry, toolDefinitions, type ReadTool } from './tools.ts';
import { agentPolicy, type Json, type Scope } from './contracts.ts';

const reference = z.object({ id: z.string(), record_uri: z.string().nullish() }).catchall(z.json());
const availability = z.enum([
  'available',
  'unavailable',
  policy.demand.QUERY_EVIDENCE_STATE_OBSERVED_ZERO,
]);
/**
 * What the model reads: the result without its artifact references. Those are
 * recorded as the attempt's sources (the app shows them), and each row keeps
 * its own `record_uri` to open; repeating them would crowd rows out of the bound.
 */
function modelData(data: Record<string, Json>) {
  const { artifact_refs: _refs, ...rest } = data;
  return rest;
}
function outcome(value: unknown) {
  const data = z.record(z.string(), z.json()).parse(value);
  const refs = z.array(reference).parse(data.artifact_refs ?? []);
  const unavailable = availability.parse(data.state ?? 'available') === 'unavailable';
  // The reason an absent read gives is the omission the turn records.
  const reason = unavailable && typeof data.reason === 'string' ? [{ reason: data.reason }] : [];
  return {
    state: unavailable ? ('unavailable' as const) : ('available' as const),
    data: modelData(data),
    artifactRefs: refs.map((ref) => {
      const { record_uri, ...rest } = ref;
      return { ...rest, ...(record_uri ? { record_uri } : {}) };
    }),
    omissions: [...z.array(z.json()).parse(data.omissions ?? []), ...reason],
  };
}
/**
 * About half the page, never a size the tool refuses (some accept only fixed
 * sizes); otherwise the largest accepted size that is still smaller.
 */
export function smallerLimit(schema: z.ZodType, from: number) {
  let fallback: number | null = null;
  for (let limit = from - 1; limit >= 1; limit--) {
    if (!schema.safeParse(limit).success) continue;
    if (limit <= from / 2) return limit;
    fallback ??= limit;
  }
  return fallback;
}
/**
 * The Agent's page size for a shared read whose `limit` accepts every size up
 * to the Agent's maximum and has no default of its own: smaller pages than an
 * MCP client's, so a representative sample is the first thing the model sees
 * and more is one cursor away. Other limits (fixed sizes, own defaults) stay.
 */
function agentPage(schema: z.ZodType | undefined) {
  const { read_default_limit: fallback, read_max_limit: max } = agentPolicy;
  if (!schema || schema.safeParse(undefined).data !== undefined) return null;
  for (let size = 1; size <= max; size++) if (!schema.safeParse(size).success) return null;
  return {
    fallback,
    schema: z
      .number()
      .int()
      .min(1)
      .max(max)
      .nullish()
      .describe(`How many rows to return, at most ${max}; omit for ${fallback}.`),
  };
}
// The chat's project is fixed, and MCP App views render nothing in a chat.
const NOT_FOR_AGENT = new Set(['list_projects', ...presentationTools]);
/** The shared reads, each stopped by its signal: the read timeout and Stop end the work, not only the wait. */
export function sharedReads(db: Database): ReadTool[] {
  return Object.entries(definitions)
    .filter(([name]) => !NOT_FOR_AGENT.has(name))
    .map(([name, definition]) => {
      const { project_id: _project, ...fields } = definition.schema.shape as Record<
        string,
        z.ZodType
      >;
      const page = agentPage(fields.limit);
      return {
        name,
        description: definition.description,
        arguments: z.strictObject(page ? { ...fields, limit: page.schema } : fields) as z.ZodType<
          Record<string, Json>
        >,
        read: async (scope: Scope, args: Record<string, Json>, signal, maxChars) => {
          const reads = stoppableReads(db, signal);
          const input: Record<string, Json> = {
            ...args,
            ...(page ? { limit: args.limit ?? page.fallback } : {}),
            ...(_project ? { project_id: scope.projectId } : {}),
          };
          const dispatch = () =>
            dispatchTool(
              reads,
              {
                kind: 'member',
                userId: scope.userId,
                workspaceId: scope.workspaceId,
                projectId: scope.projectId,
              },
              name,
              input,
              '',
              maxChars,
            );
          let data = await dispatch();
          // Let the existing owner construct a smaller page and its exact
          // continuation cursor. Never discard rows behind a later cursor.
          const limitSchema = fields.limit;
          if (limitSchema && Array.isArray(data.items)) {
            let limit: number | null = data.items.length;
            while (JSON.stringify(outcome(data).data).length > maxChars) {
              limit = smallerLimit(limitSchema, limit);
              if (limit === null) break;
              input.limit = limit;
              data = await dispatch();
            }
          }
          const result = outcome(data);
          if (name === 'fetch' && typeof data.id === 'string') {
            result.artifactRefs.push({ id: parseRecordId(data.id).id, record_uri: data.id });
          }
          return result;
        },
      };
    });
}
export function agentTools(db: Database) {
  const entries = sharedReads(db);
  // The version fingerprints exactly what the model is offered.
  const catalog = JSON.stringify(toolDefinitions(entries));
  const version = `agent-tools-${createHash('sha256').update(catalog).digest('hex').slice(0, 16)}`;
  return new ToolRegistry(version, entries);
}

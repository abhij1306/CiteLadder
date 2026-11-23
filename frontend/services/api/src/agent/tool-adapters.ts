import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db/database.ts';
import { policy } from '../config.ts';
import {
  definitions,
  dispatchTool,
  presentationTools,
  withoutSentencesNaming,
} from '../mcp/tools.ts';
import { parseRecordId } from '../mcp/retrieval.ts';
import { CHANGE_KINDS } from '../changes/kinds.ts';
import { isAgentChangeKind } from './change-proposals.ts';
import { stoppableReads } from './async.ts';
import { ToolRegistry, toolDefinitions, type ReadTool } from './tools.ts';
import { agentPolicy, type Json, type Scope } from './contracts.ts';
import { widen } from '../widen.ts';

const reference = z.object({ id: z.string(), record_uri: z.string().nullish() }).catchall(z.json());
const availability = z.enum([
  'available',
  'unavailable',
  policy.demand.QUERY_EVIDENCE_STATE_OBSERVED_ZERO,
]);
function modelData(data: Record<string, Json>) {
  const { artifact_refs: _refs, ...rest } = data;
  return rest;
}
function outcome(value: unknown) {
  const data = z.record(z.string(), z.json()).parse(value);
  const refs = z.array(reference).parse(data.artifact_refs ?? []);
  const unavailable = availability.parse(data.state ?? 'available') === 'unavailable';
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
export function smallerLimit(schema: z.ZodType, from: number) {
  let fallback: number | null = null;
  for (let limit = from - 1; limit >= 1; limit--) {
    if (!schema.safeParse(limit).success) continue;
    if (limit <= from / 2) return limit;
    fallback ??= limit;
  }
  return fallback;
}
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
const fetchedRecord = z.object({ id: z.string() });
const searchResults = z.object({ results: z.array(fetchedRecord) });
function namedRecords(name: string, data: unknown): string[] {
  if (name === 'fetch') {
    const fetched = fetchedRecord.safeParse(data);
    return fetched.success ? [fetched.data.id] : [];
  }
  if (name === 'search') return searchResults.parse(data).results.map((result) => result.id);
  return [];
}
const NOT_FOR_AGENT = new Set(['list_projects', ...presentationTools]);
const MISSING_TOOLS: ReadonlySet<string> = new Set([
  ...NOT_FOR_AGENT,
  ...CHANGE_KINDS.filter((kind) => !isAgentChangeKind(kind)),
]);
export function sharedReads(db: Database): ReadTool[] {
  return Object.entries(definitions)
    .filter(([name]) => !NOT_FOR_AGENT.has(name))
    .map(([name, definition]) => {
      const { project_id: _project, ...fields } = widen<Record<string, z.ZodType>>(
        definition.schema.shape,
      );
      const page = agentPage(fields.limit);
      return {
        name,
        description: withoutSentencesNaming(definition.description, MISSING_TOOLS),
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
          const limitSchema = fields.limit;
          if (limitSchema && Array.isArray(data.items)) {
            let limit: number | null = data.items.length;
            while (JSON.stringify(outcome(data).data).length > maxChars) {
              limit = smallerLimit(limitSchema, limit);
              if (limit === null) break;
              input.limit = limit;
              data = await dispatch(); // NOSONAR
            }
          }
          const result = outcome(data);
          for (const uri of namedRecords(name, data))
            result.artifactRefs.push({ id: parseRecordId(uri).id, record_uri: uri });
          return result;
        },
      };
    });
}
export function agentTools(db: Database) {
  const entries = sharedReads(db);
  const catalog = JSON.stringify(toolDefinitions(entries));
  const version = `agent-tools-${createHash('sha256').update(catalog).digest('hex').slice(0, 16)}`;
  return new ToolRegistry(version, entries);
}

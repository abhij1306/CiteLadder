/**
 * Public read shapes that compose existing owners: the project's prompts with
 * their latest measurement, and a prompt set's generation runs. Both read
 * persisted rows only.
 */
import { promptSchema } from '@citeladder/contracts/project';
import { sql } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { listPromptSets } from '../prompts/prompt-sets.ts';
import { getPromptMetrics, type PromptMetricItem } from '../visibility/prompts.ts';
import { cursorId, nextCursor, pageAfter } from './pagination.ts';

type Scope = { workspaceId: string; projectId: string };

/**
 * A prompt's latest completed brand run: `not_measured` until one includes it;
 * a measured rate is `null` when that run could not determine it.
 */
const latestMeasurementSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('measured'),
    audit_id: z.uuid(),
    mention_rate: z.number().nullable(),
    citation_rate: z.number().nullable(),
  }),
  z.object({ state: z.literal('not_measured') }),
  // A cohort with no per-prompt visibility reading (brand diagnostics).
  z.object({ state: z.literal('unavailable') }),
]);
// A prompt's own cohort; "all" pools cohorts and is no prompt's measurement.
const MEASURED_COHORTS: readonly string[] = policy.visibility.requestable_cohorts.filter(
  (cohort) => cohort !== policy.visibility.all_cohort,
);
export const publicPromptSchema = promptSchema.extend({
  latest_measurement: latestMeasurementSchema,
});

export const generationRunSchema = z.object({
  id: z.uuid(),
  prompt_set_id: z.uuid(),
  generator_version: z.string(),
  created_at: z.string(),
});

export type PromptFilters = {
  promptSetId: string | null;
  topicId: string | null;
  status: string | null;
};

async function latestMetrics(db: Database, scope: Scope): Promise<Map<string, PromptMetricItem>> {
  const query = {
    auditId: null,
    auditIds: null,
    baselineAuditIds: null,
    logicalEngine: null,
    baselineId: null,
  };
  const cohorts = await Promise.all(
    MEASURED_COHORTS.map((cohort) => getPromptMetrics(db, scope, { ...query, cohort })),
  );
  const byPrompt = new Map<string, PromptMetricItem>();
  for (const item of cohorts.flat()) if (item.prompt_id) byPrompt.set(item.prompt_id, item);
  return byPrompt;
}

function latestMeasurement(cohort: string, measured: PromptMetricItem | undefined) {
  if (!MEASURED_COHORTS.includes(cohort)) return { state: 'unavailable' as const };
  if (!measured) return { state: 'not_measured' as const };
  return {
    state: 'measured' as const,
    audit_id: measured.audit_id,
    mention_rate: measured.visibility_rate ?? null,
    citation_rate: measured.owned_citation_rate ?? null,
  };
}
export async function listPublicPrompts(
  db: Database,
  scope: Scope,
  filters: PromptFilters,
  page: { cursor: string | null; limit: number },
) {
  const sets = await listPromptSets(db, scope.workspaceId, scope.projectId);
  const prompts = sets
    .filter((set) => filters.promptSetId === null || set.id === filters.promptSetId)
    .flatMap((set) => set.prompts)
    .filter(
      (prompt) =>
        (filters.topicId === null || prompt.topic_id === filters.topicId) &&
        (filters.status === null || prompt.status === filters.status),
    );
  const paged = pageAfter(prompts, page, {
    endpoint: 'prompts',
    filters: { project_id: scope.projectId, ...filters },
  });
  const metrics = paged.items.length
    ? await latestMetrics(db, scope)
    : new Map<string, PromptMetricItem>();
  return {
    next_cursor: paged.next_cursor,
    items: paged.items.map((prompt) => {
      const measured = metrics.get(prompt.id);
      return {
        ...prompt,
        latest_measurement: latestMeasurement(prompt.cohort, measured),
      };
    }),
  };
}

/** A prompt set's generation runs, newest first, one keyset page at a time. */
export async function listGenerationRuns(
  db: Database,
  workspaceId: string,
  promptSetId: string,
  page: { cursor: string | null; limit: number },
) {
  const scope = { endpoint: 'generation-runs', filters: { prompt_set_id: promptSetId } };
  const after = cursorId(page.cursor, scope);
  let query = db
    .selectFrom('prompt_generation_runs')
    .select(['id', 'prompt_set_id', 'generator_version', 'created_at'])
    .where('workspace_id', '=', workspaceId)
    .where('prompt_set_id', '=', promptSetId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(page.limit + 1);
  if (after !== null)
    query = query.where(
      sql<boolean>`(created_at, id) < (SELECT anchor.created_at, anchor.id FROM prompt_generation_runs AS anchor WHERE anchor.id = ${after} AND anchor.prompt_set_id = ${promptSetId})`,
    );
  const rows = await query.execute();
  const items = rows.slice(0, page.limit).map((row): z.input<typeof generationRunSchema> => ({
    ...row,
    created_at: row.created_at.toISOString(),
  }));
  const last = items.at(-1);
  return {
    items,
    next_cursor: rows.length > page.limit && last ? nextCursor(scope, last.id) : null,
  };
}

/**
 * Prompt sets: a project's prompt library containers.
 *
 * Project bootstrap and Commerce also create sets; deleting one takes the
 * project lock and then the set lock, the order generation holds while
 * it stages candidates, so a delete never lands between its re-resolution and
 * its inserts.
 */
import { randomUUID } from 'node:crypto';

import {
  promptSetCreateRequestSchema,
  promptSetUpdateRequestSchema,
} from '@citeladder/contracts/prompt-requests';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import type { PromptFormLimits } from '@citeladder/contracts/project';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { notFound } from '../errors.ts';
import type { DB } from '../generated/db-schema.ts';
import { acquireProjectLock, acquirePromptSetLock } from './locks.ts';
import { promptSetView, type PromptSetRow, type PromptSetView } from './views.ts';
import { generationSetting } from './generation-input.ts';

export const promptSetCreate = promptSetCreateRequestSchema.extend({
  name: z.string().max(255).default(''),
  description: z.string().max(1024).default(''),
});
export const promptSetUpdate = promptSetUpdateRequestSchema.extend({
  name: z.string().max(255).nullish(),
  description: z.string().max(1024).nullish(),
});

/** A set in the caller's workspace (and named project), or `Prompt set not found`. */
export async function scopedPromptSet(
  db: Kysely<DB>,
  workspaceId: string,
  promptSetId: string,
  projectId: string | null = null,
): Promise<PromptSetRow> {
  const query = db
    .selectFrom('prompt_sets')
    .innerJoin('projects', 'projects.id', 'prompt_sets.project_id')
    .selectAll('prompt_sets')
    .where('prompt_sets.id', '=', promptSetId)
    .where('projects.workspace_id', '=', workspaceId);
  const row = await (
    projectId === null ? query : query.where('projects.id', '=', projectId)
  ).executeTakeFirst();
  if (row === undefined) throw notFound('Prompt set');
  return row;
}

/** The sets' views, each with its prompts in creation order. */
async function views(db: Database, sets: readonly PromptSetRow[]): Promise<PromptSetView[]> {
  if (sets.length === 0) return [];
  const prompts = await db
    .selectFrom('prompts')
    .selectAll()
    .where(
      'prompt_set_id',
      'in',
      sets.map((set) => set.id),
    )
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const bySet = Map.groupBy(prompts, (prompt) => prompt.prompt_set_id);
  return sets.map((set) => promptSetView(set, bySet.get(set.id) ?? []));
}

export async function readPromptSet(
  db: Database,
  workspaceId: string,
  promptSetId: string,
): Promise<PromptSetView> {
  const [view] = await views(db, [await scopedPromptSet(db, workspaceId, promptSetId)]);
  return view!;
}

export async function listPromptSets(
  db: Database,
  workspaceId: string,
  projectId: string | null,
): Promise<PromptSetView[]> {
  let query = db
    .selectFrom('prompt_sets')
    .innerJoin('projects', 'projects.id', 'prompt_sets.project_id')
    .selectAll('prompt_sets')
    .where('projects.workspace_id', '=', workspaceId);
  if (projectId !== null) query = query.where('prompt_sets.project_id', '=', projectId);
  const sets = await query
    .orderBy('prompt_sets.created_at', 'desc')
    .orderBy('prompt_sets.id')
    .execute();
  return views(db, sets);
}

/**
 * The bounds the request schemas enforce on the forms a prompt-set list opens,
 * read from the same policy values so the browser never restates them.
 */
export function promptFormLimits(): PromptFormLimits {
  const generation = policy.prompts.generation;
  return {
    generation_count_max: generationSetting('max_count'),
    import_rows_max: policy.prompts.import_max_rows,
    persona_max_chars: policy.prompts.persona_max_chars,
    run_context_max_chars: generation.run_context_max_chars,
    distribution_personas_max: generation.distribution_personas_max,
    seed_query_ids_max: generation.seed_query_ids_max,
    context_list_max_entries: policy.brand_identity.context_list_max_entries,
    audit_repetitions_min: policy.audits.min_repetitions,
    audit_repetitions_max: policy.audits.max_repetitions,
  };
}

export async function createPromptSet(
  db: Database,
  workspaceId: string,
  input: z.infer<typeof promptSetCreate>,
): Promise<PromptSetView> {
  const project = await db
    .selectFrom('projects')
    .select('id')
    .where('id', '=', input.project_id)
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();
  if (project === undefined) throw notFound('Project');
  const now = new Date();
  const row = await db
    .insertInto('prompt_sets')
    .values({
      id: randomUUID(),
      workspace_id: workspaceId,
      project_id: project.id,
      name: input.name,
      description: input.description,
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return promptSetView(row, []);
}

export async function updatePromptSet(
  db: Database,
  workspaceId: string,
  promptSetId: string,
  input: z.infer<typeof promptSetUpdate>,
): Promise<PromptSetView> {
  const set = await scopedPromptSet(db, workspaceId, promptSetId);
  const changes = {
    ...(input.name == null ? {} : { name: input.name }),
    ...(input.description == null ? {} : { description: input.description }),
  };
  if (Object.keys(changes).length > 0) {
    await db
      .updateTable('prompt_sets')
      .set({ ...changes, updated_at: new Date() })
      .where('id', '=', set.id)
      .execute();
  }
  return readPromptSet(db, workspaceId, promptSetId);
}

export async function deletePromptSet(
  db: Database,
  workspaceId: string,
  promptSetId: string,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const set = await scopedPromptSet(trx, workspaceId, promptSetId);
    await acquireProjectLock(trx, set.project_id);
    await acquirePromptSetLock(trx, set.id);
    await trx.deleteFrom('prompt_sets').where('id', '=', set.id).execute();
  });
}

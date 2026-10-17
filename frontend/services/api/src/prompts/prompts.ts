/**
 * Prompts: manual create, edit, delete, bulk review transitions and bulk
 * import.
 *
 * Every insert path takes the project lock, then the set lock, the order
 * generation and Commerce use. The per-set hash uniqueness stays the final
 * race guard. Text entering active measurement passes topical
 * binding (`binding.ts`) against the persisted project identity and the
 * prompt's own topic.
 */
import { randomUUID } from 'node:crypto';

import {
  buyerStageSchema,
  promptCohortSchema,
  promptStatusSchema,
} from '@citeladder/contracts/project';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import { inTransaction, type Database } from '../db/database.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { ApiError, notFound } from '../errors.ts';
import type { DB } from '../generated/db-schema.ts';
import {
  BINDING_FAILURES,
  bindingError,
  bindingFailure,
  loadVocabulary,
  type BindingFailure,
} from './binding.ts';
import { brandFiling } from './brand-filing.ts';
import { acquireProjectLock, acquirePromptSetLock } from './locks.ts';
import { promptTextHash } from './normalization.ts';
import { readPromptSet, scopedPromptSet } from './prompt-sets.ts';
import { resolveTopicsByName } from './topics.ts';
import { promptView, type PromptRow, type PromptSetView, type PromptView } from './views.ts';
import { firstOf, isNonEmpty, type NonEmpty } from '../lists.ts';

const P = policy.prompts;
const INTENTS = new Set(P.intents);
const BRANDED = new Set(P.branded_cohorts);
const UNIQUE_TEXT = 'uq_prompt_set_normalized_text';
const DUPLICATE = 'An equivalent prompt already exists in this set';

const text = z.string().trim().min(1).max(P.text_max_chars);
const theme = z.string().max(P.theme_max_chars);
const intent = z.string().max(P.intent_max_chars);
const persona = z.string().trim().max(P.persona_max_chars);

/** An omitted cohort is filed by whether the text names the brand (`brand-filing.ts`). */
export const promptInput = z.strictObject({
  text,
  theme: theme.default(''),
  intent: intent.default(''),
  buyer_stage: buyerStageSchema.default(''),
  persona: persona.default(''),
  cohort: promptCohortSchema.optional(),
  enabled: z.boolean().default(true),
  topic_id: z.uuid().nullish(),
});
export const promptBatch = z.strictObject({
  prompts: z.array(promptInput).min(1).max(P.create_batch_max),
});
export const promptUpdate = z.strictObject({
  text: text.nullish(),
  theme: theme.nullish(),
  intent: intent.nullish(),
  buyer_stage: buyerStageSchema.nullish(),
  persona: persona.nullish(),
  cohort: promptCohortSchema.nullish(),
  enabled: z.boolean().nullish(),
  status: promptStatusSchema.nullish(),
  topic_id: z.uuid().nullish(),
});
export const promptBulkStatus = z.strictObject({
  prompt_ids: z.array(z.uuid()).min(1),
  status: promptStatusSchema,
});
const importRow = z.strictObject({
  text: z.string().trim().max(P.text_max_chars),
  theme: theme.default(''),
  intent: intent.default(''),
  buyer_stage: buyerStageSchema.default(''),
  persona: persona.default(''),
  cohort: promptCohortSchema.optional(),
  enabled: z.boolean().default(true),
  topic: z.string().trim().max(P.topic_name_max_chars).default(''),
});
export const promptImport = z.strictObject({
  prompts: z.array(importRow).max(P.import_max_rows),
});

/** Trim and lower-case an intent; an unknown one is unspecified (''). */
function normalizeIntent(value: string): string {
  const normalized = value.trim().toLowerCase();
  return INTENTS.has(normalized) ? normalized : '';
}

type Cohort = z.infer<typeof promptCohortSchema>;
const cohortColumns = (cohort: Cohort) => ({ cohort, branded: BRANDED.has(cohort) });

/** A prompt in the caller's workspace with its project, or `Prompt not found`. */
export async function scopedPrompt(db: Kysely<DB>, workspaceId: string, promptId: string) {
  const row = await db
    .selectFrom('prompts')
    .innerJoin('prompt_sets', 'prompt_sets.id', 'prompts.prompt_set_id')
    .innerJoin('projects', 'projects.id', 'prompt_sets.project_id')
    .selectAll('prompts')
    .select('prompt_sets.project_id')
    .where('prompts.id', '=', promptId)
    .where('projects.workspace_id', '=', workspaceId)
    .executeTakeFirst();
  if (row === undefined) throw notFound('Prompt');
  return row;
}

/** The topic's persisted name and description, or 404 outside the project. */
async function topicText(db: Kysely<DB>, projectId: string, topicId: string): Promise<string> {
  const topic = await db
    .selectFrom('topics')
    .select(['name', 'description'])
    .where('id', '=', topicId)
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  if (topic === undefined) throw new ApiError(404, "Topic not found in this prompt's project");
  return [topic.name, topic.description].filter(Boolean).join(' ');
}

async function requireBinding(
  db: Kysely<DB>,
  projectId: string,
  value: string,
  topicId: string | null,
): Promise<void> {
  const context = topicId === null ? '' : await topicText(db, projectId, topicId);
  const failure = bindingFailure(value, await loadVocabulary(db, projectId), context);
  if (failure !== null) throw bindingError(failure);
}

export async function listPrompts(
  db: Database,
  workspaceId: string,
  promptSetId: string,
): Promise<PromptView[]> {
  return (await readPromptSet(db, workspaceId, promptSetId)).prompts;
}

export async function createPrompt(
  db: Database,
  workspaceId: string,
  promptSetId: string,
  input: z.infer<typeof promptInput>,
): Promise<PromptView> {
  return firstOf(await createPrompts(db, workspaceId, promptSetId, [input]), 'created prompt');
}

/**
 * Create manual prompts in one transaction: every one binds and is new to the
 * set (and to the batch), or nothing is created.
 */
type Screened<T> = {
  input: T;
  hash: string;
  problem: { kind: 'binding'; failure: BindingFailure } | { kind: 'duplicate' } | null;
};

/**
 * Each input with what stops it inserting: a topical binding failure, or text
 * equivalent to an earlier input or to a prompt already in the set.
 */
async function screen<T extends { text: string; topic_id?: string | null }>(
  db: Kysely<DB>,
  set: { id: string; project_id: string },
  inputs: readonly T[],
): Promise<Screened<T>[]> {
  const vocabulary = await loadVocabulary(db, set.project_id);
  const topicIds = [...new Set(inputs.flatMap((input) => input.topic_id ?? []))];
  const topics = new Map(
    await Promise.all(
      topicIds.map(
        async (topicId) => [topicId, await topicText(db, set.project_id, topicId)] as const,
      ),
    ),
  );
  const hashes = inputs.map((input) => promptTextHash(input.text));
  const existing = isNonEmpty(hashes)
    ? await db
        .selectFrom('prompts')
        .select('normalized_text_hash')
        .where('prompt_set_id', '=', set.id)
        .where('normalized_text_hash', 'in', hashes)
        .execute()
    : [];
  // Texts already in the set, then each input that passes: only those can repeat.
  const taken = new Set(existing.map((row) => row.normalized_text_hash));
  return inputs.map((input) => {
    const hash = promptTextHash(input.text);
    const failure = bindingFailure(
      input.text,
      vocabulary,
      input.topic_id ? (topics.get(input.topic_id) ?? '') : '',
    );
    const duplicate = failure === null && taken.has(hash);
    if (failure === null) taken.add(hash);
    let problem: Screened<unknown>['problem'] = null;
    if (failure !== null) problem = { kind: 'binding', failure };
    else if (duplicate) problem = { kind: 'duplicate' };
    return { input, hash, problem };
  });
}

/**
 * The inputs `createPrompts` would accept, and each dropped one with why. A
 * read: the insert screens again under its locks.
 */
export async function screenPrompts(
  db: Database,
  workspaceId: string,
  promptSetId: string,
  inputs: readonly z.infer<typeof promptInput>[],
) {
  const set = await scopedPromptSet(db, workspaceId, promptSetId);
  const screened = await screen(db, set, inputs);
  return {
    admitted: screened.flatMap((item) => (item.problem === null ? [item.input] : [])),
    dropped: screened.flatMap(({ input, problem }) =>
      problem === null
        ? []
        : [
            {
              text: input.text,
              ...(problem.kind === 'binding'
                ? BINDING_FAILURES[problem.failure]
                : { code: 'duplicate', message: DUPLICATE }),
            },
          ],
    ),
  };
}

export async function createPrompts(
  db: Database,
  workspaceId: string,
  promptSetId: string,
  inputs: NonEmpty<z.infer<typeof promptInput>>,
): Promise<PromptView[]> {
  try {
    return await inTransaction(db, async (trx) => {
      const set = await scopedPromptSet(trx, workspaceId, promptSetId);
      await acquireProjectLock(trx, set.project_id);
      await acquirePromptSetLock(trx, set.id);
      // Screened under the project lock, so the topic vocabulary cannot change before the insert.
      const screened = await screen(trx, set, inputs);
      for (const { problem } of screened)
        if (problem?.kind === 'binding') throw bindingError(problem.failure);
      if (screened.some((item) => item.problem !== null)) throw new ApiError(409, DUPLICATE);
      const planned = screened.map(({ input, hash }) => ({ input, id: randomUUID(), hash }));
      const filing = await brandFiling(trx, set.project_id);
      const now = new Date();
      const rows = await trx
        .insertInto('prompts')
        .values(
          planned.map(({ input, id, hash }, index) => ({
            id,
            prompt_set_id: set.id,
            topic_id: input.topic_id ?? null,
            text: input.text,
            normalized_text_hash: hash,
            theme: input.theme.trim(),
            intent: normalizeIntent(input.intent),
            buyer_stage: input.buyer_stage,
            persona: input.persona,
            ...cohortColumns(input.cohort ?? filing(input.text)),
            enabled: input.enabled,
            status: P.status_active,
            origin: P.origins.manual,
            // A millisecond apart, so creation-ordered lists keep the request's order.
            created_at: new Date(now.getTime() + index),
            updated_at: now,
          })),
        )
        .returningAll()
        .execute();
      // RETURNING order is unspecified; answer in request order.
      const byId = new Map(rows.map((row) => [row.id, promptView(row)]));
      return planned.flatMap(({ id }) => byId.get(id) ?? []);
    });
  } catch (error) {
    if (isUniqueViolation(error, UNIQUE_TEXT)) throw new ApiError(409, DUPLICATE);
    throw error;
  }
}

export async function updatePrompt(
  db: Database,
  workspaceId: string,
  promptId: string,
  input: z.infer<typeof promptUpdate>,
): Promise<PromptView> {
  try {
    return await inTransaction(db, (trx) => applyPromptUpdate(trx, workspaceId, promptId, input));
  } catch (error) {
    if (isUniqueViolation(error, UNIQUE_TEXT)) throw new ApiError(409, DUPLICATE);
    throw error;
  }
}

/**
 * The edit, under the project lock that topic writers take, so the topic and
 * vocabulary it binds against cannot change before it commits.
 */
async function applyPromptUpdate(
  db: Kysely<DB>,
  workspaceId: string,
  promptId: string,
  input: z.infer<typeof promptUpdate>,
): Promise<PromptView> {
  const prompt = await scopedPrompt(db, workspaceId, promptId);
  await acquireProjectLock(db, prompt.project_id);
  // An explicit null detaches the prompt; an absent key leaves its topic.
  const topicGiven = 'topic_id' in input;
  const topicId = topicGiven ? (input.topic_id ?? null) : prompt.topic_id;
  if (topicGiven && topicId !== null) await topicText(db, prompt.project_id, topicId);
  const activates = input.status === P.status_active && prompt.status !== P.status_active;
  // Re-filing an active prompt under another topic changes what it must bind to.
  const refiled =
    topicId !== prompt.topic_id && (input.status ?? prompt.status) === P.status_active;
  if (input.text != null || activates || refiled) {
    await requireBinding(db, prompt.project_id, input.text ?? prompt.text, topicId);
  }
  const changes: Partial<PromptRow> = {
    ...(input.text == null
      ? {}
      : { text: input.text, normalized_text_hash: promptTextHash(input.text) }),
    ...(input.theme == null ? {} : { theme: input.theme.trim() }),
    ...(input.intent == null ? {} : { intent: normalizeIntent(input.intent) }),
    ...(input.buyer_stage == null ? {} : { buyer_stage: input.buyer_stage }),
    ...(input.persona == null ? {} : { persona: input.persona }),
    ...(input.cohort == null ? {} : cohortColumns(input.cohort)),
    ...(input.enabled == null ? {} : { enabled: input.enabled }),
    ...(input.status == null ? {} : { status: input.status }),
    ...(topicGiven ? { topic_id: topicId } : {}),
  };
  const row = await db
    .updateTable('prompts')
    .set({ ...changes, updated_at: new Date() })
    .where('id', '=', prompt.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  return promptView(row);
}

export async function deletePrompt(
  db: Database,
  workspaceId: string,
  promptId: string,
): Promise<void> {
  const prompt = await scopedPrompt(db, workspaceId, promptId);
  await db.deleteFrom('prompts').where('id', '=', prompt.id).execute();
}

type Failed<T> = { item: T; failure: BindingFailure; code: string; message: string };

/** Each failing item; the whole request is rejected if any fail. */
function failures<T>(items: readonly T[], check: (item: T) => BindingFailure | null): Failed<T>[] {
  return items.flatMap((item) => {
    const failure = check(item);
    return failure === null ? [] : [{ item, failure, ...BINDING_FAILURES[failure] }];
  });
}

/** Archive or activate prompts of one set; all of them, or none (404). */
export async function bulkSetStatus(
  db: Database,
  workspaceId: string,
  promptSetId: string,
  input: z.infer<typeof promptBulkStatus>,
): Promise<PromptSetView> {
  const ids = [...new Set(input.prompt_ids)];
  await inTransaction(db, async (trx) => {
    const set = await scopedPromptSet(trx, workspaceId, promptSetId);
    await acquireProjectLock(trx, set.project_id);
    await acquirePromptSetLock(trx, set.id);
    if (input.status === P.status_active) {
      const rows = await trx
        .selectFrom('prompts')
        .leftJoin('topics', 'topics.id', 'prompts.topic_id')
        .select(['prompts.id', 'prompts.text', 'topics.name', 'topics.description'])
        .where('prompts.prompt_set_id', '=', set.id)
        .where('prompts.id', 'in', ids)
        .execute();
      const vocabulary = await loadVocabulary(trx, set.project_id);
      const failed = failures(rows, (row) =>
        bindingFailure(row.text, vocabulary, [row.name, row.description].filter(Boolean).join(' ')),
      );
      if (isNonEmpty(failed)) {
        throw bindingError(
          failed[0].failure,
          `${failed.length} prompt(s) fail topical binding and cannot be activated`,
          {
            prompts: failed.map(({ item, code, message }) => ({
              prompt_id: item.id,
              code,
              message,
            })),
          },
        );
      }
    }
    const result = await trx
      .updateTable('prompts')
      .set({ status: input.status, updated_at: new Date() })
      .where('prompt_set_id', '=', set.id)
      .where('id', 'in', ids)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) !== ids.length) {
      throw new ApiError(404, 'Prompt(s) not found in this set');
    }
  });
  return readPromptSet(db, workspaceId, promptSetId);
}

/**
 * Import parsed rows as `imported` prompts, atomically: every non-blank row
 * must bind, and an over-allowance import inserts nothing. Blank rows are
 * skipped and duplicates (in the set, or repeated in the upload) are dropped
 * before occupancy is charged. A row's topic name reuses a project topic
 * (case-insensitively) or creates one, only for rows that insert.
 */
export async function importPrompts(
  db: Database,
  workspaceId: string,
  promptSetId: string,
  input: z.infer<typeof promptImport>,
): Promise<PromptSetView> {
  await db.transaction().execute(async (trx) => {
    const set = await scopedPromptSet(trx, workspaceId, promptSetId);
    await acquireProjectLock(trx, set.project_id);
    await acquirePromptSetLock(trx, set.id);
    const rows = input.prompts.map((row, index) => ({ ...row, index }));
    const vocabulary = await loadVocabulary(trx, set.project_id);
    const failed = failures(
      rows.filter((row) => row.text),
      (row) => bindingFailure(row.text, vocabulary),
    );
    if (isNonEmpty(failed)) {
      throw bindingError(
        failed[0].failure,
        `${failed.length} imported prompt row(s) fail topical binding; no rows were imported`,
        {
          rows: failed.map(({ item, code, message }) => ({ row: item.index, code, message })),
        },
      );
    }
    const byHash = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const hash = row.text ? promptTextHash(row.text) : '';
      if (hash && !byHash.has(hash)) byHash.set(hash, row);
    }
    if (byHash.size === 0) return;
    const existing = await trx
      .selectFrom('prompts')
      .select('normalized_text_hash')
      .where('prompt_set_id', '=', set.id)
      .where('normalized_text_hash', 'in', [...byHash.keys()])
      .execute();
    for (const { normalized_text_hash: hash } of existing) byHash.delete(hash);
    if (byHash.size === 0) return;
    const topics = await resolveTopicsByName(
      trx,
      set.project_id,
      [...byHash.values()].map((row) => row.topic),
    );
    const now = new Date();
    const filing = await brandFiling(trx, set.project_id);
    await trx
      .insertInto('prompts')
      .values(
        [...byHash].map(([hash, row]) => ({
          id: randomUUID(),
          prompt_set_id: set.id,
          topic_id: topics.get(row.topic.toLowerCase()) ?? null,
          text: row.text,
          normalized_text_hash: hash,
          theme: row.theme.trim(),
          intent: normalizeIntent(row.intent),
          buyer_stage: row.buyer_stage,
          persona: row.persona,
          ...cohortColumns(row.cohort ?? filing(row.text)),
          enabled: row.enabled,
          status: P.status_active,
          origin: P.origins.imported,
          created_at: now,
          updated_at: now,
        })),
      )
      .onConflict((conflict) => conflict.constraint(UNIQUE_TEXT).doNothing())
      .execute();
  });
  return readPromptSet(db, workspaceId, promptSetId);
}

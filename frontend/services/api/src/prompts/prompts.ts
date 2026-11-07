/**
 * Prompts: manual create, edit, delete, bulk review transitions and bulk
 * import.
 *
 * Inserts go through `insertPrompts` (`insert.ts`), which takes the project
 * and set locks in that order and drops duplicates. Text entering active
 * measurement passes topical
 * binding (`binding.ts`) against the persisted project identity and the
 * prompt's own topic.
 */
import type { promptCohortSchema } from '@citeladder/contracts/project';
import {
  promptBulkStatusRequestSchema,
  promptCreateRequestSchema,
  promptImportRequestSchema,
  promptImportRowRequestSchema,
  promptUpdateRequestSchema,
} from '@citeladder/contracts/prompt-requests';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import { policy } from '../config.ts';
import { inTransaction, type Database } from '../db/database.ts';
import type { RecordScope } from '../db/workspace-scope.ts';
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
import { brandedCohort, DUPLICATE_PROMPT, insertPrompts } from './insert.ts';
import { acquireProjectLock, acquirePromptSetLock } from './locks.ts';
import { promptTextHash } from './normalization.ts';
import { readPromptSet, scopedPromptSet } from './prompt-sets.ts';
import { resolveTopicsByName } from './topics.ts';
import { promptView, type PromptRow, type PromptSetView, type PromptView } from './views.ts';
import { firstOf, isNonEmpty, type NonEmpty } from '../lists.ts';

const P = policy.prompts;
const INTENTS = new Set(P.intents);
const UNIQUE_TEXT = 'uq_prompt_set_normalized_text';
const DUPLICATE = DUPLICATE_PROMPT;

const text = z.string().trim().min(1).max(P.text_max_chars);
const theme = z.string().max(P.theme_max_chars);
const intent = z.string().max(P.intent_max_chars);
const persona = z.string().trim().max(P.persona_max_chars);

/** An omitted cohort is filed by whether the text names the brand (`brand-filing.ts`). */
export const promptInput = promptCreateRequestSchema.extend({
  text,
  theme: theme.default(''),
  intent: intent.default(''),
  persona: persona.default(''),
});
export const promptBatch = z.strictObject({
  prompts: z.array(promptInput).min(1).max(P.create_batch_max),
});
export const promptUpdate = promptUpdateRequestSchema.extend({
  text: text.nullish(),
  theme: theme.nullish(),
  intent: intent.nullish(),
  persona: persona.nullish(),
});
export const promptBulkStatus = promptBulkStatusRequestSchema;
const importRow = promptImportRowRequestSchema.extend({
  text: z.string().trim().max(P.text_max_chars),
  theme: theme.default(''),
  intent: intent.default(''),
  persona: persona.default(''),
  topic: z.string().trim().max(P.topic_name_max_chars).default(''),
});
export const promptImport = promptImportRequestSchema.extend({
  prompts: z.array(importRow).max(P.import_max_rows),
});

/** Trim and lower-case an intent; an unknown one is unspecified (''). */
function normalizeIntent(value: string): string {
  const normalized = value.trim().toLowerCase();
  return INTENTS.has(normalized) ? normalized : '';
}

type Cohort = z.infer<typeof promptCohortSchema>;
const cohortColumns = (cohort: Cohort) => ({ cohort, branded: brandedCohort(cohort) });

/** A prompt in the caller's workspace (and named project) with its project, or `Prompt not found`. */
export async function scopedPrompt(
  db: Kysely<DB>,
  workspaceId: string,
  promptId: string,
  projectId: string | null = null,
) {
  const query = db
    .selectFrom('prompts')
    .innerJoin('prompt_sets', 'prompt_sets.id', 'prompts.prompt_set_id')
    .innerJoin('projects', 'projects.id', 'prompt_sets.project_id')
    .selectAll('prompts')
    .select('prompt_sets.project_id')
    .where('prompts.id', '=', promptId)
    .where('projects.workspace_id', '=', workspaceId);
  const row = await (
    projectId === null ? query : query.where('projects.id', '=', projectId)
  ).executeTakeFirst();
  if (row === undefined) throw notFound('Prompt');
  return row;
}

/** Every one of `promptIds` in the project, or a 404 naming how many are not in it. */
export async function scopedPrompts(
  db: Kysely<DB>,
  scope: { workspaceId: string; projectId: string },
  promptIds: readonly string[],
) {
  const ids = [...new Set(promptIds)];
  const rows = isNonEmpty(ids)
    ? await db
        .selectFrom('prompts')
        .innerJoin('prompt_sets', 'prompt_sets.id', 'prompts.prompt_set_id')
        .select(['prompts.id', 'prompts.text', 'prompts.status', 'prompts.prompt_set_id'])
        .where('prompts.id', 'in', ids)
        .where('prompts.workspace_id', '=', scope.workspaceId)
        .where('prompt_sets.project_id', '=', scope.projectId)
        .execute()
    : [];
  if (rows.length !== ids.length)
    throw new ApiError(404, `${ids.length - rows.length} prompt(s) were not found in this project`);
  return rows;
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
  scope: RecordScope,
  promptSetId: string,
  input: z.infer<typeof promptInput>,
): Promise<PromptView> {
  return firstOf(await createPrompts(db, scope, promptSetId, [input]), 'created prompt');
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
  scope: RecordScope,
  promptSetId: string,
  inputs: readonly z.infer<typeof promptInput>[],
) {
  const set = await scopedPromptSet(db, scope.workspaceId, promptSetId, scope.projectId);
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
  scope: RecordScope,
  promptSetId: string,
  inputs: NonEmpty<z.infer<typeof promptInput>>,
): Promise<PromptView[]> {
  return inTransaction(db, async (trx) => {
    const set = await scopedPromptSet(trx, scope.workspaceId, promptSetId, scope.projectId);
    await acquireProjectLock(trx, set.project_id);
    await acquirePromptSetLock(trx, set.id);
    // Screened under the project lock, so the topic vocabulary cannot change before the insert.
    const screened = await screen(trx, set, inputs);
    for (const { problem } of screened)
      if (problem?.kind === 'binding') throw bindingError(problem.failure);
    const filing = await brandFiling(trx, set.project_id);
    const rows = await insertPrompts(
      trx,
      set,
      inputs.map((input) => ({
        text: input.text,
        topic_id: input.topic_id ?? null,
        theme: input.theme.trim(),
        intent: normalizeIntent(input.intent),
        buyer_stage: input.buyer_stage,
        persona: input.persona,
        cohort: input.cohort ?? filing(input.text),
        enabled: input.enabled,
      })),
      { origin: 'manual', onDuplicate: 'reject' },
    );
    return rows.flatMap((row) => (row === null ? [] : [promptView(row)]));
  });
}

export async function updatePrompt(
  db: Database,
  scope: RecordScope,
  promptId: string,
  input: z.infer<typeof promptUpdate>,
): Promise<PromptView> {
  try {
    return await inTransaction(db, (trx) => applyPromptUpdate(trx, scope, promptId, input));
  } catch (error) {
    if (isUniqueViolation(error, UNIQUE_TEXT)) throw new ApiError(409, DUPLICATE);
    throw error;
  }
}

/** The prompt row `FOR UPDATE`, read after its project lock; 404 once it is deleted. */
async function lockedPrompt(db: Kysely<DB>, promptId: string): Promise<PromptRow> {
  const prompt = await db
    .selectFrom('prompts')
    .selectAll()
    .where('id', '=', promptId)
    .forUpdate()
    .executeTakeFirst();
  if (prompt === undefined) throw notFound('Prompt');
  return prompt;
}

/**
 * The edit, under the project lock that topic writers take, so the topic and
 * vocabulary it binds against cannot change before it commits. The prompt is
 * re-read under that lock: a re-file or status change that committed while
 * this edit waited decides what it must bind to.
 */
async function applyPromptUpdate(
  db: Kysely<DB>,
  scope: RecordScope,
  promptId: string,
  input: z.infer<typeof promptUpdate>,
): Promise<PromptView> {
  const { project_id: projectId } = await scopedPrompt(
    db,
    scope.workspaceId,
    promptId,
    scope.projectId,
  );
  await acquireProjectLock(db, projectId);
  const prompt = await lockedPrompt(db, promptId);
  // An explicit null detaches the prompt; an absent key leaves its topic.
  const topicGiven = 'topic_id' in input;
  const topicId = topicGiven ? (input.topic_id ?? null) : prompt.topic_id;
  if (topicGiven && topicId !== null) await topicText(db, projectId, topicId);
  const activates = input.status === P.status_active && prompt.status !== P.status_active;
  // Re-filing an active prompt under another topic changes what it must bind to.
  const refiled =
    topicId !== prompt.topic_id && (input.status ?? prompt.status) === P.status_active;
  if (input.text != null || activates || refiled) {
    await requireBinding(db, projectId, input.text ?? prompt.text, topicId);
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
  scope: RecordScope,
  promptId: string,
): Promise<void> {
  const prompt = await scopedPrompt(db, scope.workspaceId, promptId, scope.projectId);
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
  scope: RecordScope,
  promptSetId: string,
  input: z.infer<typeof promptBulkStatus>,
): Promise<PromptSetView> {
  const ids = [...new Set(input.prompt_ids)];
  await inTransaction(db, async (trx) => {
    const set = await scopedPromptSet(trx, scope.workspaceId, promptSetId, scope.projectId);
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
  return readPromptSet(db, scope.workspaceId, promptSetId);
}

/**
 * Import parsed rows as `imported` prompts, atomically: every non-blank row
 * must bind. Blank rows are skipped and duplicates (in the set, or repeated
 * in the upload) are dropped. A row's topic name reuses a project topic
 * (case-insensitively) or creates one, only for rows that insert.
 */
export async function importPrompts(
  db: Database,
  scope: RecordScope,
  promptSetId: string,
  input: z.infer<typeof promptImport>,
): Promise<PromptSetView> {
  const { workspaceId } = scope;
  await db.transaction().execute(async (trx) => {
    const set = await scopedPromptSet(trx, workspaceId, promptSetId, scope.projectId);
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
    // Topics are created only for rows that insert, so screen duplicates first.
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
    // A refusal from the insert rolls these topics back with it.
    const topics = await resolveTopicsByName(
      trx,
      { workspaceId, projectId: set.project_id },
      [...byHash.values()].map((row) => row.topic),
    );
    const filing = await brandFiling(trx, set.project_id);
    await insertPrompts(
      trx,
      set,
      [...byHash.values()].map((row) => ({
        text: row.text,
        topic_id: topics.get(row.topic.toLowerCase()) ?? null,
        theme: row.theme.trim(),
        intent: normalizeIntent(row.intent),
        buyer_stage: row.buyer_stage,
        persona: row.persona,
        cohort: row.cohort ?? filing(row.text),
        enabled: row.enabled,
      })),
      { origin: 'imported', onDuplicate: 'skip' },
    );
  });
  return readPromptSet(db, workspaceId, promptSetId);
}

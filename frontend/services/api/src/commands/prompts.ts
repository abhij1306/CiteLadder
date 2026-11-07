/**
 * Prompt library commands: the one write path the browser, the public API and
 * MCP share. Each takes an actor checked against its permission, then calls
 * the prompt owners scoped to the caller's project (`RecordScope`): a set,
 * prompt or topic outside it is a 404, so no caller checks project ownership
 * itself.
 */
import type { z } from 'zod';

import { budget, spendBudget } from '../abuse/usage.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import type { RecordScope } from '../db/workspace-scope.ts';
import { ApiError } from '../errors.ts';
import { isNonEmpty } from '../lists.ts';
import * as candidates from '../prompts/candidates.ts';
import type { GenerationInput } from '../prompts/generation-input.ts';
import { generatePrompts } from '../prompts/generation.ts';
import { scopedPromptSet } from '../prompts/prompt-sets.ts';
import * as prompts from '../prompts/prompts.ts';
import * as topicPreview from '../prompts/topic-preview.ts';
import * as topics from '../prompts/topics.ts';
import { permission, type Authorized } from './permission.ts';

/** Changing the library. */
export const PROMPTS_WRITE = permission({ capability: 'write', scope: 'prompts:write' });
/** A metered model call for the library: generation and topic proposals. */
export const PROMPTS_RUN = permission({ capability: 'run', scope: 'prompts:write' });
type Writer = Authorized<typeof PROMPTS_WRITE>;
type Runner = Authorized<typeof PROMPTS_RUN>;

/** The scope the actor's records are found in. */
const scopeOf = (actor: Writer, projectId: string | null): RecordScope => ({
  workspaceId: actor.workspaceId,
  projectId,
});

export function createPrompts(
  db: Database,
  actor: Writer,
  projectId: string | null,
  promptSetId: string,
  inputs: z.infer<typeof prompts.promptInput>[],
) {
  if (!isNonEmpty(inputs)) throw new ApiError(422, 'At least one prompt is required');
  return prompts.createPrompts(db, scopeOf(actor, projectId), promptSetId, inputs);
}

export function createPrompt(
  db: Database,
  actor: Writer,
  projectId: string | null,
  promptSetId: string,
  input: z.infer<typeof prompts.promptInput>,
) {
  return prompts.createPrompt(db, scopeOf(actor, projectId), promptSetId, input);
}

export function updatePrompt(
  db: Database,
  actor: Writer,
  projectId: string | null,
  promptId: string,
  input: z.infer<typeof prompts.promptUpdate>,
) {
  return prompts.updatePrompt(db, scopeOf(actor, projectId), promptId, input);
}

export function deletePrompt(
  db: Database,
  actor: Writer,
  projectId: string | null,
  promptId: string,
) {
  return prompts.deletePrompt(db, scopeOf(actor, projectId), promptId);
}

export function setPromptStatuses(
  db: Database,
  actor: Writer,
  projectId: string | null,
  promptSetId: string,
  input: z.infer<typeof prompts.promptBulkStatus>,
) {
  return prompts.bulkSetStatus(db, scopeOf(actor, projectId), promptSetId, input);
}

/**
 * Import spends the workspace's `bulk_import` window first, then checks the raw
 * byte size, and only then parses the body: a refused, oversized or invalid
 * import still uses its attempt.
 */
export async function importPrompts(
  db: Database,
  actor: Writer,
  projectId: string | null,
  promptSetId: string,
  body: { bytes: number; read: () => Promise<z.infer<typeof prompts.promptImport>> },
) {
  await spendBudget(db, budget('bulk_import', process.env), actor.workspaceId);
  if (body.bytes > policy.prompts.import_max_bytes)
    throw new ApiError(413, 'Import body too large');
  return prompts.importPrompts(db, scopeOf(actor, projectId), promptSetId, await body.read());
}

export function createTopic(
  db: Database,
  actor: Writer,
  projectId: string,
  input: z.infer<typeof topics.topicCreate>,
) {
  return topics.createTopic(db, actor.workspaceId, projectId, input);
}

export function updateTopic(
  db: Database,
  actor: Writer,
  projectId: string | null,
  topicId: string,
  input: z.infer<typeof topics.topicUpdate>,
) {
  return topics.updateTopic(db, scopeOf(actor, projectId), topicId, input);
}

export function deleteTopic(
  db: Database,
  actor: Writer,
  projectId: string | null,
  topicId: string,
) {
  return topics.deleteTopic(db, scopeOf(actor, projectId), topicId);
}

/** The Prompt Builder's reviewed topic plan: deletes, renames and creates at once. */
export function confirmTopics(
  db: Database,
  actor: Writer,
  projectId: string,
  input: z.infer<typeof topics.topicConfirm>,
) {
  return topics.confirmTopics(db, actor.workspaceId, projectId, input);
}

/** Proposing topics makes a metered model call, so it needs the run capability. */
export function previewTopics(db: Database, actor: Runner, projectId: string) {
  return topicPreview.previewTopics(db, actor.workspaceId, projectId);
}

/**
 * A retried run with the same Idempotency-Key replays the staged run without
 * provider I/O. A set's project never changes, so the set is found in the
 * caller's project before generation resolves it again under its locks.
 */
export async function startGeneration(
  db: Database,
  actor: Runner,
  projectId: string | null,
  promptSetId: string,
  input: GenerationInput,
  { idempotencyKey }: { idempotencyKey: string | null },
) {
  const key = idempotencyKey?.trim() ?? '';
  if (key.length > policy.prompts.generation.idempotency_key_max_chars)
    throw new ApiError(422, 'Idempotency-Key is too long', { code: 'generation_invalid' });
  await scopedPromptSet(db, actor.workspaceId, promptSetId, projectId);
  return generatePrompts(db, actor.workspaceId, promptSetId, input, undefined, key || null);
}

export function reviewCandidates(
  db: Database,
  actor: Writer,
  projectId: string | null,
  promptSetId: string,
  input: z.infer<typeof candidates.candidateReview>,
) {
  return candidates.reviewCandidates(db, scopeOf(actor, projectId), promptSetId, input);
}

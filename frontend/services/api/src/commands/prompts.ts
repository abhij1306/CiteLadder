/**
 * Prompt library commands: the one write path the browser and the public API
 * share. Each authorizes the actor, then calls the prompt owners.
 */
import type { z } from 'zod';

import { enforceWorkspaceRequest } from '../abuse/usage.ts';
import { requireCapability, type Actor } from '../auth/actor.ts';
import { policy, resolveSettingSpec } from '../config.ts';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { isNonEmpty } from '../lists.ts';
import * as candidates from '../prompts/candidates.ts';
import type { GenerationInput } from '../prompts/generation-input.ts';
import { generatePrompts } from '../prompts/generation.ts';
import * as prompts from '../prompts/prompts.ts';
import * as topics from '../prompts/topics.ts';

const SCOPE = 'prompts:write';

function authorize(actor: Actor): void {
  requireCapability(actor, 'write', SCOPE);
}

export function createPrompts(
  db: Database,
  actor: Actor,
  promptSetId: string,
  inputs: z.infer<typeof prompts.promptInput>[],
) {
  authorize(actor);
  if (!isNonEmpty(inputs)) throw new ApiError(422, 'At least one prompt is required');
  return prompts.createPrompts(db, actor.workspaceId, promptSetId, inputs);
}

export function createPrompt(
  db: Database,
  actor: Actor,
  promptSetId: string,
  input: z.infer<typeof prompts.promptInput>,
) {
  authorize(actor);
  return prompts.createPrompt(db, actor.workspaceId, promptSetId, input);
}

export function updatePrompt(
  db: Database,
  actor: Actor,
  promptId: string,
  input: z.infer<typeof prompts.promptUpdate>,
) {
  authorize(actor);
  return prompts.updatePrompt(db, actor.workspaceId, promptId, input);
}

export function deletePrompt(db: Database, actor: Actor, promptId: string) {
  authorize(actor);
  return prompts.deletePrompt(db, actor.workspaceId, promptId);
}

export function setPromptStatuses(
  db: Database,
  actor: Actor,
  promptSetId: string,
  input: z.infer<typeof prompts.promptBulkStatus>,
) {
  authorize(actor);
  return prompts.bulkSetStatus(db, actor.workspaceId, promptSetId, input);
}

/**
 * Import spends the workspace's `bulk_import` window first, then checks the raw
 * byte size, and only then parses the body: a refused, oversized or invalid
 * import still uses its attempt.
 */
export async function importPrompts(
  db: Database,
  actor: Actor,
  promptSetId: string,
  body: { bytes: number; read: () => Promise<z.infer<typeof prompts.promptImport>> },
) {
  authorize(actor);
  await enforceWorkspaceRequest(db, actor.workspaceId, {
    operation: 'bulk_import',
    limit: resolveSettingSpec(policy.abuse.bulk_import_limit) as number,
    windowSeconds: resolveSettingSpec(policy.abuse.bulk_import_window_seconds) as number,
  });
  if (body.bytes > policy.prompts.import_max_bytes)
    throw new ApiError(413, 'Import body too large');
  return prompts.importPrompts(db, actor.workspaceId, promptSetId, await body.read());
}

export function createTopic(
  db: Database,
  actor: Actor,
  projectId: string,
  input: z.infer<typeof topics.topicCreate>,
) {
  authorize(actor);
  return topics.createTopic(db, actor.workspaceId, projectId, input);
}

export function updateTopic(
  db: Database,
  actor: Actor,
  topicId: string,
  input: z.infer<typeof topics.topicUpdate>,
) {
  authorize(actor);
  return topics.updateTopic(db, actor.workspaceId, topicId, input);
}

export function deleteTopic(db: Database, actor: Actor, topicId: string) {
  authorize(actor);
  return topics.deleteTopic(db, actor.workspaceId, topicId);
}

/** A retried run with the same Idempotency-Key replays the staged run without provider I/O. */
export function startGeneration(
  db: Database,
  actor: Actor,
  promptSetId: string,
  input: GenerationInput,
  { idempotencyKey }: { idempotencyKey: string | null },
) {
  requireCapability(actor, 'run', SCOPE);
  const key = idempotencyKey?.trim() ?? '';
  if (key.length > policy.prompts.generation.idempotency_key_max_chars)
    throw new ApiError(422, 'Idempotency-Key is too long', { code: 'generation_invalid' });
  return generatePrompts(db, actor.workspaceId, promptSetId, input, undefined, key || null);
}

export function reviewCandidates(
  db: Database,
  actor: Actor,
  promptSetId: string,
  input: z.infer<typeof candidates.candidateReview>,
) {
  authorize(actor);
  return candidates.reviewCandidates(db, actor.workspaceId, promptSetId, input);
}

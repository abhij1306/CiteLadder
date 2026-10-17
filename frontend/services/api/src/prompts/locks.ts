/**
 * The prompt writers' advisory locks, also taken by source-page admission,
 * keyed from the exported lock families.
 *
 * Order: the project lock, then the prompt-set lock; no path takes an
 * earlier lock after a later one. Transaction-scoped, so they release at COMMIT/ROLLBACK.
 */
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { advisoryXactLock } from '../db/advisory-lock.ts';

const { project, prompt_set: promptSet } = policy.prompts.locks;

/** Serialize this project's topic-level, prompt and Opportunity writers. */
export async function acquireProjectLock(db: Database, projectId: string): Promise<void> {
  await advisoryXactLock(db, project, projectId);
}

/** Serialize one prompt set's inserts, deletes and candidate review. */
export async function acquirePromptSetLock(db: Database, promptSetId: string): Promise<void> {
  await advisoryXactLock(db, promptSet, promptSetId);
}

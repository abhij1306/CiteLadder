import { sql } from 'kysely';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { generationInvalid } from './generation-input.ts';

const B = policy.prompts.brand;
const COUNT = sql<string>`count(*)`.as('count');

export async function brandPromptRoom(
  db: Database,
  scope: { workspaceId: string; projectId: string },
): Promise<number> {
  const tracked = await db
    .selectFrom('prompts')
    .innerJoin('prompt_sets', 'prompt_sets.id', 'prompts.prompt_set_id')
    .select(COUNT)
    .where('prompts.workspace_id', '=', scope.workspaceId)
    .where('prompt_sets.project_id', '=', scope.projectId)
    .where('prompts.intent', '=', B.intent)
    .executeTakeFirstOrThrow();
  const pending = await db
    .selectFrom('prompt_candidates')
    .innerJoin('prompt_sets', 'prompt_sets.id', 'prompt_candidates.prompt_set_id')
    .select(COUNT)
    .where('prompt_candidates.workspace_id', '=', scope.workspaceId)
    .where('prompt_sets.project_id', '=', scope.projectId)
    .where('prompt_candidates.intent', '=', B.intent)
    .where('prompt_candidates.disposition', '=', policy.prompts.candidate.pending)
    .where('prompt_candidates.expires_at', '>', new Date())
    .executeTakeFirstOrThrow();
  return Math.max(0, B.max_per_project - Number(tracked.count) - Number(pending.count));
}

export async function requireBrandPromptRoom(
  db: Database,
  scope: { workspaceId: string; projectId: string },
  count: number,
) {
  const room = await brandPromptRoom(db, scope);
  if (count > room)
    throw generationInvalid(
      room
        ? `This project has room for ${room} more brand prompts (at most ${B.max_per_project})`
        : `This project already has the most brand prompts it can track (${B.max_per_project}), counting suggestions waiting for review`,
    );
}

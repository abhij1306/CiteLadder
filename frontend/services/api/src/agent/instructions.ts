import type { Database } from '../db/database.ts';

export async function currentInstructions(
  db: Database,
  scope: { workspaceId: string; projectId: string },
) {
  const row = await db
    .selectFrom('agent_instruction_revisions')
    .select(['revision', 'text', 'created_at'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .orderBy('revision', 'desc')
    .limit(1)
    .executeTakeFirst();
  return {
    revision: row?.revision ?? null,
    text: row?.text ?? '',
    created_at: row?.created_at.toISOString() ?? null,
  };
}

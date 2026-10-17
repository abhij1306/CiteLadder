import type { Database } from '../db/database.ts';
import { buyerPrompts, candidates, commerceMissing, type CommerceScope } from './reads.ts';
import { firstOf } from '../lists.ts';

export function decideCandidate(
  db: Database,
  scope: CommerceScope,
  id: string,
  decision: 'approved' | 'rejected',
) {
  return db.transaction().execute(async (trx) => {
    const candidate = await trx
      .selectFrom('commerce_competitor_candidates')
      .select('id')
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!candidate) commerceMissing('Competitor candidate not found');
    await trx
      .updateTable('commerce_competitor_candidates')
      .set({ state: decision, decision_at: new Date() })
      .where('id', '=', candidate.id)
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .execute();
    return firstOf(await candidates(trx, scope, id), 'the decided competitor candidate');
  });
}

export function decideBuyerPrompt(
  db: Database,
  scope: CommerceScope,
  id: string,
  approved: boolean,
) {
  return db.transaction().execute(async (trx) => {
    // Lock Prompt first, then its Commerce target. Creation uses
    // the same parent-before-child order; generic Prompt writes touch only p.
    const prompt = await trx
      .selectFrom('prompts as p')
      .innerJoin('prompt_sets as ps', 'ps.id', 'p.prompt_set_id')
      .innerJoin('projects as project', 'project.id', 'ps.project_id')
      .select('p.id')
      .where('project.workspace_id', '=', scope.workspaceId)
      .where('project.id', '=', scope.projectId)
      .where('p.id', '=', id)
      .forUpdate('p')
      .executeTakeFirst();
    if (!prompt) commerceMissing('Buyer prompt not found');
    const target = await trx
      .selectFrom('commerce_prompt_targets')
      .select('id')
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('prompt_id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!target) commerceMissing('Buyer prompt not found');
    await trx
      .updateTable('prompts')
      .set({ enabled: approved, updated_at: new Date() })
      .where('id', '=', prompt.id)
      .execute();
    await trx
      .updateTable('commerce_prompt_targets')
      .set({ approved_at: approved ? new Date() : null })
      .where('id', '=', target.id)
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .execute();
    return firstOf(await buyerPrompts(trx, scope, id), 'the decided buyer prompt');
  });
}

import type { Database } from '../db/database.ts';
import { buyerPrompts, candidates, commerceMissing, type CommerceScope } from './reads.ts';
import { firstOf } from '../lists.ts';
import { recordCatalogRevision } from './catalog-revisions.ts';
import { updatePrompt } from '../prompts/prompts.ts';

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
    // Approving or rejecting changes the approved list answers are matched against.
    await recordCatalogRevision(trx, scope, { kind: 'competitor_decision', id: candidate.id });
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
    // The prompt's own writer first (project lock, then the prompt row), then
    // its Commerce target: creation uses the same parent-before-child order.
    const prompt = await trx
      .selectFrom('prompts as p')
      .innerJoin('prompt_sets as ps', 'ps.id', 'p.prompt_set_id')
      .innerJoin('projects as project', 'project.id', 'ps.project_id')
      .innerJoin('commerce_prompt_targets as t', 't.prompt_id', 'p.id')
      .select('p.id')
      .where('project.workspace_id', '=', scope.workspaceId)
      .where('project.id', '=', scope.projectId)
      .where('t.project_id', '=', scope.projectId)
      .where('p.id', '=', id)
      .executeTakeFirst();
    if (!prompt) commerceMissing('Buyer prompt not found');
    await updatePrompt(trx, scope, prompt.id, { enabled: approved });
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
      .updateTable('commerce_prompt_targets')
      .set({ approved_at: approved ? new Date() : null })
      .where('id', '=', target.id)
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .execute();
    return firstOf(await buyerPrompts(trx, scope, id), 'the decided buyer prompt');
  });
}

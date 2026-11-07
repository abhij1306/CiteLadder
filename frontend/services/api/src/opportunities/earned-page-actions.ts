/**
 * The earned Opportunity and Action for each cited page, by url hash: what
 * Visibility reads to offer "get listed" on a page. Opportunities owns how an
 * earned page is keyed, so no reader rebuilds the target key.
 */
import { sql } from 'kysely';
import { earnedTargetKey } from '../analysis/opportunities/targets.ts';
import type { Database } from '../db/database.ts';
import type { Scope } from './sources.ts';

type EarnedPageAction = { opportunity_id: string; action_id: string | null };

/**
 * The page's live earned Opportunity, highest priority first should there be
 * two, and the Action grouping it (null before one does).
 */
export async function earnedPageActions(
  db: Database,
  scope: Scope,
  urlHashes: readonly string[],
): Promise<Map<string, EarnedPageAction>> {
  const found = new Map<string, EarnedPageAction>();
  if (!urlHashes.length) return found;
  const targets = new Map(urlHashes.map((hash) => [earnedTargetKey(hash), hash]));
  const rows = await db
    .selectFrom('opportunities as opportunity')
    .leftJoin('actions as action', (join) =>
      join
        .onRef('action.project_id', '=', 'opportunity.project_id')
        .on('action.workspace_id', '=', scope.workspaceId)
        .on(sql<boolean>`action.member_opportunity_ids @> jsonb_build_array(opportunity.id::text)`),
    )
    .distinctOn('opportunity.target_key')
    .select([
      'opportunity.target_key',
      'opportunity.id as opportunity_id',
      'action.id as action_id',
    ])
    .where('opportunity.workspace_id', '=', scope.workspaceId)
    .where('opportunity.project_id', '=', scope.projectId)
    .where('opportunity.target_key', 'in', [...targets.keys()])
    .where('opportunity.superseded_at', 'is', null)
    .orderBy('opportunity.target_key')
    .orderBy(sql`opportunity.priority_score desc nulls last`)
    .orderBy(sql`action.id is null`)
    .execute();
  for (const row of rows) {
    const hash = targets.get(row.target_key);
    if (hash) found.set(hash, { opportunity_id: row.opportunity_id, action_id: row.action_id });
  }
  return found;
}

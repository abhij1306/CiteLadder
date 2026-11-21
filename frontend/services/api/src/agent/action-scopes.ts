import { z } from 'zod';

import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { ApiError } from '../errors.ts';
import { withoutQuery } from '../mcp/evidence-site.ts';
import { urlActions } from '../opportunities/action-tree.ts';
import { AgentError, type Json, type Scope } from './contracts.ts';

const MAX = policy.opportunity.opportunities.SITE_ISSUE_FAMILY.AGENT_PAGES_MAX;

const refsSchema = z.object({
  action_url_ids: z.array(z.uuid()).min(1).max(MAX).nullish(),
  url_actions_reference: z.object({ site_url_id: z.uuid() }).nullish(),
});

async function selectedUrls(db: Database, scope: Scope, actionId: string, ids: string[]) {
  const rows = await db
    .selectFrom('action_urls')
    .innerJoin('site_urls', (join) =>
      join
        .onRef('site_urls.workspace_id', '=', 'action_urls.workspace_id')
        .onRef('site_urls.id', '=', 'action_urls.site_url_id'),
    )
    .select('site_urls.normalized_url as url')
    .where('action_urls.workspace_id', '=', scope.workspaceId)
    .where('action_urls.project_id', '=', scope.projectId)
    .where('action_urls.action_id', '=', actionId)
    .where('action_urls.site_url_id', 'in', ids)
    .orderBy('site_urls.normalized_url')
    .execute();
  if (rows.length !== new Set(ids).size) throw new AgentError('agent_context_unavailable');
  return rows.map((row) => withoutQuery(row.url));
}

export async function actionScopes(
  db: Database,
  scope: Scope,
  refs: Record<string, Json>,
  actionId: string | null,
): Promise<{ action: Record<string, Json>; sections: Record<string, Json> }> {
  const parsed = refsSchema.safeParse(refs);
  if (!parsed.success) throw new AgentError('agent_context_unavailable');
  const { action_url_ids: ticked, url_actions_reference: one } = parsed.data;
  if (ticked && !actionId) throw new AgentError('agent_context_unavailable');
  const action: Record<string, Json> =
    ticked && actionId ? { selected_urls: await selectedUrls(db, scope, actionId, ticked) } : {};
  if (!one) return { action, sections: {} };
  const found = await urlActions(db, scope, one.site_url_id).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404)
      throw new AgentError('agent_context_unavailable');
    throw error;
  });
  return {
    action,
    sections: {
      url_actions: {
        url: withoutQuery(found.url),
        action_count: found.items.length,
        actions: found.items.slice(0, MAX).map((item) => ({
          id: item.id,
          target_label: item.target_label,
          status: item.status,
          goal: item.goal,
          grouping: item.grouping,
          priority_band: item.priority_band,
        })),
      },
    },
  };
}

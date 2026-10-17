import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import {
  internalLinkAnalysisSchema,
  internalLinkAnalysisStateSchema,
  type InternalLinkAnalysis,
} from '@citeladder/contracts/site-health';

import { dailyWorkspaceLimit, enforceWorkspaceRequest } from '../abuse/usage.ts';
import { policy } from '../config.ts';
import type { Database } from '../db/database.ts';
import { record } from '../db/json.ts';
import { ApiError } from '../errors.ts';
import { enqueueTask } from '../referrals/enqueue.ts';
import { effectiveStatus } from '../opportunities/action-status.ts';
import { linkCandidates, linkRequests } from './internal-link-candidates.ts';
import { loadLinkPages, type LinkScope } from './internal-link-pages.ts';

const { succeeded, failed, cancelled } = policy.task_queue.statuses;
const terminalTaskStatuses = [succeeded, failed, cancelled];

export function latestLinkCrawl(db: Database, scope: LinkScope) {
  return db
    .selectFrom('site_crawls')
    .select('id')
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('completed_at', 'is not', null)
    .orderBy('completed_at', 'desc')
    .executeTakeFirst();
}

/** Attach each suggestion's owning source-page Action, if one exists. */
async function attachActions(db: Database, scope: LinkScope, analysis: InternalLinkAnalysis) {
  if (!analysis.recommendations.length) return;
  const actions = await db
    .selectFrom('actions')
    .select(['id', 'target_url', effectiveStatus().as('status')])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('target_url', 'in', [
      ...new Set(analysis.recommendations.map((link) => link.source.url)),
    ])
    .where('evidence_cleared_at', 'is', null)
    .execute();
  for (const link of analysis.recommendations) {
    const action = actions.find((item) => item.target_url === link.source.url);
    link.action_id = action?.id ?? null;
    link.action_status = action?.status ?? null;
  }
}

export async function linkRun(db: Database, scope: LinkScope, id?: string) {
  let query = db
    .selectFrom('site_internal_link_runs')
    .select(['id', 'crawl_id', 'state', 'created_at', 'result'])
    // Reads never load the frozen pages and requests, only their counts.
    .select(
      sql<unknown>`jsonb_build_object(
      'page_count', manifest->'page_count',
      'omitted_pages', manifest->'omitted_pages'
    )`.as('manifest'),
    )
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId);
  if (id) query = query.where('id', '=', id);
  const row = await query.orderBy('created_at', 'desc').executeTakeFirst();
  if (id && !row) throw new ApiError(404, 'Internal link analysis not found');
  const crawl = await latestLinkCrawl(db, scope);
  const savedRuns = await db
    .selectFrom('site_internal_link_runs')
    .select(['id', 'created_at', 'state'])
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .orderBy('created_at', 'desc')
    .limit(policy.internal_links.history_limit)
    .execute();
  const read = {
    history: savedRuns.map((run) => ({
      ...run,
      state: internalLinkAnalysisStateSchema.parse(run.state),
      created_at: run.created_at.toISOString(),
    })),
    analysis: null as InternalLinkAnalysis | null,
    crawl_id: crawl?.id ?? null,
    availability: crawl ? ('ready' as const) : ('crawl_required' as const),
  };
  if (!row) return read;
  const manifest = record(row.manifest);
  const analysis = internalLinkAnalysisSchema.parse(
    row.result ?? {
      id: row.id,
      crawl_id: row.crawl_id,
      created_at: row.created_at.toISOString(),
      state: row.state,
      page_count: manifest.page_count,
      omitted_pages: manifest.omitted_pages,
      stale: false,
      recommendations: [],
    },
  );
  analysis.stale = crawl?.id !== row.crawl_id;
  await attachActions(db, scope, analysis);
  if (row.state === 'cancelled') analysis.state = 'cancelled';
  return { ...read, analysis };
}

export async function admitLinkRun(
  db: Database,
  scope: LinkScope,
  actorId: string,
  input: { crawl_id: string; idempotency_key: string },
) {
  const id = await db.transaction().execute(async (trx) => {
    // Serialize admission for this project, including concurrent idempotent requests.
    await trx
      .selectFrom('projects')
      .select('id')
      .where('id', '=', scope.projectId)
      .where('workspace_id', '=', scope.workspaceId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const previous = await trx
      .selectFrom('site_internal_link_runs')
      .select(['id', 'crawl_id'])
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('idempotency_key', '=', input.idempotency_key)
      .executeTakeFirst();
    if (previous) {
      if (previous.crawl_id !== input.crawl_id)
        throw new ApiError(409, 'Request key already used for another crawl');
      return previous.id;
    }
    const active = await trx
      .selectFrom('site_internal_link_runs')
      .select('id')
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('state', 'in', ['queued', 'running'])
      .executeTakeFirst();
    if (active) throw new ApiError(409, 'An internal link analysis is already running');
    // A cancelled run's worker can still settle in-flight judgments; the
    // project's slot stays occupied until its judgment task is terminal.
    const settling = await trx
      .selectFrom('analytics_tasks')
      .select('id')
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('task_kind', '=', 'internal_link_judgment')
      .where('status', 'not in', terminalTaskStatuses)
      .executeTakeFirst();
    if (settling) throw new ApiError(409, 'The previous internal link analysis is still stopping');
    // Each run can make many platform-paid judge calls; replays above spend nothing.
    await enforceWorkspaceRequest(
      trx,
      scope.workspaceId,
      dailyWorkspaceLimit('internal_links.analysis', 'internal_link_analyses_per_workspace_daily'),
    );
    const crawl = await trx
      .selectFrom('site_crawls')
      .select('id')
      .where('id', '=', input.crawl_id)
      .where('workspace_id', '=', scope.workspaceId)
      .where('project_id', '=', scope.projectId)
      .where('completed_at', 'is not', null)
      .executeTakeFirst();
    if (!crawl) throw new ApiError(404, 'Completed crawl not found');
    const { pages, omittedPages } = await loadLinkPages(trx, scope, crawl.id);
    if (pages.length < 2) throw new ApiError(409, 'The crawl captured too few pages to link');
    const candidates = linkCandidates(pages);
    const runId = randomUUID();
    await trx
      .insertInto('site_internal_link_runs')
      .values({
        id: runId,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        crawl_id: crawl.id,
        actor_id: actorId,
        idempotency_key: input.idempotency_key,
        state: 'queued',
        policy_version: policy.internal_links.policy_version,
        created_at: new Date(),
        manifest: JSON.stringify({
          pages,
          candidates,
          requests: linkRequests(pages, candidates),
          page_count: pages.length,
          omitted_pages: omittedPages,
          policy: policy.internal_links,
        }),
      })
      .execute();
    await enqueueTask(trx, {
      ...scope,
      kind: 'internal_link_judgment',
      payload: { run_id: runId },
      keyParts: [runId],
      maxAttempts: 2,
    });
    return runId;
  });
  return linkRun(db, scope, id);
}

export async function cancelLinkRun(db: Database, scope: LinkScope, id: string) {
  await db
    .updateTable('site_internal_link_runs')
    .set({ state: 'cancelled' })
    .where('id', '=', id)
    .where('workspace_id', '=', scope.workspaceId)
    .where('project_id', '=', scope.projectId)
    .where('state', 'in', ['queued', 'running'])
    .execute();
  return linkRun(db, scope, id);
}

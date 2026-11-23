import { WorkspaceScope } from '../db/workspace-scope.ts';
import { policy } from '../config.ts';
import { linkRun } from '../site-health/internal-link-runs.ts';
import { currentSiteCrawl } from '../site-health/reads/crawl.ts';
import { issues } from '../site-health/reads/issues.ts';
import { readSchedule } from '../site-health/schedules.ts';
import { mcpPolicy } from './config.ts';
import { pagination, reference, unavailable } from './data.ts';
import { McpInputError, type Evidence, type ProjectRead } from './types.ts';

type Page = { cursor?: string | null; limit?: number | null };

async function issueCrawlId({ db, scope }: ProjectRead, selected: string | null | undefined) {
  if (!selected) return (await currentSiteCrawl(db, scope.workspaceId, scope.projectId))?.id;
  const row = await new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'site_health_snapshots')
    .select('crawl_id')
    .where('project_id', '=', scope.projectId)
    .where((eb) => eb.or([eb('id', '=', selected), eb('crawl_id', '=', selected)]))
    .executeTakeFirst();
  if (!row) throw new McpInputError('Selected snapshot is unavailable');
  return row.crawl_id;
}

export async function siteIssueGroups(
  read: ProjectRead,
  args: Page & { snapshot_id?: string | null },
): Promise<Evidence> {
  const crawlId = await issueCrawlId(read, args.snapshot_id);
  if (!crawlId) return unavailable('no_site_crawl');
  const page = await issues(
    read.db,
    read.scope.workspaceId,
    crawlId,
    {
      query: null,
      severity: null,
      category: null,
      dimension: null,
      rule: null,
      siteUrlId: null,
      pageKind: null,
    },
    {
      cursor: args.cursor ?? null,
      limit: Math.min(
        args.limit ?? mcpPolicy.default_list_limit,
        policy.site_health.reads.page_max_limit,
      ),
    },
  );
  const items = page.items.map(
    ({ crawl_id: _crawl, analyzer_version: _analyzer, rule_version: _rule, ...item }) => item,
  );
  return {
    state: 'available',
    view: 'issues',
    crawl_id: crawlId,
    items,
    summary: page.summary,
    pagination: pagination(items, page.next_cursor),
    artifact_refs: [reference('site_crawl', crawlId)],
  };
}

export async function crawlSchedule({ db, scope }: ProjectRead): Promise<Evidence> {
  return {
    state: 'available',
    view: 'schedule',
    schedule: await readSchedule(db, scope.workspaceId, scope.projectId),
  };
}

export async function linkAnalyses({ db, scope }: ProjectRead): Promise<Evidence> {
  const read = await linkRun(db, scope);
  if (!read.history.length) return { ...unavailable('no_link_analysis'), crawl_id: read.crawl_id };
  const latest = read.analysis;
  return {
    state: 'available',
    view: 'analyses',
    crawl_id: read.crawl_id,
    latest: latest && {
      id: latest.id,
      crawl_id: latest.crawl_id,
      state: latest.state,
      created_at: latest.created_at,
      stale: latest.stale,
      recommendation_count: latest.recommendations.length,
    },
    history: read.history,
  };
}

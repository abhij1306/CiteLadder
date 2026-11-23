import { policy } from '../config.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { issueHistory } from '../site-health/reads/issue-history.ts';
import {
  aeoReadiness,
  architecture,
  changes,
  changesSummary,
} from '../site-health/reads/projections.ts';
import { robotsHistory } from '../site-health/reads/robots-history.ts';
import { mcpPolicy } from './config.ts';
import { cursorOffset, offsetPage, pagination, reference, unavailable } from './data.ts';
import { selectCrawl, withoutQuery, withoutQueryDeep } from './evidence-site.ts';
import { McpInputError, type Evidence, type ProjectRead } from './types.ts';

type Page = { cursor?: string | null; limit?: number | null };
const LATEST_PAIR = { a: null, b: null };
const changeLimits = policy.site_health.change_intel;

async function snapshotCrawl({ db, scope }: ProjectRead, snapshotId: string | null | undefined) {
  if (!snapshotId) return null;
  const row = await new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'site_health_snapshots')
    .select('crawl_id')
    .where('project_id', '=', scope.projectId)
    .where((eb) => eb.or([eb('id', '=', snapshotId), eb('crawl_id', '=', snapshotId)]))
    .executeTakeFirst();
  if (!row) throw new McpInputError('Selected snapshot is unavailable');
  return row.crawl_id;
}

export async function siteChanges(read: ProjectRead): Promise<Evidence> {
  const { state, ...summary } = await changesSummary(
    read.db,
    read.scope.workspaceId,
    read.scope.projectId,
    LATEST_PAIR,
  );
  if (state !== changeLimits.state_available || !summary.snapshot_id)
    return { ...unavailable(summary.reason_code ?? state), change_state: state, ...summary };
  return {
    state: 'available',
    view: 'changes',
    ...summary,
    artifact_refs: [summary.crawl_a_id, summary.crawl_b_id].flatMap((id) =>
      id ? [reference('site_crawl', id)] : [],
    ),
  };
}

export async function siteChangeList(read: ProjectRead, args: Page): Promise<Evidence> {
  const { state, items, next_cursor, summary, coverage, ...rest } = await changes(
    read.db,
    read.scope.workspaceId,
    read.scope.projectId,
    LATEST_PAIR,
    {
      limit: Math.min(args.limit ?? changeLimits.default_limit, changeLimits.max_limit),
      cursor: args.cursor ?? null,
    },
  );
  if (state !== changeLimits.state_available || !rest.snapshot_id)
    return { ...unavailable(rest.reason_code ?? state), change_state: state };
  const rows = items.map(({ normalized_url, ...item }) => ({
    ...item,
    url: withoutQuery(normalized_url),
  }));
  return {
    state: 'available',
    view: 'change_list',
    snapshot_id: rest.snapshot_id,
    crawl_a_id: rest.crawl_a_id,
    crawl_b_id: rest.crawl_b_id,
    complete_pair: rest.complete_pair,
    limitations: rest.limitations,
    items: rows,
    pagination: pagination(rows, next_cursor),
    artifact_refs: [],
  };
}

export async function aeoReadinessView(
  read: ProjectRead,
  args: { snapshot_id?: string | null },
): Promise<Evidence> {
  const crawlId = await snapshotCrawl(read, args.snapshot_id);
  const readiness = await aeoReadiness(
    read.db,
    read.scope.workspaceId,
    read.scope.projectId,
    crawlId,
  );
  const { state, ...rest } = readiness;
  if (state === 'not_measured')
    return {
      ...unavailable('not_measured'),
      crawl_id: rest.crawl_id,
      limitations: rest.limitations,
    };
  return {
    state: 'available',
    view: 'aeo_readiness',
    readiness_state: state,
    ...rest,
    dimensions: withoutQueryDeep(rest.dimensions),
    artifact_refs: rest.crawl_id ? [reference('site_crawl', rest.crawl_id)] : [],
  };
}

export async function architectureView(
  read: ProjectRead,
  args: Page & { snapshot_id?: string | null },
): Promise<Evidence> {
  const crawlId = await snapshotCrawl(read, args.snapshot_id);
  const model = await architecture(read.db, read.scope.workspaceId, read.scope.projectId, crawlId);
  const { state, nodes, internal_linking, ...rest } = model;
  if (state !== 'available' || !rest.crawl_id)
    return {
      ...unavailable('no_observed_architecture'),
      crawl_id: rest.crawl_id,
      limitations: rest.limitations,
    };
  const key = ['architecture', rest.crawl_id];
  const page = offsetPage(nodes, {
    offset: cursorOffset(args.cursor, key),
    limit: args.limit ?? mcpPolicy.default_list_limit,
    selection: key,
  });
  return {
    state: 'available',
    view: 'architecture',
    ...rest,
    internal_linking: withoutQueryDeep(internal_linking),
    nodes: page.items.map((node) => ({ ...node, url: withoutQuery(node.url) })),
    pagination: { ...page.pagination, total_count: nodes.length },
    artifact_refs: [reference('site_crawl', rest.crawl_id)],
  };
}

export async function robotsHistoryView(read: ProjectRead, args: Page): Promise<Evidence> {
  const reads = policy.site_health.reads;
  const page = await robotsHistory(read.db, read.scope.workspaceId, read.scope.projectId, {
    limit: Math.min(
      args.limit ?? reads.robots_history_default_limit,
      reads.robots_history_max_limit,
    ),
    cursor: args.cursor ?? null,
  });
  if (!page.items.length && !args.cursor) return unavailable('robots_not_observed');
  return {
    state: 'available',
    view: 'history',
    items: withoutQueryDeep(page.items),
    snapshots: page.snapshots.map((snapshot) => ({
      ...snapshot,
      origin: withoutQuery(snapshot.origin),
    })),
    pagination: pagination(page.items, page.next_cursor),
    artifact_refs: page.items.map((item) => reference('site_crawl', item.crawl_id)),
  };
}

export async function pageIssueHistory(
  read: ProjectRead,
  args: Page & { crawl_id?: string | null; site_url_id?: string | null },
): Promise<Evidence> {
  if (!args.site_url_id) throw new McpInputError('view issue_history needs site_url_id');
  const crawl = await selectCrawl(read, args.crawl_id);
  if (!crawl) return unavailable('no_site_crawl');
  const page = await issueHistory(read.db, read.scope.workspaceId, crawl.id, args.site_url_id, {
    limit: args.limit ?? mcpPolicy.default_list_limit,
    cursor: args.cursor ?? null,
  });
  if (!page.current_analysis_finalized)
    return { ...unavailable('analysis_not_finalized'), crawl_id: crawl.id };
  return {
    state: 'available',
    view: 'issue_history',
    crawl_id: crawl.id,
    site_url_id: args.site_url_id,
    items: page.items,
    pagination: pagination(page.items, page.next_cursor),
    artifact_refs: [reference('site_crawl', crawl.id)],
  };
}

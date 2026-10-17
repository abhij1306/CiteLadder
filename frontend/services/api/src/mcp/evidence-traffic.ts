/** Search, analytics and AI-traffic reads over their persisted owners. */
import { policy } from '../config.ts';
import { crawlLogs } from '../config/crawl-logs.ts';
import {
  activityPage,
  coveragePage,
  crawlerPage,
  crawlSummary,
  type CrawlReadOptions,
} from '../crawl-logs/reads.ts';
import { insightsRead } from '../crawl-logs/insights.ts';
import { pagesRead, urlRead } from '../crawl-logs/pages.ts';
import { readAiReferrals } from '../analytics/ai-referrals.ts';
import { queryEvidencePage } from '../demand/reads.ts';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { ApiError } from '../errors.ts';
import { readProjectReadiness } from '../integrations/readiness.ts';
import { getPerformance, getPerformanceTable } from '../traffic/performance.ts';
import { canonicalPage } from '../traffic/normalization.ts';
import { pathIdentity } from '../crawl-logs/identity.ts';
import { mcpPolicy } from './config.ts';
import { pagination, reference, unavailable } from './data.ts';
import { McpInputError, type Evidence, type ProjectRead } from './types.ts';

type Window = { range?: string | null; start_date?: string | null; end_date?: string | null };

export async function performanceRead(
  { db, scope }: ProjectRead,
  args: Window & {
    granularity?: string | null;
    compare?: string | null;
    compare_start_date?: string | null;
    compare_end_date?: string | null;
    dimension?: string | null;
    sort?: string | null;
    cursor?: string | null;
    limit?: number | null;
  },
): Promise<Evidence> {
  const dashboard = await getPerformance(db, {
    ...scope,
    range: args.range ?? null,
    from: args.start_date ?? null,
    to: args.end_date ?? null,
    compare: args.compare ?? null,
    compare_from: args.compare_start_date ?? null,
    compare_to: args.compare_end_date ?? null,
    granularity: args.granularity ?? null,
  });
  const snapshotId = dashboard.selected.snapshot_id;
  const versions = {
    formula: dashboard.formula_version,
    normalization: dashboard.normalization_version,
  };
  if (!snapshotId) {
    // Nothing connected is its own state, not a range that has yet to be projected.
    const { stage } = await readProjectReadiness(db, scope);
    return {
      ...unavailable(
        stage === 'not_connected' ? 'not_connected' : 'performance_range_not_projected',
      ),
      readiness_stage: stage,
    };
  }
  const refs = [
    reference('traffic_snapshot', snapshotId),
    ...(dashboard.comparison?.snapshot_id
      ? [reference('traffic_snapshot', dashboard.comparison.snapshot_id)]
      : []),
  ];
  if (args.dimension) {
    const page = await getPerformanceTable(db, {
      ...scope,
      snapshot_id: snapshotId,
      dimension: args.dimension,
      sort: args.sort ?? null,
      cursor: args.cursor ?? null,
      page_size: args.limit ?? null,
      compare_snapshot_id: dashboard.comparison?.snapshot_id ?? null,
    });
    return {
      state: 'available',
      range: dashboard.range,
      selected: dashboard.selected,
      versions,
      ...page,
      artifact_refs: refs,
    };
  }
  return {
    state: 'available',
    range: dashboard.range,
    granularity: dashboard.granularity,
    compare: dashboard.compare,
    selected: dashboard.selected,
    comparison: dashboard.comparison,
    coverage: dashboard.coverage,
    dimension_counts: dashboard.dimension_counts,
    unavailable_dimensions: dashboard.unavailable_dimensions,
    versions,
    artifact_refs: refs,
  };
}

export async function queryEvidence(
  { db, scope }: ProjectRead,
  args: {
    window_start: string;
    window_end: string;
    query?: string | null;
    site_url_id?: string | null;
    resolution_outcome?: string | null;
    cursor?: string | null;
    limit?: number | null;
  },
): Promise<Evidence> {
  if (args.window_end < args.window_start)
    throw new McpInputError('window_end must not precede window_start');
  try {
    const page = await queryEvidencePage(
      db,
      { ...scope, windowStart: args.window_start, windowEnd: args.window_end },
      {
        limit: args.limit ?? mcpPolicy.default_list_limit,
        cursor: args.cursor ?? null,
        query: args.query ?? null,
        site_url_id: args.site_url_id ?? null,
        resolution_outcome: args.resolution_outcome ?? null,
      },
    );
    const items = page.items.map(({ normalized_query, ...row }) => ({
      ...row,
      query: normalized_query,
      record_uri: `citeladder://query_row/${row.id}`,
    }));
    return {
      state: page.snapshot.state,
      snapshot: page.snapshot,
      unsupported_dimensions: ['country', 'device', 'search_type'],
      items,
      pagination: pagination(items, page.next_cursor),
      artifact_refs: [reference('query_snapshot', page.snapshot.id)],
    };
  } catch (error) {
    // The owner's 404 is "this exact window was never projected", not a failure.
    if (error instanceof ApiError && error.status === 404)
      return {
        ...unavailable('exact_query_evidence_window_not_projected'),
        window: { start: args.window_start, end: args.window_end },
      };
    throw error;
  }
}

export async function referrals({ db, scope }: ProjectRead, args: Window): Promise<Evidence> {
  const projection = await readAiReferrals(db, {
    ...scope,
    fromDate: args.start_date ?? null,
    toDate: args.end_date ?? null,
    rangeToken: args.range ?? null,
    granularity: policy.analytics.default_granularity,
  });
  if (!projection.snapshotId) return unavailable('no_ai_referrals_snapshot');
  const result = projection.response;
  return {
    state: 'available',
    window: { start: result.window_start, end: result.window_end },
    granularity: result.granularity,
    referral_volume: result.referral_volume,
    referral_share: result.referral_share,
    sources: result.sources,
    scope: result.scope,
    reporting_timezone: result.reporting_timezone,
    currency_code: result.currency_code,
    source_measures: result.source_measures,
    landing_pages: result.landing_pages,
    analytics_quality: result.analytics_quality,
    channel_comparison: result.channel_comparison,
    unattributed_landing: result.unattributed_landing,
    snapshot_id: projection.snapshotId,
    versions: { analyzer: result.analyzer_version, formula: result.formula_version },
  };
}

type CrawlArgs = Window & {
  verification?: string | null;
  bot_id?: string | null;
  status?: number | null;
  folder?: string | null;
  resource_class?: string | null;
  sort?: string | null;
  cursor?: string | null;
  limit?: number | null;
};
const crawlOptions = (args: CrawlArgs): CrawlReadOptions & { sort: string | null } => ({
  range: args.range ?? null,
  start_date: args.start_date ?? null,
  end_date: args.end_date ?? null,
  verification: args.verification ?? null,
  bot_id: args.bot_id ?? null,
  status: args.status ?? null,
  folder: args.folder ?? null,
  resource_class: args.resource_class ?? null,
  sort: args.sort ?? null,
  cursor: args.cursor ?? null,
  limit: args.limit ?? crawlLogs.default_page_size,
});

export async function crawlLogsRead(
  { db, scope }: ProjectRead,
  args: CrawlArgs & { view: 'summary' | 'crawlers' | 'coverage' | 'requests' },
): Promise<Evidence> {
  const options = crawlOptions(args);
  const reader = {
    summary: crawlSummary,
    crawlers: crawlerPage,
    coverage: coveragePage,
    requests: activityPage,
  }[args.view];
  return { state: 'available', ...(await reader(db, scope, options)) };
}

export async function aiTrafficPages(
  { db, scope }: ProjectRead,
  args: CrawlArgs,
): Promise<Evidence> {
  return { state: 'available', ...(await pagesRead(db, scope, crawlOptions(args))) };
}

export async function aiTrafficInsights(
  { db, scope }: ProjectRead,
  args: Window,
): Promise<Evidence> {
  const result = await insightsRead(db, scope, crawlOptions(args));
  return { state: result.snapshot_id ? 'available' : 'unavailable', ...result };
}

export async function aiTrafficUrl(
  { db, scope }: ProjectRead,
  args: Window & { url: string },
): Promise<Evidence> {
  const project = await new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'projects')
    .select('website_url')
    .where('id', '=', scope.projectId)
    .executeTakeFirstOrThrow();
  const canonical = canonicalPage(args.url, project.website_url);
  if (!canonical || new URL(canonical).origin !== new URL(project.website_url).origin)
    throw new McpInputError('URL must be on the project origin');
  // The ingestion owner's identity: a redacted secret path never joins.
  const identity = pathIdentity(args.url, project.website_url);
  if (!identity?.url_hash) return unavailable('url_not_joinable');
  const result = await urlRead(db, scope, identity.url_hash, crawlOptions(args));
  return { state: result.page ? 'available' : 'unavailable', ...result };
}

/** Site Health reads over persisted snapshots, crawl pages, links and robots facts. */
import { robotsFactsSchema } from '@citeladder/contracts/site-health';
import { sql } from 'kysely';
import { z } from 'zod';
import { WorkspaceScope } from '../db/workspace-scope.ts';
import { record } from '../db/json.ts';
import { parseUuid } from '../http/uuid.ts';
import { rootFailure } from '../site-health/reads/crawl.ts';
import { currentIssueRules, pageRows } from '../site-health/reads/page-rows.ts';
import { isKnownRule } from '../site-health/reads/rules.ts';
import { policy } from '../config.ts';

const FORMULA_VERSION = policy.site_health.link_metrics.formula_version;
import { compareText } from '../text-order.ts';
import { mcpPolicy } from './config.ts';
import { appLink } from './links.ts';
import { decodeCursor, encodeCursor, pagination, reference, unavailable } from './data.ts';
import { McpInputError, type Evidence, type ProjectRead } from './types.ts';
import { isNonEmpty, lastOf } from '../lists.ts';

type Page = { cursor?: string | null; limit?: number | null };

export async function siteSnapshot(
  { db, scope, origin }: ProjectRead,
  args: { snapshot_id?: string | null },
): Promise<Evidence> {
  let query = new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'site_health_snapshots')
    .selectAll()
    .where('project_id', '=', scope.projectId);
  if (args.snapshot_id) query = query.where('id', '=', args.snapshot_id);
  const row = await query.orderBy('created_at', 'desc').orderBy('id', 'desc').executeTakeFirst();
  if (args.snapshot_id && !row) throw new McpInputError('Selected snapshot is unavailable');
  if (!row) return unavailable('no_site_snapshot');
  return {
    state: 'available',
    snapshot_id: row.id,
    crawl_id: row.crawl_id,
    observed_at: row.created_at,
    scores: {
      web_fundamentals: row.web_fundamentals_score,
      aeo_readiness: row.aeo_readiness_score,
      aeo_measurement_coverage: row.aeo_measurement_coverage,
    },
    coverage: { selected_urls: row.selected_url_count, analyzed_urls: row.analyzed_url_count },
    measurement_states: {
      coverage: row.coverage_state,
      web_fundamentals: row.web_fundamentals_state,
      aeo: row.aeo_measurement_state,
      classification: row.classification_state,
    },
    top_issues: row.top_issues,
    versions: {
      analyzer: row.analyzer_version,
      scoring: row.scoring_version,
      profile: row.profile_version,
      presentation: row.presentation_version,
      schema_contract: row.schema_contract_version,
      coverage_formula: row.coverage_formula_version,
      classification_formula: row.classification_formula_version,
    },
    link: appLink(origin, '/site', scope.projectId),
    artifact_refs: [reference('site_snapshot', row.id), reference('site_crawl', row.crawl_id)],
  };
}

/** The selected crawl, or the latest; an explicit crawl from elsewhere is refused. */
async function selectCrawl({ db, scope }: ProjectRead, crawlId: string | null | undefined) {
  let query = new WorkspaceScope(scope.workspaceId)
    .selectFrom(db, 'site_crawls')
    .selectAll()
    .where('project_id', '=', scope.projectId);
  if (crawlId) query = query.where('id', '=', crawlId);
  const crawl = await query.orderBy('created_at', 'desc').orderBy('id', 'desc').executeTakeFirst();
  if (crawlId && !crawl) throw new McpInputError('Crawl was not found in this project');
  return crawl;
}

export async function crawlability(
  read: ProjectRead,
  args: { crawl_id?: string | null },
): Promise<Evidence> {
  const crawl = await selectCrawl(read, args.crawl_id);
  if (!crawl) return unavailable('no_site_crawl');
  const parsed = robotsFactsSchema.safeParse(record(crawl.site_facts).robots);
  const identity = {
    crawl_id: crawl.id,
    crawl_status: crawl.status,
    crawl_created_at: crawl.created_at,
  };
  if (!parsed.success) return { ...unavailable('robots_not_observed'), ...identity };
  return {
    state: 'available',
    ...identity,
    ...parsed.data,
    artifact_refs: [reference('site_crawl', crawl.id)],
  };
}

/** A sampled link neighbor as the model reads it: the page, not its internal id. */
const neighborSchema = z.object({
  url: z.string(),
  anchor_count: z.number().nullish(),
  main_content: z.boolean().nullish(),
  nofollow: z.boolean().nullish(),
});
const neighborList = z.array(z.unknown()).catch([]);
const neighbors = (value: unknown) =>
  neighborList.parse(value).flatMap((item) => {
    const parsed = neighborSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });

export async function siteLinks(
  read: ProjectRead,
  args: Page & { crawl_id?: string | null; site_url_ids?: string[] | null },
): Promise<Evidence> {
  const crawl = await selectCrawl(read, args.crawl_id);
  if (!crawl) return unavailable('no_site_crawl');
  const count = args.limit ?? mcpPolicy.default_list_limit;
  const pages = [...new Set(args.site_url_ids ?? [])].sort(compareText);
  const filterKey = JSON.stringify([crawl.id, pages]);
  let links = new WorkspaceScope(read.scope.workspaceId)
    .selectFrom(read.db, 'site_page_link_metrics')
    .innerJoin('site_urls as u', (join) =>
      join
        .onRef('u.id', '=', 'site_page_link_metrics.site_url_id')
        .onRef('u.workspace_id', '=', 'site_page_link_metrics.workspace_id'),
    )
    .selectAll('site_page_link_metrics')
    .select(sql<string>`coalesce(nullif(u.display_url, ''), u.normalized_url)`.as('url'))
    .where('site_page_link_metrics.project_id', '=', read.scope.projectId)
    .where('site_page_link_metrics.crawl_id', '=', crawl.id)
    // The crawl's current metrics only, as the page read selects them.
    .where('site_page_link_metrics.extractor_version', '=', crawl.extractor_version)
    .where('site_page_link_metrics.formula_version', '=', FORMULA_VERSION);
  if (pages.length) links = links.where('site_page_link_metrics.site_url_id', 'in', pages);
  if (args.cursor) {
    const [key, id] = decodeCursor(args.cursor, 2);
    if (key !== filterKey || !parseUuid(id)) throw new McpInputError('cursor is invalid');
    links = links.where('site_page_link_metrics.id', '>', id!);
  }
  const rows = await links
    .orderBy('site_page_link_metrics.id')
    .limit(count + 1)
    .execute();
  const selected = rows.slice(0, count);
  const found = new Set(rows.map((row) => row.site_url_id));
  const items = selected.map((row) => ({
    site_url_id: row.site_url_id,
    url: row.url,
    inbound_count: row.inbound_count,
    outbound_count: row.outbound_count,
    main_content_inbound_count: row.main_content_inbound_count,
    main_content_outbound_count: row.main_content_outbound_count,
    nofollow_inbound_count: row.nofollow_inbound_count,
    depth_from_home: row.depth_from_home,
    source_page_count: row.source_page_count,
    top_inbound: neighbors(row.top_inbound),
    top_outbound: neighbors(row.top_outbound),
    anchor_diagnostics: row.anchor_diagnostics ?? [],
  }));
  return {
    state: 'available',
    crawl_id: crawl.id,
    versions: { extractor: crawl.extractor_version, formula: FORMULA_VERSION },
    items,
    // A requested page without link metrics in this crawl is named, never dropped silently.
    ...(pages.length && !args.cursor && rows.length <= count
      ? { missing_site_url_ids: pages.filter((id) => !found.has(id)) }
      : {}),
    pagination: pagination(
      items,
      rows.length > count && isNonEmpty(selected)
        ? encodeCursor(filterKey, lastOf(selected).id)
        : null,
    ),
    limitations: ['Link counts are aggregates; neighbors are a bounded sample.'],
    artifact_refs: [reference('site_crawl', crawl.id)],
  };
}

export async function sitePages(
  read: ProjectRead,
  args: Page & {
    crawl_id?: string | null;
    page_kind?: string | null;
    status?: string | null;
    rule_id?: string | null;
  },
): Promise<Evidence> {
  // The rule a page filter names must be a catalog rule, so a typo is not "no pages".
  if (args.rule_id && !isKnownRule(args.rule_id))
    throw new McpInputError(
      `Unknown rule_id '${args.rule_id}'. Use a rule_id exactly as read_site_health top_issues or an issue group returned it.`,
    );
  const crawl = await selectCrawl(read, args.crawl_id);
  if (!crawl)
    return { ...unavailable('no_site_crawl'), items: [], pagination: pagination([], null) };
  const count = args.limit ?? mcpPolicy.default_list_limit;
  const filterKey = JSON.stringify([
    crawl.id,
    args.page_kind ?? null,
    args.status ?? null,
    args.rule_id ?? null,
  ]);
  let after: { value: string; id: string } | null = null;
  if (args.cursor) {
    const [fingerprint, url, id] = decodeCursor(args.cursor, 3);
    if (fingerprint !== filterKey || !url || !parseUuid(id))
      throw new McpInputError('cursor is invalid');
    after = { value: url, id: id! };
  }
  const [rows, root] = await Promise.all([
    pageRows(read.db, crawl, {
      filters: {
        pageKind: args.page_kind ?? null,
        status: args.status ?? null,
        rule: args.rule_id ?? null,
      },
      sort: 'url',
      limit: count,
      after,
    }),
    rootFailure(read.db, crawl),
  ]);
  const selected = rows.slice(0, count);
  const rules = await currentIssueRules(
    read.db,
    crawl,
    selected.flatMap((row) => (row.analysis_id ? [row.analysis_id] : [])),
  );
  // Compact rows: the next read's ids, the page, its states and failing rules.
  const items = selected.map((row) => ({
    site_url_id: row.site_url_id,
    url: row.display_url,
    title: row.title,
    page_kind: row.page_kind,
    status: row.analysis_status,
    ...(row.error_code ? { error_code: row.error_code } : {}),
    web_fundamentals_score: row.web_fundamentals_score,
    aeo_readiness_score: row.aeo_readiness_score,
    // A score without a measured state is no score, never zero.
    ...(row.web_fundamentals_state === 'measured'
      ? {}
      : { web_fundamentals_state: row.web_fundamentals_state }),
    ...(row.aeo_measurement_state === 'measured'
      ? {}
      : { aeo_measurement_state: row.aeo_measurement_state }),
    issue_count: row.issue_count,
    issue_rules: (row.analysis_id && rules.get(row.analysis_id)) || {},
    inbound_count: row.inbound_count,
    depth_from_home: row.depth_from_home,
    record_uri: row.analysis_id ? `citeladder://site_page/${row.analysis_id}` : null,
  }));
  const last = selected.at(-1);
  return {
    state: 'available',
    link: appLink(read.origin, '/site', read.scope.projectId),
    crawl: {
      id: crawl.id,
      status: crawl.status,
      created_at: crawl.created_at,
      completed_at: crawl.completed_at,
    },
    coverage: {
      admitted_urls: crawl.admitted_url_count,
      analyzed_urls: crawl.analyzed_url_count,
      failed_urls: crawl.failed_url_count,
      inventory_complete: crawl.inventory_complete,
      root_errors: root.errors,
    },
    items,
    pagination: pagination(
      items,
      rows.length > count && last
        ? encodeCursor(filterKey, last.normalized_url, last.site_url_id)
        : null,
    ),
    artifact_refs: [
      reference('site_crawl', crawl.id),
      ...selected.flatMap((row) =>
        row.analysis_id ? [reference('site_page', row.analysis_id)] : [],
      ),
    ],
  };
}

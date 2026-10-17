/** Crawl inventory, analyzed pages and one page's persisted detail. */
import {
  inventoryPageSchema,
  pageDetailSchema,
  pagesPageSchema,
} from '@citeladder/contracts/site-health';
import { sql } from 'kysely';

import { policy } from '../../config.ts';
import type { Database } from '../../db/database.ts';
import { record, strings } from '../../db/json.ts';
import { WorkspaceScope } from '../../db/workspace-scope.ts';
import { notFound } from '../../errors.ts';
import { loadCrawl, rootFailure, type Crawl } from './crawl.ts';
import {
  currentIssueFilter,
  linkedFrom,
  measurementFields,
  pageCursor,
  pageRows,
  pageWindow,
  type PageRow,
  type PageRowFilters,
  type PageSort,
  type Referrer,
} from './page-rows.ts';
import { issueOccurrence, ruleTitle, severityOrder, type IssueRow } from './rules.ts';
import { hash } from '../../traffic/normalization.ts';

type Paging = { limit: number; cursor: string | null };
// A pathological artifact never balloons a detail response.
const MAX_EVALUATIONS = policy.site_health.reads.max_detail_evaluations;

const pageSummary = (row: PageRow, referrers: Map<string, Referrer[]>) => ({
  site_url_id: row.site_url_id,
  crawl_id: row.crawl_id,
  normalized_url: row.normalized_url,
  display_url: row.display_url,
  title: row.title,
  monitored: row.monitored,
  analysis_status: row.analysis_status,
  error_code: row.error_code,
  linked_from: referrers.get(row.site_url_id) ?? [],
  ...measurementFields(row),
  inbound_count: row.inbound_count,
  main_content_inbound_count: row.main_content_inbound_count,
  depth_from_home: row.depth_from_home,
});

const inventoryRow = (row: PageRow) => ({
  site_url_id: row.site_url_id,
  normalized_url: row.normalized_url,
  display_url: row.display_url,
  title: row.title,
  content_type: row.content_type,
  source: row.source,
  depth: row.depth,
  monitored: row.monitored,
  first_seen_at: row.first_seen_at?.toISOString() ?? null,
  last_seen_at: row.last_seen_at?.toISOString() ?? null,
  ...measurementFields(row),
});

async function window(
  db: Database,
  crawl: Crawl,
  scope: string,
  filters: PageRowFilters,
  sort: PageSort,
  paging: Paging,
) {
  // The fingerprint binds a cursor to the endpoint, its filters and its order.
  const fingerprint = {
    crawl_id: crawl.id,
    status: filters.status ?? null,
    monitored: filters.monitored ?? null,
    page_kind: filters.pageKind ?? null,
    query: filters.query?.trim().toLowerCase() || null,
    sort,
  };
  const rows = await pageRows(db, crawl, {
    filters,
    sort,
    limit: paging.limit,
    after: pageCursor(paging.cursor, scope, fingerprint, sort),
  });
  return pageWindow(rows, paging.limit, scope, fingerprint);
}

export async function inventory(
  db: Database,
  workspaceId: string,
  crawlId: string,
  filters: PageRowFilters,
  paging: Paging,
) {
  const crawl = await loadCrawl(db, workspaceId, crawlId);
  const { items, next } = await window(db, crawl, 'inventory', filters, 'url', paging);
  return inventoryPageSchema.parse({ items: items.map(inventoryRow), next_cursor: next });
}

export async function pages(
  db: Database,
  workspaceId: string,
  crawlId: string,
  filters: PageRowFilters,
  sort: PageSort,
  paging: Paging,
) {
  const crawl = await loadCrawl(db, workspaceId, crawlId);
  // A failed root fetch never became a page row, so its calls ride alongside.
  const [{ items, next, referrers }, root] = await Promise.all([
    window(db, crawl, 'pages', filters, sort, paging).then(async (page) => ({
      ...page,
      referrers: await linkedFrom(
        db,
        crawl,
        page.items.map((row) => row.site_url_id),
      ),
    })),
    rootFailure(db, crawl),
  ]);
  return pagesPageSchema.parse({
    items: items.map((row) => pageSummary(row, referrers)),
    next_cursor: next,
    root_errors: root.errors,
  });
}

/** Whether the URL was admitted to this crawl itself (inherited inventory has no detail here). */
export async function requireAdmitted(db: Database, crawl: Crawl, siteUrlId: string) {
  const observed = await new WorkspaceScope(crawl.workspace_id)
    .selectFrom(db, 'site_url_observations')
    .select('id')
    .where('crawl_id', '=', crawl.id)
    .where('site_url_id', '=', siteUrlId)
    .executeTakeFirst();
  if (observed === undefined) throw notFound('Site URL');
}

function pageFacts(facts: Record<string, unknown>) {
  const headings = record(facts.headings);
  const anchors = Array.isArray(record(facts.links).anchors)
    ? (record(facts.links).anchors as unknown[]).map(record)
    : [];
  const internal = anchors.filter((anchor) => anchor.is_internal === true).length;
  const robots = record(facts.robots);
  const int = (value: unknown) => (typeof value === 'number' ? Math.trunc(value) : 0);
  const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : null);
  return {
    title: text(facts.title),
    meta_description: text(facts.meta_description),
    canonical_url: text(facts.canonical_url),
    robots_directives: (['noindex', 'nofollow'] as const).filter((name) => robots[name] === true),
    h1_count: int(headings.h1_count),
    heading_count: Object.values(record(headings.counts)).reduce<number>(
      (sum, value) => sum + int(value),
      0,
    ),
    image_count: int(record(facts.images).count),
    image_missing_alt_count: int(record(facts.images).missing_alt),
    word_count: int(record(facts.body).word_count),
    internal_link_count: internal,
    external_link_count: anchors.length - internal,
    structured_data_types: strings(record(facts.structured_data).types),
  };
}

function deliveryFacts(facts: Record<string, unknown>, htmlBytes: number | null) {
  const delivery = record(facts.delivery);
  const blocking = record(facts.blocking_resources);
  const value = <T>(key: string) => (delivery[key] ?? null) as T | null;
  const text = (key: string) =>
    typeof delivery[key] === 'string' && delivery[key] !== '' ? (delivery[key] as string) : null;
  return {
    field_cwv_available: false as const,
    status_code: value<number>('status_code'),
    ttfb_ms: value<number>('ttfb_ms'),
    wire_bytes: value<number>('wire_bytes'),
    decoded_bytes: value<number>('decoded_bytes'),
    html_bytes: htmlBytes,
    http_version: text('http_version'),
    compression: text('content_encoding'),
    cache_control: text('cache_control'),
    blocking_resource_count:
      Object.keys(blocking).length > 0 && typeof blocking.total === 'number'
        ? Math.trunc(blocking.total)
        : null,
  };
}

export async function pageDetail(
  db: Database,
  workspaceId: string,
  crawlId: string,
  siteUrlId: string,
) {
  const crawl = await loadCrawl(db, workspaceId, crawlId);
  await requireAdmitted(db, crawl, siteUrlId);
  const [row] = await pageRows(db, crawl, { filters: { siteUrlId }, sort: 'url', limit: 1 });
  if (row === undefined) throw notFound('Site URL');
  const workspace = new WorkspaceScope(workspaceId);
  const [analysis, metric, referrers] = await Promise.all([
    row.analysis_id === null
      ? undefined
      : workspace
          .selectFrom(db, 'site_page_analyses')
          .leftJoin('site_fetch_artifacts as f', 'f.id', 'site_page_analyses.artifact_id')
          .select([
            'site_page_analyses.id',
            'site_page_analyses.source_evaluation_ids',
            'site_page_analyses.page_kind_evidence',
            'site_page_analyses.page_traits',
            'f.id as artifact_id',
            'f.normalized_facts',
            'f.decoded_bytes',
          ])
          .where('site_page_analyses.id', '=', row.analysis_id)
          .executeTakeFirstOrThrow(),
    workspace
      .selectFrom(db, 'site_page_link_metrics')
      .selectAll()
      .where('project_id', '=', crawl.project_id)
      .where('crawl_id', '=', crawl.id)
      .where('site_url_id', '=', siteUrlId)
      .where('extractor_version', '=', crawl.extractor_version)
      .where('formula_version', '=', policy.site_health.link_metrics.formula_version)
      .executeTakeFirst(),
    linkedFrom(db, crawl, [siteUrlId]),
  ]);
  const evaluationIds = analysis ? strings(analysis.source_evaluation_ids) : [];
  const [issues, evaluations] = await Promise.all([
    analysis
      ? sql<IssueRow>`
          select i.*, e.reason_code from site_issues i
          join site_rule_evaluations e on e.id = i.evaluation_id
          join site_page_analyses a on a.id = ${analysis.id}
          where i.workspace_id = ${workspaceId} and i.crawl_id = ${crawl.id}
            and i.site_url_id = ${siteUrlId} and ${currentIssueFilter('i', 'a')}
          order by i.created_at, i.id`
          .execute(db)
          .then((result) => result.rows)
      : [],
    evaluationIds.length
      ? workspace
          .selectFrom(db, 'site_rule_evaluations')
          .selectAll()
          .where((eb) => eb('id', '=', eb.fn.any(eb.val(evaluationIds))))
          .orderBy(severityOrder('severity'))
          .orderBy(sql`rule_id collate "C"`)
          .orderBy('id')
          .limit(MAX_EVALUATIONS)
          .execute()
      : [],
  ]);
  const facts = record(analysis?.normalized_facts);
  const page = {
    site_url_id: row.site_url_id,
    normalized_url: row.normalized_url,
    display_url: row.display_url,
    title: row.title,
    page_kind: row.page_kind,
  };
  return pageDetailSchema.parse({
    ...measurementFields(row),
    internal_links: metric
      ? {
          inbound_count: metric.inbound_count,
          outbound_count: metric.outbound_count,
          main_content_inbound_count: metric.main_content_inbound_count,
          main_content_outbound_count: metric.main_content_outbound_count,
          nofollow_inbound_count: metric.nofollow_inbound_count,
          depth_from_home: metric.depth_from_home,
          source_page_count: metric.source_page_count,
          authority_share: metric.authority_share,
          authority_rank: metric.authority_rank,
          authority_scope: 'observed_crawl',
          observed_crawl_incomplete: crawl.sample_mode || !crawl.inventory_complete,
          anchor_diagnostics: metric.anchor_diagnostics ?? [],
          top_inbound: metric.top_inbound ?? [],
          top_outbound: metric.top_outbound ?? [],
          formula_version: metric.formula_version,
        }
      : null,
    site_url_id: row.site_url_id,
    crawl_id: crawl.id,
    normalized_url: row.normalized_url,
    url_hash: hash(row.normalized_url),
    display_url: row.display_url,
    title: row.title,
    analysis_status: row.analysis_status,
    error_code: row.error_code,
    linked_from: referrers.get(siteUrlId) ?? [],
    field_cwv_available: false,
    page_kind_evidence: analysis ? record(analysis.page_kind_evidence) : null,
    page_traits: analysis ? strings(analysis.page_traits) : null,
    issue_count: analysis ? issues.length : null,
    facts: pageFacts(facts),
    delivery: deliveryFacts(facts, analysis?.decoded_bytes ?? null),
    issues: issues.map((issue) => issueOccurrence(issue, page)),
    evaluations: evaluations.map((evaluation) => ({
      id: evaluation.id,
      rule_id: evaluation.rule_id,
      title: ruleTitle(evaluation.rule_id),
      dimension: evaluation.dimension,
      category: evaluation.category,
      severity: evaluation.severity,
      finding_class: evaluation.finding_class,
      outcome: evaluation.outcome,
      display_applicability: evaluation.display_applicability,
      score_applicability: evaluation.score_applicability,
      checklist_membership: strings(evaluation.score_roles).length > 0,
      reason_code: evaluation.reason_code,
      score_roles: strings(evaluation.score_roles),
      aeo_pillar: evaluation.readiness_dimension,
      weight: evaluation.weight,
      evidence: record(evaluation.evidence),
      analyzer_version: evaluation.analyzer_version,
      rule_version: evaluation.rule_version,
      created_at: evaluation.created_at.toISOString(),
    })),
    artifact_id: analysis?.artifact_id ?? null,
    extractor_version: crawl.extractor_version,
    analyzer_version: crawl.analyzer_version,
    rule_version: crawl.rule_catalog_version,
    scoring_version: crawl.scoring_version,
  });
}

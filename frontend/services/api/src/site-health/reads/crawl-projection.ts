/** The crawl contract every Site Health read shares. Nothing here writes. */
import type { crawlCountersSchema } from '@citeladder/contracts/site-health';
import type { z } from 'zod';

import type { Database } from '../../db/database.ts';
import { record, strings } from '../../db/json.ts';
import { countDisclosure, type Crawl, type FailureSummary } from './crawl.ts';
import { crawlCounters } from './crawl-counters.ts';

const NOT_MEASURED = 'not_measured';

type Counters = z.input<typeof crawlCountersSchema>;

const int = (value: unknown) => (typeof value === 'number' ? Math.trunc(value) : 0);
const num = (value: unknown) => (typeof value === 'number' ? value : null);
const text = (value: unknown, fallback: string) =>
  typeof value === 'string' && value !== '' ? value : fallback;

/** The worker-written `score_summary`, or null before scoring. */
export function scoreSummary(crawl: Crawl) {
  const summary = record(crawl.score_summary);
  if (Object.keys(summary).length === 0) return null;
  const byKind = Object.entries(record(summary.by_page_kind)).map(([kind, raw]) => {
    const values = record(raw);
    return [
      kind,
      {
        analyzed_count: int(values.analyzed_count),
        web_fundamentals_score: num(values.web_fundamentals_score),
        web_fundamentals_coverage: num(values.web_fundamentals_coverage),
        web_fundamentals_state: text(values.web_fundamentals_state, NOT_MEASURED),
        aeo_readiness_score: num(values.aeo_readiness_score),
        aeo_measurement_coverage: num(values.aeo_measurement_coverage),
        aeo_measurement_state: text(values.aeo_measurement_state, NOT_MEASURED),
        aeo_measurement_reason: text(values.aeo_measurement_reason, ''),
      },
    ] as const;
  });
  return {
    web_fundamentals_score: num(summary.web_fundamentals_score),
    web_fundamentals_coverage: num(summary.web_fundamentals_coverage),
    web_fundamentals_state: text(summary.web_fundamentals_state, NOT_MEASURED),
    aeo_readiness_score: num(summary.aeo_readiness_score),
    aeo_measurement_coverage: num(summary.aeo_measurement_coverage),
    aeo_measurement_state: text(summary.aeo_measurement_state, NOT_MEASURED),
    search_eligibility: text(summary.search_eligibility, 'unknown'),
    selected_count: int(summary.selected_count),
    analyzed_count: int(summary.analyzed_count),
    issue_count: int(summary.issue_count),
    // The version the crawl was pinned to, never the current configuration.
    scoring_version: text(summary.scoring_version, crawl.scoring_version),
    classified_page_count: int(summary.classified_page_count),
    other_page_count: int(summary.other_page_count),
    classification_error_page_count: int(summary.classification_error_page_count),
    classification_expected_page_count: int(summary.classification_expected_page_count),
    classification_coverage: num(summary.classification_coverage),
    classification_state: text(summary.classification_state, NOT_MEASURED),
    classification_reason_groups: record(summary.classification_reason_groups),
    classification_formula_version: text(summary.classification_formula_version, ''),
    // The stored summary keeps its classification source id lists; no reader renders them.
    scored_page_kind_set: strings(summary.scored_page_kind_set),
    scored_page_count_by_kind: record(summary.scored_page_count_by_kind),
    by_page_kind: Object.fromEntries(byKind),
  };
}

const iso = (value: Date | null) => value?.toISOString() ?? null;

/**
 * The crawl contract, with discovered totals redacted unless the crawl was
 * frozen with count disclosure. The inventory total is the larger of fetched
 * and admitted URLs: a sitemap crawl fetches the root once and admits many.
 */
/**
 * The persisted site facts without the sitemap URL manifest.
 *
 * `sitemap.urls` and `sitemap.lastmod` hold every admitted sitemap URL — up to
 * `max_sitemap_admitted_urls` of them — and are the analysis-time authority for
 * sitemap membership, which page detail already reports per page. Shipping them
 * on every crawl read made the dashboard megabytes; the projection keeps their
 * size as `sitemap.url_count` and leaves the stored facts untouched.
 */
function publicSiteFacts(facts: Record<string, unknown>) {
  if (!('sitemap' in facts)) return facts;
  const { urls, lastmod: _lastmod, ...sitemap } = record(facts.sitemap);
  return {
    ...facts,
    sitemap: Array.isArray(urls) ? { ...sitemap, url_count: urls.length } : sitemap,
  };
}

/** The crawl contract with its chosen counters. */
export async function crawlProjection(
  db: Database,
  crawl: Crawl,
  options: { failureSummary?: FailureSummary | null } = {},
) {
  return projectCrawl(crawl, await crawlCounters(db, crawl), options);
}

/** The crawl's frozen robots choice and who confirmed an `ignore`. */
function robotsChoice(crawl: Crawl) {
  const frozen = record(crawl.configuration);
  if (frozen.robots !== 'ignore')
    return { handling: 'respect' as const, decided_by_email: null, decided_at: null };
  const decision = record(frozen.robots_decision);
  return {
    handling: 'ignore' as const,
    decided_by_email: typeof decision.email === 'string' ? decision.email : null,
    decided_at: typeof decision.decided_at === 'string' ? decision.decided_at : null,
  };
}

/** The crawl contract; `counters` come from `crawlCounters`, the one chooser. */
export function projectCrawl(
  crawl: Crawl,
  counters: Counters,
  options: { failureSummary?: FailureSummary | null } = {},
) {
  const disclose = countDisclosure(crawl);
  const summary = scoreSummary(crawl);
  const inventoryTotal = Math.max(crawl.discovered_url_count, crawl.admitted_url_count);
  return {
    id: crawl.id,
    workspace_id: crawl.workspace_id,
    project_id: crawl.project_id,
    profile_id: crawl.profile_id,
    status: crawl.status,
    discovery_status: crawl.discovery_status,
    analysis_status: crawl.analysis_status,
    root_url: crawl.root_url,
    sample_mode: crawl.sample_mode,
    robots: robotsChoice(crawl),
    inventory_complete: crawl.inventory_complete,
    partial_reason: crawl.partial_reason,
    visible_url_count: crawl.admitted_url_count,
    analyzed_count: crawl.analyzed_url_count,
    failed_count: crawl.failed_url_count,
    discovery_requested_count: crawl.discovery_requested_count,
    analysis_requested_count: crawl.analysis_requested_count,
    counters,
    discovered_count: disclose ? inventoryTotal : null,
    total_url_count: disclose && crawl.inventory_complete ? inventoryTotal : null,
    has_more_site_urls: disclose ? !crawl.inventory_complete : null,
    score_summary: summary,
    failure_summary: options.failureSummary ?? null,
    site_facts: crawl.site_facts === null ? null : publicSiteFacts(record(crawl.site_facts)),
    extractor_version: crawl.extractor_version,
    analyzer_version: crawl.analyzer_version,
    rule_version: crawl.rule_catalog_version,
    scoring_version: crawl.scoring_version,
    error_message: crawl.error_message,
    created_at: crawl.created_at.toISOString(),
    updated_at: crawl.updated_at.toISOString(),
    started_at: iso(crawl.started_at),
    completed_at: iso(crawl.completed_at),
  };
}

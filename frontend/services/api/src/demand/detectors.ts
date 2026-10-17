import { policy } from '../config.ts';
import { addDays } from '../referrals/projection.ts';
import {
  aggregate,
  classificationCounts,
  collectionState,
  queryCandidate,
  round,
  unique,
  type Candidate,
  type Evaluation,
  type QueryInput,
} from './projection.ts';
import { compareText } from '../text-order.ts';
import { groupBy, onlyOf } from '../lists.ts';

const p = policy.demand;
const resolved = (row: QueryInput) => ['exact', 'resolved'].includes(row.resolution_outcome);

export function detectCannibalization(rows: QueryInput[]): Evaluation {
  const candidates: Candidate[] = [];
  let abstained = 0;
  const groups = groupBy(rows, (r) => r.normalized_query);
  for (const query of [...groups.keys()].sort(compareText)) {
    const group = groups.get(query)!;
    if (group[0].classification !== 'non_branded') continue;
    if (!group.every(resolved)) {
      abstained++;
      continue;
    }
    const pages = [...groupBy(group, (r) => r.resolved_page_url)].map(([url, items]) => ({
      url,
      ...aggregate(items),
    }));
    const total = pages.reduce((n, r) => n + r.impressions, 0);
    const qualified = pages
      .filter(
        (r) =>
          r.impressions >= p.DEMAND_CANNIBALIZATION_MIN_PAGE_IMPRESSIONS &&
          total > 0 &&
          r.impressions / total >= p.DEMAND_CANNIBALIZATION_MIN_PAGE_SHARE,
      )
      .sort((a, b) => compareText(a.url, b.url));
    const [first] = qualified;
    if (qualified.length < 2 || !first) continue;
    candidates.push(
      queryCandidate(
        p.DEMAND_SIGNAL_CANNIBALIZATION,
        query,
        first.url,
        { impressions: total, qualifying_page_count: qualified.length },
        {
          source_metric_row_ids: unique(qualified.flatMap((r) => r.source_metric_row_ids)),
          source_artifact_ids: unique(qualified.flatMap((r) => r.source_artifact_ids)),
        },
        {
          pages: qualified.map((r) => ({
            url: r.url,
            impressions: r.impressions,
            share: r.impressions / total,
          })),
          classifier_versions: unique(qualified.flatMap((r) => r.classifier_versions)),
          classification_override_ids: unique(
            qualified.flatMap((r) => r.classification_override_ids),
          ),
        },
        p.DEMAND_CANNIBALIZATION_GAP_WEIGHT,
      ),
    );
  }
  return {
    state: collectionState(abstained, rows.length),
    candidates,
    counts_by_classification: classificationCounts(rows),
    limitations: abstained
      ? [`${abstained} non-branded queries abstained on unresolved page identity.`]
      : [],
  };
}

function tokens(text: string) {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((term) => term && !p.stop_words.includes(term)),
  );
}
function relevance(query: string, a: ReturnType<typeof aggregate>, property: string) {
  const terms = tokens(query);
  const scope = {
    property_ref: property,
    country: 'all',
    device: 'all',
    date_start: a.observed_start,
    date_end: a.observed_end,
  };
  if (!terms.size || !a.page_content_usable)
    return {
      signal_type: p.DEMAND_SIGNAL_QUERY_PAGE_RELEVANCE,
      state: 'unknown',
      reason: !terms.size ? 'no_usable_query_terms' : 'page_content_unavailable',
      signal_active: false,
      scope,
    };
  const title = tokens(a.page_title),
    h1 = tokens(a.page_h1_texts.join(' ')),
    primary = tokens(a.page_primary_content);
  const coverage = (field: Set<string>) =>
    [...terms].filter((term) => field.has(term)).length / terms.size;
  const tc = coverage(title),
    hc = coverage(h1),
    pc = coverage(primary);
  const active =
    a.impressions >= p.DEMAND_QUERY_RELEVANCE_MIN_IMPRESSIONS &&
    tc <= p.DEMAND_QUERY_RELEVANCE_TITLE_COVERAGE_MAX &&
    hc <= p.DEMAND_QUERY_RELEVANCE_H1_COVERAGE_MAX &&
    pc <= p.DEMAND_QUERY_RELEVANCE_PRIMARY_COVERAGE_MAX;
  return {
    signal_type: p.DEMAND_SIGNAL_QUERY_PAGE_RELEVANCE,
    state: 'measured',
    signal_active: active,
    title_coverage: round(tc, 6),
    h1_coverage: round(hc, 6),
    primary_content_coverage: round(pc, 6),
    absent_from_title: [...terms].filter((t) => !title.has(t)).sort(compareText),
    absent_from_h1: [...terms].filter((t) => !h1.has(t)).sort(compareText),
    page_analysis_id: a.page_analysis_id,
    page_artifact_id: a.page_artifact_id,
    scope,
    statement: active
      ? 'This query underperforms its CTR baseline, and important query terms are poorly represented in the inspected page.'
      : null,
  };
}

export function detectCtrGap(rows: QueryInput[]): Evaluation {
  const eligible = rows.filter(
    (r) =>
      r.classification === 'non_branded' && resolved(r) && r.position !== null && r.impressions > 0,
  );
  const aggregates = [
    ...groupBy(eligible, (r) =>
      JSON.stringify([r.property_ref, r.normalized_query, r.resolved_page_url]),
    ),
  ].map(([, items]) => ({ row: items[0], a: aggregate(items) }));
  const cohorts = groupBy(
    aggregates.filter((r) => r.a.position !== null),
    (r) => JSON.stringify([r.row.property_ref, Math.floor(r.a.position!)]),
  );
  const candidates: Candidate[] = [];
  let usable = 0;
  const sorted = [...cohorts.values()].sort(
    (a, b) =>
      compareText(a[0].row.property_ref, b[0].row.property_ref) ||
      Math.floor(a[0].a.position!) - Math.floor(b[0].a.position!),
  );
  for (const cohort of sorted) {
    const total = cohort.reduce((n, r) => n + r.a.impressions, 0);
    if (
      cohort.length < p.DEMAND_CTR_GAP_MIN_COHORT_ROWS ||
      total < p.DEMAND_CTR_GAP_MIN_COHORT_IMPRESSIONS
    )
      continue;
    usable++;
    const ctrs = cohort.map((r) => r.a.ctr ?? 0).sort((a, b) => a - b);
    const median =
      (ctrs[Math.floor((ctrs.length - 1) / 2)]! + ctrs[Math.floor(ctrs.length / 2)]!) / 2;
    for (const { row, a } of cohort) {
      const ctr = a.ctr ?? 0;
      if (
        a.impressions < p.DEMAND_CTR_GAP_MIN_CANDIDATE_IMPRESSIONS ||
        ctr > median * (1 - p.DEMAND_CTR_GAP_RELATIVE_THRESHOLD) ||
        median - ctr < p.DEMAND_CTR_GAP_ABSOLUTE_THRESHOLD
      )
        continue;
      candidates.push(
        queryCandidate(
          p.DEMAND_SIGNAL_CTR_GAP,
          row.normalized_query,
          row.resolved_page_url,
          {
            impressions: a.impressions,
            clicks: a.clicks,
            ctr: a.ctr,
            position: a.position,
            cohort_median_ctr: median,
            cohort_row_count: cohort.length,
            cohort_impressions: total,
          },
          a,
          {
            property_ref: row.property_ref,
            position_band: Math.floor(a.position!),
            classifier_versions: a.classifier_versions,
            classification_override_ids: a.classification_override_ids,
            query_relevance: relevance(row.normalized_query, a, row.property_ref),
          },
          p.DEMAND_CTR_GAP_WEIGHT,
        ),
      );
    }
  }
  return {
    state: usable ? 'available' : 'unavailable',
    candidates,
    counts_by_classification: classificationCounts(rows),
    limitations: usable ? [] : ['No property/position cohort met minimum coverage.'],
  };
}

function hasTrendCoverage(rows: QueryInput[], windowEnd: string) {
  const dates = new Set(rows.map((r) => r.observed_date));
  for (let i = 0; i < p.DEMAND_TREND_REQUIRED_DAYS; i++)
    if (!dates.has(addDays(windowEnd, -i))) return false;
  return true;
}

/** Impressions and rows in the prior and recent comparison windows; other dates are ignored. */
function windowTotals(group: QueryInput[], windowEnd: string) {
  const recentStart = addDays(windowEnd, -(p.DEMAND_TREND_WINDOW_DAYS - 1));
  const priorStart = addDays(recentStart, -p.DEMAND_TREND_WINDOW_DAYS);
  let prior = 0,
    recent = 0;
  const rows: QueryInput[] = [];
  for (const row of group) {
    if (row.observed_date >= priorStart && row.observed_date < recentStart)
      prior += row.impressions;
    else if (row.observed_date >= recentStart && row.observed_date <= windowEnd)
      recent += row.impressions;
    else continue;
    rows.push(row);
  }
  return { prior, recent, rows };
}

function trendType(prior: number, recent: number) {
  if (
    prior + recent < p.DEMAND_TREND_MIN_TOTAL_IMPRESSIONS ||
    prior < p.DEMAND_TREND_MIN_WINDOW_IMPRESSIONS ||
    recent < p.DEMAND_TREND_MIN_WINDOW_IMPRESSIONS
  )
    return null;
  if (
    recent >= prior * p.DEMAND_TREND_EMERGING_RATIO &&
    recent - prior >= p.DEMAND_TREND_MIN_ABSOLUTE_CHANGE
  )
    return p.DEMAND_SIGNAL_EMERGING_QUERY;
  if (
    recent <= prior * p.DEMAND_TREND_DECLINING_RATIO &&
    prior - recent >= p.DEMAND_TREND_MIN_ABSOLUTE_CHANGE
  )
    return p.DEMAND_SIGNAL_DECLINING_QUERY;
  return null;
}

/**
 * Adjacent-window trends anchored on the latest observed day, not the window
 * end: Search Console reports late, so trailing days without rows are
 * unavailable rather than a coverage gap.
 */
export function detectTrends(rows: QueryInput[], windowEnd: string): Evaluation {
  const observed = rows.map((r) => r.observed_date).filter((day) => day <= windowEnd);
  const anchor = observed.reduce((a, b) => (b > a ? b : a), '') || windowEnd;
  if (!hasTrendCoverage(rows, anchor))
    return {
      state: 'insufficient_history',
      candidates: [],
      counts_by_classification: classificationCounts(rows),
      limitations: [`At least ${p.DEMAND_TREND_REQUIRED_DAYS} days of coverage are required.`],
    };
  const candidates: Candidate[] = [];
  const groups = groupBy(
    rows.filter((r) => r.classification === 'non_branded'),
    (r) => r.normalized_query,
  );
  for (const query of [...groups.keys()].sort(compareText)) {
    const group = groups.get(query)!;
    const { prior, recent, rows: evidence } = windowTotals(group, anchor);
    const type = trendType(prior, recent);
    if (!type) continue;
    const pages = unique(evidence.filter(resolved).map((r) => r.resolved_page_url));
    const a = aggregate(evidence);
    candidates.push(
      queryCandidate(
        type,
        query,
        onlyOf(pages) ?? '',
        { impressions: prior + recent, prior_impressions: prior, recent_impressions: recent },
        a,
        {
          resolved_pages: pages,
          classifier_versions: a.classifier_versions,
          classification_override_ids: a.classification_override_ids,
        },
        p.DEMAND_TREND_GAP_WEIGHT,
      ),
    );
  }
  return {
    state: 'available',
    candidates,
    counts_by_classification: classificationCounts(rows),
    limitations: [],
  };
}

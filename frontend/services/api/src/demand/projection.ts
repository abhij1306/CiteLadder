/** Pure demand decisions over recorded evidence. No model or provider calls. */
import { policy } from '../config.ts';
import { hash } from '../traffic/normalization.ts';
import { compareText } from '../text-order.ts';
import { groupBy } from '../lists.ts';
import type { Classification } from './classification.ts';

const p = policy.demand;
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => compareText(a, b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export const stableHash = (value: unknown) => hash(stableJson(value));
/** Round a derived metric to its published decimal precision. */
export function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
export type SearchInput = {
  source_metric_row_ids: string[];
  source_artifact_ids: string[];
  target_kind: string;
  target: string;
  impressions: number;
  clicks: number;
};
export type QueryInput = {
  observed_date: string;
  property_ref: string;
  normalized_query: string;
  resolved_page_url: string;
  resolution_outcome: string;
  classification: string;
  classifier_version: string;
  classification_override_id: string | null;
  impressions: number;
  clicks: number;
  position: number | null;
  source_metric_row_id: string;
  source_artifact_id: string;
  page_title: string;
  page_h1_texts: string[];
  page_primary_content: string;
  page_content_usable: boolean;
  page_analysis_id: string | null;
  page_artifact_id: string | null;
};
export type Candidate = {
  identity_hash: string;
  signal_type: string;
  state: string;
  topic_cluster: string;
  page_url: string;
  evidence: Record<string, unknown>;
  metrics: Record<string, number | null>;
  coverage: Record<string, string>;
  limitations: string[];
  priority_score: number;
  priority_inputs: Record<string, number | string>;
};
export type Evaluation = {
  state: string;
  candidates: Candidate[];
  counts_by_classification: Record<string, number>;
  limitations: string[];
};
/** Partial when any row abstained, else available only when rows were evaluated. */
export function collectionState(abstained: number, rowCount: number) {
  if (abstained) return 'partial';
  return rowCount ? 'available' : 'unavailable';
}
export const unique = (values: string[]) => [...new Set(values)].sort(compareText);
function priority(impressions: number, ctr: number | null, gap: number) {
  const demand = Math.min(1, Math.log1p(Math.max(impressions, 0)) / Math.log1p(10000));
  const weakness = ctr === null ? 1 : Math.max(0, 1 - ctr);
  return {
    priority_score: round(100 * demand * weakness * gap, 2),
    priority_inputs: {
      demand: round(demand, 6),
      weakness: round(weakness, 6),
      gap,
      formula_version: p.DEMAND_FORMULA_VERSION,
    },
  };
}
export type QueryClass = Pick<
  Classification,
  'classification' | 'classifier_version' | 'override_id'
>;
/**
 * Low-CTR targets with enough impressions. A query must classify as
 * non-branded (branded and ambiguous cohorts are never actionable); pages
 * carry no brand class. The highest-impression targets fill a bounded set.
 */
export function detectSearchSignals(
  rows: SearchInput[],
  queryClass: (query: string) => QueryClass | undefined,
): Candidate[] {
  return rows
    .flatMap((row) => {
      const ctr = row.impressions ? row.clicks / row.impressions : null;
      if (
        row.impressions < p.DEMAND_MIN_IMPRESSIONS ||
        (ctr !== null && ctr > p.DEMAND_LOW_CTR_THRESHOLD)
      )
        return [];
      const classified = row.target_kind === 'query' ? queryClass(row.target) : undefined;
      if (row.target_kind === 'query' && classified?.classification !== 'non_branded') return [];
      return [{ row, ctr, classified }];
    })
    .sort(
      (a, b) =>
        b.row.impressions - a.row.impressions ||
        compareText(a.row.target_kind, b.row.target_kind) ||
        compareText(a.row.target, b.row.target),
    )
    .slice(0, p.DEMAND_LOW_CTR_MAX_SIGNALS)
    .map(({ row, ctr, classified }) => ({
      identity_hash: stableHash({
        type: p.DEMAND_SIGNAL_HIGH_IMPRESSION_LOW_CTR,
        target_kind: row.target_kind,
        target: row.target,
        rule_version: p.DEMAND_RULE_VERSION,
      }),
      signal_type: p.DEMAND_SIGNAL_HIGH_IMPRESSION_LOW_CTR,
      state: p.DEMAND_SIGNAL_STATE_ACTIVE,
      topic_cluster: row.target_kind === 'query' ? row.target : '',
      page_url: row.target_kind === 'page' ? row.target : '',
      evidence: {
        target_kind: row.target_kind,
        target: row.target,
        source_metric_row_ids: row.source_metric_row_ids,
        source_artifact_ids: row.source_artifact_ids,
        ...(classified
          ? {
              classifier_versions: [classified.classifier_version],
              classification_override_ids: classified.override_id ? [classified.override_id] : [],
            }
          : {}),
      },
      metrics: { impressions: row.impressions, clicks: row.clicks, ctr },
      coverage: { search_demand: 'observed' },
      limitations: ['GSC detail rows may omit privacy-filtered queries.'],
      ...priority(row.impressions, ctr, p.DEMAND_SEARCH_GAP_WEIGHT),
    }));
}
export function aggregate(rows: QueryInput[]) {
  const impressions = rows.reduce((n, r) => n + r.impressions, 0);
  const clicks = rows.reduce((n, r) => n + r.clicks, 0);
  const positioned = rows.filter((r) => r.position !== null && r.impressions > 0);
  // Weighted over the impressions that report a position, not all impressions.
  const positionedImpressions = positioned.reduce((n, r) => n + r.impressions, 0);
  const page = rows.find((r) => r.page_content_usable) ?? rows[0];
  return {
    impressions,
    clicks,
    ctr: impressions ? clicks / impressions : null,
    position: positionedImpressions
      ? positioned.reduce((n, r) => n + r.position! * r.impressions, 0) / positionedImpressions
      : null,
    source_metric_row_ids: unique(rows.map((r) => r.source_metric_row_id)),
    source_artifact_ids: unique(rows.map((r) => r.source_artifact_id)),
    classifier_versions: unique(rows.map((r) => r.classifier_version)),
    classification_override_ids: unique(
      rows.flatMap((r) => (r.classification_override_id ? [r.classification_override_id] : [])),
    ),
    observed_start: rows.map((r) => r.observed_date).sort(compareText)[0] ?? null,
    observed_end:
      rows
        .map((r) => r.observed_date)
        .sort(compareText)
        .at(-1) ?? null,
    page_title: page?.page_title ?? '',
    page_h1_texts: page?.page_h1_texts ?? [],
    page_primary_content: page?.page_primary_content ?? '',
    page_content_usable: page?.page_content_usable ?? false,
    page_analysis_id: page?.page_analysis_id ?? null,
    page_artifact_id: page?.page_artifact_id ?? null,
  };
}
export function classificationCounts(rows: QueryInput[]) {
  const counts: Record<string, number> = { branded: 0, non_branded: 0, ambiguous: 0 };
  for (const row of rows) counts[row.classification] = (counts[row.classification] ?? 0) + 1;
  return counts;
}
export function queryCandidate(
  type: string,
  query: string,
  page: string,
  metrics: Record<string, number | null>,
  sources: { source_metric_row_ids: string[]; source_artifact_ids: string[] },
  evidence: Record<string, unknown>,
  gap: number,
): Candidate {
  return {
    identity_hash: stableHash({ type, query, page_url: page, rule_version: p.DEMAND_RULE_VERSION }),
    signal_type: type,
    state: p.DEMAND_SIGNAL_STATE_ACTIVE,
    topic_cluster: query,
    page_url: page,
    evidence: {
      target_kind: 'query',
      target: query,
      resolved_page_url: page,
      source_metric_row_ids: sources.source_metric_row_ids,
      source_artifact_ids: sources.source_artifact_ids,
      ...evidence,
    },
    metrics,
    coverage: { query_evidence: 'observed' },
    limitations: ['GSC detail rows may omit privacy-filtered queries.'],
    ...priority(metrics.impressions!, metrics.ctr ?? null, gap),
  };
}
export function detectStrikingDistance(rows: QueryInput[]): Evaluation {
  let abstained = 0;
  const eligible = rows.filter((r) => {
    const usable =
      r.classification !== 'ambiguous' &&
      ['exact', 'resolved'].includes(r.resolution_outcome) &&
      r.position !== null;
    if (!usable) abstained++;
    return usable;
  });
  const groups = groupBy(eligible, (r) =>
    JSON.stringify([r.classification, r.normalized_query, r.resolved_page_url]),
  );
  const candidates: Candidate[] = [];
  // Order by the group identity fields.
  const ordered = [...groups.values()].sort(
    ([a], [b]) =>
      compareText(a.classification, b.classification) ||
      compareText(a.normalized_query, b.normalized_query) ||
      compareText(a.resolved_page_url, b.resolved_page_url),
  );
  for (const group of ordered) {
    const row = group[0];
    const a = aggregate(group);
    const branded = row.classification === 'branded';
    if (
      !branded &&
      !(
        row.classification === 'non_branded' &&
        a.impressions >= p.DEMAND_STRIKING_DISTANCE_MIN_IMPRESSIONS &&
        a.position !== null &&
        a.position >= p.DEMAND_STRIKING_DISTANCE_MIN_POSITION &&
        a.position <= p.DEMAND_STRIKING_DISTANCE_MAX_POSITION
      )
    )
      continue;
    candidates.push(
      queryCandidate(
        branded ? p.DEMAND_SIGNAL_BRANDED_QUERY : p.DEMAND_SIGNAL_STRIKING_DISTANCE,
        row.normalized_query,
        row.resolved_page_url,
        { impressions: a.impressions, clicks: a.clicks, ctr: a.ctr, position: a.position },
        a,
        {
          classifier_versions: a.classifier_versions,
          classification_override_ids: a.classification_override_ids,
        },
        branded ? 0 : p.DEMAND_STRIKING_DISTANCE_GAP_WEIGHT,
      ),
    );
  }
  return {
    state: collectionState(abstained, rows.length),
    candidates,
    counts_by_classification: classificationCounts(rows),
    limitations: abstained
      ? [
          `${abstained} rows abstained on ambiguous classification, unresolved page identity, or missing position.`,
        ]
      : [],
  };
}

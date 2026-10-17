/**
 * Persisted Opportunity row projections and their deterministic presentation.
 *
 * Every value is read from the row a refresh froze; nothing is re-scored or
 * re-derived at read time.
 */
import {
  opportunityDetailSchema,
  opportunitySeveritySchema,
  opportunityTypeSchema,
} from '@citeladder/contracts/opportunities';
import { sql } from 'kysely';

import { policy } from '../config.ts';
import { isoUtc, isoUtcOrNull, utcText, utcTextOf } from '../db/timestamps.ts';
import { record } from '../db/json.ts';
import { scalarText } from '../text-order.ts';

/** One `opportunities` row with its timestamps as `utcText`. */
export type OpportunityRow = {
  id: string;
  project_id: string;
  rule_id: string;
  opportunity_type: string;
  severity: string;
  priority_score: number;
  title: string;
  remediation: string;
  target_key: string;
  target_prompt_id: string | null;
  target_url: string | null;
  target_theme: string | null;
  evidence: unknown;
  source_analysis_ids: unknown;
  source_issue_ids: unknown;
  source_metric_ids: unknown;
  source_traffic_ids: unknown;
  analyzer_version: string;
  rule_version: string;
  formula_version: string;
  action_id: string | null;
  superseded_by_id: string | null;
  created_text: string;
  updated_text: string;
  superseded_text: string | null;
};

/** The `opportunities` columns every projection reads. */
export const OPPORTUNITY_COLUMNS = [
  'opportunities.id',
  'opportunities.project_id',
  'opportunities.rule_id',
  'opportunities.opportunity_type',
  'opportunities.severity',
  'opportunities.priority_score',
  'opportunities.title',
  'opportunities.remediation',
  'opportunities.target_key',
  'opportunities.target_prompt_id',
  'opportunities.target_url',
  'opportunities.target_theme',
  'opportunities.evidence',
  'opportunities.source_analysis_ids',
  'opportunities.source_issue_ids',
  'opportunities.source_metric_ids',
  'opportunities.source_traffic_ids',
  'opportunities.analyzer_version',
  'opportunities.rule_version',
  'opportunities.formula_version',
  'opportunities.action_id',
  'opportunities.superseded_by_id',
  utcTextOf(sql.ref('opportunities.created_at')).as('created_text'),
  utcTextOf(sql.ref('opportunities.updated_at')).as('updated_text'),
  utcText(sql.ref('opportunities.superseded_at')).as('superseded_text'),
] as const;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? [...value] : []);
const ids = (value: unknown): string[] => list(value).map(String);

function humanizeTheme(theme: string): string {
  const words = theme.replaceAll('_', ' ').replaceAll('-', ' ').trim().replace(/\s+/gu, ' ').trim();
  if (!words) return '';
  const [first = '', ...rest] = [...words];
  return `${first.toUpperCase()}${rest.join('')} theme`;
}

/** The user-facing target label, from persisted frozen evidence only. */
function targetLabel(row: Pick<OpportunityRow, 'evidence' | 'target_theme' | 'target_url'>) {
  const evidence = record(row.evidence);
  // Detector hits store `prompt_text`; confirmed declines store `prompt`.
  const prompt = scalarText(evidence.prompt_text).trim() || scalarText(evidence.prompt).trim();
  const product = scalarText(evidence.product_name).trim();
  return row.target_url || prompt || humanizeTheme(row.target_theme ?? '') || product || null;
}

/** The one encoding of an opportunity's identity across refreshes. */
export const stableKey = (row: Pick<OpportunityRow, 'rule_id' | 'target_key'>): string =>
  JSON.stringify([row.rule_id, row.target_key]);

function evidenceSummary(row: OpportunityRow) {
  const sources: [string, unknown[]][] = [
    ['analysis', list(row.source_analysis_ids)],
    ['issue', list(row.source_issue_ids)],
    ['metric', list(row.source_metric_ids)],
    ['traffic', list(row.source_traffic_ids)],
  ];
  return {
    count: sources.reduce((total, [, values]) => total + values.length, 0),
    kinds: sources.filter(([, values]) => values.length).map(([kind]) => kind),
  };
}

type Rank = { system_rank: number; display_rank: number; order_source: 'system' | 'manual' };

/** The factors shown beside a score: its inputs plus the detector's own. */
function priorityFactors(row: OpportunityRow): Record<string, string | number> {
  // The detector's factors, then the row's own values, which always win.
  const factors = {
    ...record(record(row.evidence).priority_factors),
    severity: row.severity,
    system_score: row.priority_score,
    formula_version: row.formula_version,
  };
  return Object.fromEntries(
    Object.entries(factors).filter(
      (entry): entry is [string, string | number] =>
        typeof entry[1] === 'string' || typeof entry[1] === 'number',
    ),
  );
}

const DEFAULT_RANK: Rank = { system_rank: 0, display_rank: 0, order_source: 'system' };

export function projectItem(row: OpportunityRow, rank: Rank = DEFAULT_RANK) {
  return {
    id: row.id,
    project_id: row.project_id,
    rule_id: row.rule_id,
    opportunity_type: opportunityTypeSchema.parse(row.opportunity_type),
    severity: opportunitySeveritySchema.parse(row.severity),
    priority_score: row.priority_score,
    title: row.title || '',
    target_key: row.target_key,
    target_prompt_id: row.target_prompt_id,
    target_url: row.target_url,
    target_theme: row.target_theme,
    target_label: targetLabel(row),
    action_id: row.action_id,
    ...rank,
    priority_factors: priorityFactors(row),
    evidence_summary: evidenceSummary(row),
    created_at: isoUtc(row.created_text),
    updated_at: isoUtc(row.updated_text),
  };
}

/** Rows in the shared manual order, unranked rows after it by system rank. */
export function orderedItems(rows: OpportunityRow[], orderedKeys: unknown) {
  const systemRank = new Map(rows.map((row, index) => [row.id, index + 1]));
  const keys = list(orderedKeys);
  if (!keys.length) {
    return rows.map((row, index) =>
      projectItem(row, { system_rank: index + 1, display_rank: index + 1, order_source: 'system' }),
    );
  }
  const manual = new Map(keys.map((key, index) => [key, index]));
  const position = (row: OpportunityRow) =>
    manual.get(stableKey(row)) ?? manual.size + systemRank.get(row.id)!;
  const ordered = [...rows].sort(
    (a, b) => position(a) - position(b) || systemRank.get(a.id)! - systemRank.get(b.id)!,
  );
  return ordered.map((row, index) =>
    projectItem(row, {
      system_rank: systemRank.get(row.id)!,
      display_rank: index + 1,
      order_source: manual.has(stableKey(row)) ? 'manual' : 'system',
    }),
  );
}

/** The brief a detector froze on this row, or empty when it froze none. */
const persistedHandoff = (row: Pick<OpportunityRow, 'evidence'>): Record<string, unknown> => ({
  ...record(record(row.evidence).content_handoff),
});

const DEFAULT_FORMAT = 'content_page';

function projectContentHandoff(row: OpportunityRow): Record<string, unknown> {
  const persisted = persistedHandoff(row);
  const versions = {
    detector: row.analyzer_version,
    rule: row.rule_version,
    formula: row.formula_version,
    handoff_template:
      persisted.handoff_template_version ||
      policy.opportunity.source_patterns.CONTENT_HANDOFF_TEMPLATE_VERSION,
  };
  const skill = persisted.suggested_skill_id
    ? scalarText(persisted.suggested_skill_id)
    : DEFAULT_FORMAT;
  // A detector's frozen brief overlays the row's default brief, so a brief
  // frozen before a field existed still carries every published field.
  return {
    ...defaultHandoff(row),
    ...persisted,
    opportunity_id: row.id,
    suggested_skill_id: skill,
    snapshot_versions: versions,
  };
}

function defaultHandoff(row: OpportunityRow): Record<string, unknown> {
  return {
    pathway: policy.opportunity.earned_actions.ACTION_PATH_OWNED,
    source_class: null,
    canonical_domain: null,
    suggested_role: 'Content',
    suggested_skill_id: DEFAULT_FORMAT,
    target_url: row.target_url,
    target_theme: row.target_theme,
    representative_citations: [],
    affected_themes: row.target_theme ? [row.target_theme] : [],
    observed_competitors: list(record(row.evidence).competitor_names),
    coverage: {},
    limitations: [],
    truncated: false,
    source_analysis_ids: ids(row.source_analysis_ids),
  };
}

export function projectDetail(row: OpportunityRow) {
  return {
    ...projectItem(row),
    remediation: row.remediation || '',
    evidence: record(row.evidence),
    source_analysis_ids: ids(row.source_analysis_ids),
    source_issue_ids: ids(row.source_issue_ids),
    source_metric_ids: ids(row.source_metric_ids),
    source_traffic_ids: ids(row.source_traffic_ids),
    analyzer_version: row.analyzer_version,
    rule_version: row.rule_version,
    formula_version: row.formula_version,
    content_handoff: opportunityDetailSchema.shape.content_handoff.parse(
      projectContentHandoff(row),
    ),
    superseded_by_id: row.superseded_by_id,
    superseded_at: isoUtcOrNull(row.superseded_text),
  };
}

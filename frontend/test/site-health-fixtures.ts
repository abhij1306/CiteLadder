import type { SiteHealthOverview, SiteScoreSummary } from '@/lib/api/types';

export const EMPTY_WEB_FUNDAMENTALS: SiteHealthOverview['web_fundamentals'] = {
  state: 'not_measured',
  areas: [],
  field_data: {
    state: 'unavailable',
    reason: 'provider_not_configured',
    lcp: null,
    inp: null,
    cls: null,
  },
  source_analysis_ids: [],
  source_artifact_ids: [],
  source_evaluation_ids: [],
  limitations: [],
};

export const COMPLETE_CLASSIFICATION_PROJECTION = {
  classified_page_count: 4,
  other_page_count: 0,
  classification_error_page_count: 0,
  classification_expected_page_count: 4,
  classification_coverage: 1,
  classification_state: 'complete',
  classification_reason_groups: {},
  classification_formula_version: '1',
  classification_source_analysis_ids: ['33333333-3333-4333-8333-333333333333'],
  classification_source_artifact_ids: ['44444444-4444-4444-8444-444444444444'],
  classification_source_task_ids: ['55555555-5555-4555-8555-555555555555'],
  scored_page_kind_set: ['homepage', 'article'],
  scored_page_count_by_kind: { homepage: 1, article: 3 },
} satisfies Pick<
  SiteScoreSummary,
  | 'classified_page_count'
  | 'other_page_count'
  | 'classification_error_page_count'
  | 'classification_expected_page_count'
  | 'classification_coverage'
  | 'classification_state'
  | 'classification_reason_groups'
  | 'classification_formula_version'
  | 'classification_source_analysis_ids'
  | 'classification_source_artifact_ids'
  | 'classification_source_task_ids'
  | 'scored_page_kind_set'
  | 'scored_page_count_by_kind'
>;

export const UNCHANGED_COHORT_COMPOSITION = {
  added_page_kinds: [],
  removed_page_kinds: [],
  previous_page_count_by_kind: {},
  current_page_count_by_kind: {},
} satisfies SiteHealthOverview['trend']['cohort_composition'];

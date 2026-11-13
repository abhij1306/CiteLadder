import type { SiteHealthOverview, SiteScoreSummary } from '@citeladder/contracts';

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
  | 'scored_page_kind_set'
  | 'scored_page_count_by_kind'
>;

export const UNCHANGED_COHORT_COMPOSITION = {
  added_page_kinds: [],
  removed_page_kinds: [],
  previous_page_count_by_kind: {},
  current_page_count_by_kind: {},
} satisfies SiteHealthOverview['change_summary']['cohort_composition'];

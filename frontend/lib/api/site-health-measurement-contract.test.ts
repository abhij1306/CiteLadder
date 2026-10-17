import { describe, expect, it } from 'vite-plus/test';

import { siteCrawlSchema, siteHealthOverviewSchema } from '@citeladder/contracts/site-health';
import { strictValidate } from '@citeladder/contracts/validation';
import {
  SITE_HEALTH_CRAWL as crawl,
  SITE_HEALTH_UUID as UUID,
  SITE_HEALTH_UUID_2 as UUID2,
} from '@/test/site-health-api-fixtures';

describe('siteScoreSummarySchema by_page_kind (v2 P1)', () => {
  const scoreSummary = {
    web_fundamentals_score: 80,
    web_fundamentals_coverage: 1,
    web_fundamentals_state: 'measured',
    aeo_readiness_score: 62,
    aeo_measurement_coverage: 0.8,
    aeo_measurement_state: 'measured',
    search_eligibility: 'eligible',
    classified_page_count: 3,
    other_page_count: 1,
    classification_error_page_count: 0,
    classification_expected_page_count: 4,
    classification_coverage: 0.75,
    classification_state: 'partial',
    classification_reason_groups: { no_signals: 1 },
    classification_formula_version: '1',
    classification_source_analysis_ids: [UUID],
    classification_source_artifact_ids: [UUID2],
    classification_source_task_ids: [UUID],
    scored_page_kind_set: ['homepage', 'article', 'other'],
    scored_page_count_by_kind: { homepage: 1, article: 2, other: 1 },
    selected_count: 10,
    analyzed_count: 4,
    issue_count: 3,
    scoring_version: 's1',
    by_page_kind: {
      homepage: {
        analyzed_count: 1,
        web_fundamentals_score: 90.5,
        web_fundamentals_coverage: 1,
        web_fundamentals_state: 'measured',
        aeo_readiness_score: 70,
        aeo_measurement_coverage: 0.8,
        aeo_measurement_state: 'measured',
        aeo_measurement_reason: '',
      },
      article: {
        analyzed_count: 2,
        web_fundamentals_score: null,
        web_fundamentals_coverage: null,
        web_fundamentals_state: 'not_measured',
        aeo_readiness_score: null,
        aeo_measurement_coverage: null,
        aeo_measurement_state: 'not_measured',
        aeo_measurement_reason: '',
      },
      other: {
        analyzed_count: 1,
        web_fundamentals_score: 80,
        web_fundamentals_coverage: 1,
        web_fundamentals_state: 'measured',
        aeo_readiness_score: null,
        aeo_measurement_coverage: null,
        aeo_measurement_state: 'not_measured',
        aeo_measurement_reason: 'page_purpose_unresolved',
      },
    },
  };

  it('accepts the expanded page-kind vocabulary (how_to, listicle, alternative)', () => {
    // The classifier vocabulary (how_to, listicle, alternative) shipped
    // without the frontend zod enum catching up, so any completed cohort
    // containing one of these kinds failed the dashboard parse and took the
    // whole screen down.
    const parsed = strictValidate(
      siteCrawlSchema,
      {
        ...crawl,
        score_summary: {
          ...scoreSummary,
          scored_page_kind_set: ['guide', 'how_to', 'listicle', 'comparison', 'alternative'],
          scored_page_count_by_kind: {
            guide: 1,
            how_to: 2,
            listicle: 1,
            comparison: 1,
            alternative: 1,
          },
        },
      },
      'crawl',
    );
    expect(parsed.score_summary?.scored_page_kind_set).toEqual([
      'guide',
      'how_to',
      'listicle',
      'comparison',
      'alternative',
    ]);
    expect(parsed.score_summary?.scored_page_count_by_kind).toEqual({
      guide: 1,
      how_to: 2,
      listicle: 1,
      comparison: 1,
      alternative: 1,
    });
  });

  it('accepts classification completeness and a scored page-kind breakdown', () => {
    const parsed = strictValidate(
      siteCrawlSchema,
      { ...crawl, score_summary: scoreSummary },
      'crawl',
    );
    expect(parsed.score_summary?.by_page_kind.homepage?.analyzed_count).toBe(1);
    expect(parsed.score_summary?.by_page_kind.article?.aeo_readiness_score).toBeNull();
    expect(parsed.score_summary?.by_page_kind.other?.aeo_measurement_reason).toBe(
      'page_purpose_unresolved',
    );
    expect(parsed.score_summary).toMatchObject({
      classified_page_count: 3,
      other_page_count: 1,
      classification_error_page_count: 0,
      classification_expected_page_count: 4,
      classification_coverage: 0.75,
      classification_state: 'partial',
      scored_page_kind_set: ['homepage', 'article', 'other'],
      scored_page_count_by_kind: { homepage: 1, article: 2, other: 1 },
    });
  });

  it('accepts Other as a scored page kind when general checks produce a score', () => {
    const withOtherOnly = {
      ...scoreSummary,
      scored_page_kind_set: ['other'],
      scored_page_count_by_kind: { other: 1 },
    };

    const parsed = strictValidate(
      siteCrawlSchema,
      { ...crawl, score_summary: withOtherOnly },
      'crawl',
    );

    expect(parsed.score_summary?.scored_page_kind_set).toEqual(['other']);
    expect(parsed.score_summary?.scored_page_count_by_kind.other).toBe(1);
  });
  it('accepts an empty by_page_kind map (nothing classified yet)', () => {
    const parsed = strictValidate(
      siteCrawlSchema,
      { ...crawl, score_summary: { ...scoreSummary, by_page_kind: {} } },
      'crawl',
    );
    expect(parsed.score_summary?.by_page_kind).toEqual({});
  });

  it('strips an additive key inside a by_page_kind bucket (tolerant-on-unknown)', () => {
    const bad = {
      ...scoreSummary,
      by_page_kind: {
        homepage: { ...scoreSummary.by_page_kind.homepage, discovered_total: 9999 },
      },
    };
    const parsed = strictValidate(siteCrawlSchema, { ...crawl, score_summary: bad }, 'crawl');
    expect(parsed.score_summary?.by_page_kind.homepage?.analyzed_count).toBe(1);
    expect('discovered_total' in (parsed.score_summary?.by_page_kind.homepage ?? {})).toBe(false);
  });
});

describe('siteHealthOverviewSchema scored-cohort movement', () => {
  const cohortComposition = {
    added_page_kinds: ['product'],
    removed_page_kinds: ['article'],
    previous_page_count_by_kind: { homepage: 1, article: 3 },
    current_page_count_by_kind: { homepage: 1, product: 2 },
  };

  it('accepts cohort-composition change context on trend and change summaries', () => {
    const trend = strictValidate(
      siteHealthOverviewSchema.shape.trend,
      {
        state: 'measured',
        reason: 'cohort_composition_changed',
        metric: 'aeo_readiness_score',
        series: [
          { label: 'Previous', value: 70 },
          { label: 'Current', value: 74 },
        ],
        cohort_composition: cohortComposition,
      },
      'overview.trend',
    );
    const change = strictValidate(
      siteHealthOverviewSchema.shape.change_summary,
      {
        state: 'measured',
        reason: 'cohort_composition_changed',
        metrics: [],
        cohort_composition: cohortComposition,
      },
      'overview.change_summary',
    );

    expect(trend.cohort_composition.added_page_kinds).toEqual(['product']);
    expect(change.cohort_composition.previous_page_count_by_kind.article).toBe(3);
  });

  it('accepts Other as part of the scored cohort composition', () => {
    const parsed = strictValidate(
      siteHealthOverviewSchema.shape.trend,
      {
        state: 'measured',
        reason: 'cohort_composition_changed',
        metric: 'aeo_readiness_score',
        series: [],
        cohort_composition: {
          ...cohortComposition,
          added_page_kinds: ['other'],
          current_page_count_by_kind: { homepage: 1, product: 2, other: 1 },
        },
      },
      'overview.trend',
    );

    expect(parsed.cohort_composition.added_page_kinds).toEqual(['other']);
    expect(parsed.cohort_composition.current_page_count_by_kind.other).toBe(1);
  });
});

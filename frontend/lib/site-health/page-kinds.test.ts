import { describe, expect, it } from 'vite-plus/test';

import type { PageKindScoreSummary } from '@citeladder/contracts';
import { PAGE_KINDS, byPageKindRows, pageKindLabel } from './page-kinds';

describe('pageKindLabel (the single shared mapping)', () => {
  it('has a humanized label for every page kind in the vocabulary', () => {
    for (const pageKind of PAGE_KINDS) {
      expect(pageKindLabel(pageKind)).not.toBe(pageKind);
      expect(pageKindLabel(pageKind).length).toBeGreaterThan(0);
    }
  });

  it('maps the multi-word and acronym types exactly', () => {
    expect(pageKindLabel('about_contact')).toBe('About / Contact');
    expect(pageKindLabel('faq')).toBe('FAQ');
  });

  it('falls back to sentence-casing an unknown type instead of rendering blank', () => {
    expect(pageKindLabel('landing_page')).toBe('Landing page');
    expect(pageKindLabel('constructor')).toBe('Constructor');
  });
});

describe('byPageKindRows (dashboard breakdown ordering)', () => {
  const bucket = (analyzed_count: number): PageKindScoreSummary => ({
    analyzed_count,
    web_fundamentals_score: 80,
    web_fundamentals_coverage: 1,
    web_fundamentals_state: 'measured',
    aeo_readiness_score: 62,
    aeo_measurement_coverage: 0.8,
    aeo_measurement_state: 'measured',
    web_fundamentals_checks: null,
    aeo_readiness_checks: null,
    aeo_measurement_reason: '',
  });

  it('returns [] for an empty breakdown', () => {
    expect(byPageKindRows({})).toEqual([]);
  });

  it('orders rows by the PAGE_KINDS display order, not insertion order', () => {
    const rows = byPageKindRows({
      pricing: bucket(1),
      homepage: bucket(2),
      article: bucket(3),
    });
    expect(rows.map((row) => row.page_kind)).toEqual(['homepage', 'article', 'pricing']);
  });

  it('appends unknown types alphabetically after the known vocabulary', () => {
    const rows = byPageKindRows({
      zebra_page: bucket(1),
      article: bucket(2),
      landing_page: bucket(3),
    });
    expect(rows.map((row) => row.page_kind)).toEqual(['article', 'landing_page', 'zebra_page']);
  });
});

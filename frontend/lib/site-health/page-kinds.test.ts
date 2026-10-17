import { describe, expect, it } from 'vite-plus/test';

import type { PageKindScoreSummary } from '@/lib/api/types';
import {
  PAGE_KINDS,
  byPageKindRows,
  pageKindConfidenceLabel,
  pageKindLabel,
  pageTraitLabel,
  readPageKindEvidence,
} from './page-kinds';

describe('confidence labels', () => {
  it('describes structural medium confidence without claiming URL evidence', () => {
    expect(pageKindConfidenceLabel('medium', 'structural')).toBe('Medium — mixed evidence');
    expect(pageKindConfidenceLabel('medium', 'route')).toBe('Medium — URL pattern');
  });
});

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

  it('falls back to title-casing an unknown type instead of rendering blank', () => {
    expect(pageKindLabel('landing_page')).toBe('Landing Page');
  });
});

describe('pageTraitLabel', () => {
  it('does not expose properties inherited from Object.prototype', () => {
    expect(pageTraitLabel('constructor')).toBe('constructor');
    expect(pageTraitLabel('toString')).toBe('toString');
    expect(pageTraitLabel('__proto__')).toBe('__proto__');
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

describe('readPageKindEvidence (why-this-type disclosure reader)', () => {
  // The exact shape `PageKindAssessment.to_evidence()` persists (snake_case).
  const persisted = {
    classifier_version: 'sh-classifier-1',
    classified_by: 'path_pattern',
    schema_suggested_type: 'product',
    confidence: 'medium',
    tier: 'route',
    signals: [
      {
        signal: 'path_pattern',
        page_kind: 'article',
        tier: 'route',
        detail: '^/(blog|news|guides)(/|$)',
      },
      { signal: 'structured_data', page_kind: 'product', tier: 'semantic', detail: 'Product' },
    ],
  };

  it('parses a full evidence record into the display view', () => {
    const view = readPageKindEvidence(persisted, 'article');
    expect(view).toEqual({
      classifierVersion: 'sh-classifier-1',
      classifiedBy: 'path_pattern',
      schemaSuggestedType: 'product',
      confidence: 'medium',
      tier: 'route',
      signals: [
        {
          signal: 'path_pattern',
          pageKind: 'article',
          tier: 'route',
          detail: '^/(blog|news|guides)(/|$)',
        },
        { signal: 'structured_data', pageKind: 'product', tier: 'semantic', detail: 'Product' },
      ],
      schemaConflict: true,
      // Absent in this fixture; the parser still surfaces the fields so the
      // disclosure can distinguish "no alternatives" from "not parsed".
      alternatives: [],
      conflicts: [],
      otherReason: null,
    });
  });

  it('flags no conflict when the schema suggestion matches the final type', () => {
    const view = readPageKindEvidence(persisted, 'product');
    expect(view?.schemaConflict).toBe(false);
  });

  it('flags no conflict when there is no schema suggestion', () => {
    const view = readPageKindEvidence({ ...persisted, schema_suggested_type: null }, 'article');
    expect(view?.schemaSuggestedType).toBeNull();
    expect(view?.schemaConflict).toBe(false);
  });

  it('returns null for absent or malformed evidence', () => {
    expect(readPageKindEvidence(null, 'article')).toBeNull();
    expect(readPageKindEvidence(undefined, 'article')).toBeNull();
    expect(readPageKindEvidence('article', 'article')).toBeNull();
    expect(readPageKindEvidence(42, 'article')).toBeNull();
    expect(readPageKindEvidence([], 'article')).toBeNull();
    expect(readPageKindEvidence({}, 'article')).toBeNull();
    // A required field of the wrong type sinks the whole record.
    expect(readPageKindEvidence({ ...persisted, confidence: 1.3 }, 'article')).toBeNull();
    expect(readPageKindEvidence({ ...persisted, classified_by: 7 }, 'article')).toBeNull();
  });

  it('skips malformed signal entries and defaults a missing detail', () => {
    const view = readPageKindEvidence(
      {
        ...persisted,
        signals: [
          'not-an-object',
          { signal: 'path_pattern', page_kind: 'article' }, // no tier
          { signal: 'structured_data', page_kind: 'product', tier: 'semantic' }, // no detail
        ],
      },
      'article',
    );
    expect(view?.signals).toEqual([
      { signal: 'structured_data', pageKind: 'product', tier: 'semantic', detail: '' },
    ]);
  });
});

describe('readPageKindEvidence — alternatives, conflicts, other_reason', () => {
  const base = {
    classifier_version: 'sh-classifier-1',
    classified_by: 'path_pattern',
    confidence: 'low',
    tier: 'semantic',
    signals: [],
  };

  it('preserves alternatives, conflicts, and other_reason', () => {
    const view = readPageKindEvidence(
      {
        ...base,
        other_reason: 'no_classification_signals',
        alternatives: [{ page_kind: 'article', tier: 'route', signals: ['path_pattern'] }],
        conflicts: [
          {
            winner_page_kind: 'faq',
            conflicting_page_kind: 'article',
            signal: 'structured_data',
            detail: 'BlogPosting',
          },
        ],
      },
      'other',
    );
    expect(view?.otherReason).toBe('no_classification_signals');
    expect(view?.alternatives).toEqual([
      { pageKind: 'article', tier: 'route', signals: ['path_pattern'] },
    ]);
    expect(view?.conflicts).toHaveLength(1);
    expect(view?.conflicts[0]?.conflictingPageKind).toBe('article');
  });

  it('skips malformed entries instead of sinking the whole panel', () => {
    const view = readPageKindEvidence(
      {
        ...base,
        // Wrong types, wrong shapes, and a valid entry mixed together.
        other_reason: 42,
        alternatives: ['nope', null, { page_kind: 'faq' }, { page_kind: 'docs', tier: 'route' }],
        conflicts: [{ signal: 'only_a_signal' }, 7],
      },
      'other',
    );
    expect(view).not.toBeNull();
    // A non-string other_reason is not a reason.
    expect(view?.otherReason).toBeNull();
    // Only the fully-shaped alternative survives.
    expect(view?.alternatives).toEqual([{ pageKind: 'docs', tier: 'route', signals: [] }]);
    expect(view?.conflicts).toEqual([]);
  });
});

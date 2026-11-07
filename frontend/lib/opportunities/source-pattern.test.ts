import { describe, expect, it } from 'vite-plus/test';
import type { SourcePattern } from '@citeladder/contracts';

import {
  classCountChips,
  observedSourcePattern,
  recommendedActionLabel,
  sourceClassBadgeValue,
  sourceClassLabel,
} from '@/lib/opportunities/source-pattern';

const BLOCK: SourcePattern = {
  taxonomy_version: 'source-taxonomy-1',
  distinct_domain_count: 3,
  independent_domain_count: 2,
  class_counts: { community: 1, competitor_owned: 1, review_marketplace: 1 },
  observed_patterns: ['competitor_owned_sources_cited', 'community_evidence_present'],
  competitor_source_domains: { Globex: ['globex.com'] },
  top_citations: [
    {
      domain: 'globex.com',
      url: 'https://globex.com/crm',
      title: 'Globex CRM',
      source_class: 'competitor_owned',
      matched_competitor: 'Globex',
    },
  ],
  top_citations_truncated: false,
  recommended_action: 'investigate_competitor_sources',
};

describe('classCountChips', () => {
  it('orders class chips by the taxonomy order, not payload key order', () => {
    expect(classCountChips(BLOCK)).toEqual([
      { sourceClass: 'competitor_owned', count: 1 },
      { sourceClass: 'review_marketplace', count: 1 },
      { sourceClass: 'community', count: 1 },
    ]);
  });

  it('names a search surface as what it is', () => {
    const [chip] = classCountChips({ ...BLOCK, class_counts: { search_surface: 2 } });
    expect(chip).toEqual({ sourceClass: 'search_surface', count: 2 });
    expect(sourceClassLabel('search_surface')).toBe('Search surface');
    expect(sourceClassBadgeValue('search_surface')).toBe('third-party');
  });
});

describe('observedSourcePattern', () => {
  it('shows a block that observed cited domains, and nothing when none were cited', () => {
    expect(observedSourcePattern(BLOCK)?.distinct_domain_count).toBe(3);
    expect(observedSourcePattern({ ...BLOCK, distinct_domain_count: 0 })).toBeNull();
    expect(observedSourcePattern(undefined)).toBeNull();
  });
});

describe('display helpers', () => {
  it('colours only by ownership, so independence is never a quality ranking', () => {
    expect(sourceClassBadgeValue('brand_owned')).toBe('owned');
    expect(sourceClassBadgeValue('competitor_owned')).toBe('competitor');
    expect(sourceClassBadgeValue('review_marketplace')).toBe('third-party');
    expect(sourceClassBadgeValue('community')).toBe('third-party');
  });

  it('labels a known action and renders none for an unknown token', () => {
    expect(recommendedActionLabel('investigate_competitor_sources')).toBe(
      'Review the competitor-owned pages the engines cited',
    );
    expect(recommendedActionLabel('brand_new_action')).toBeNull();
  });
});

import { describe, expect, it } from 'vite-plus/test';

import {
  parseSourcePattern,
  recommendedActionLabel,
  sourceClassBadgeValue,
} from '@/lib/opportunities/source-pattern';

const BLOCK = {
  taxonomy_version: 'source-taxonomy-2',
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
    {
      domain: 'g2.com',
      url: 'https://g2.com/x',
      title: 'G2 listing',
      source_class: 'review_marketplace',
      matched_competitor: null,
    },
  ],
  top_citations_truncated: false,
  recommended_action: 'investigate_competitor_sources',
};

describe('search_surface', () => {
  it('survives parsing instead of being dropped as an unknown class', () => {
    // Every backend class needs a line in this module or it vanishes from
    // the breakdown entirely -- the bug that once hid `social` and
    // `institutional`. A Google SERP card must render as what it is.
    const pattern = parseSourcePattern({
      source_pattern: {
        ...BLOCK,
        class_counts: { search_surface: 2 },
        top_citations: [
          {
            domain: 'google.com',
            url: 'https://www.google.com/search?q=x&prds=y',
            title: 'Google Shopping',
            source_class: 'search_surface',
            matched_competitor: null,
          },
        ],
      },
    });
    expect(pattern?.topCitations).toHaveLength(1);
    expect(pattern?.classCounts).toEqual([{ sourceClass: 'search_surface', count: 2 }]);
    expect(sourceClassBadgeValue('search_surface')).toBe('third-party');
  });
});

describe('parseSourcePattern', () => {
  it('projects a full backend payload', () => {
    const pattern = parseSourcePattern({ source_pattern: BLOCK });
    expect(pattern).not.toBeNull();
    expect(pattern?.distinctDomainCount).toBe(3);
    expect(pattern?.independentDomainCount).toBe(2);
    expect(pattern?.topCitations).toHaveLength(2);
    expect(pattern?.competitorSourceDomains).toEqual([
      { competitor: 'Globex', domains: ['globex.com'] },
    ]);
  });

  it('orders class chips by the known class order, not payload key order', () => {
    const pattern = parseSourcePattern({ source_pattern: BLOCK });
    expect(pattern?.classCounts.map((entry) => entry.sourceClass)).toEqual([
      'competitor_owned',
      'review_marketplace',
      'community',
    ]);
  });

  it('returns null when the block is absent (rows written before the taxonomy)', () => {
    expect(parseSourcePattern({ prompt_text: 'best crm' })).toBeNull();
  });

  it('returns null when nothing was cited, so the drawer renders nothing', () => {
    expect(
      parseSourcePattern({ source_pattern: { ...BLOCK, distinct_domain_count: 0 } }),
    ).toBeNull();
  });

  it('drops citations with an unknown source class rather than guessing one', () => {
    const pattern = parseSourcePattern({
      source_pattern: {
        ...BLOCK,
        top_citations: [{ domain: 'x.com', url: '', title: '', source_class: 'made_up' }],
      },
    });
    expect(pattern?.topCitations).toEqual([]);
  });

  it('survives a malformed payload without throwing', () => {
    const pattern = parseSourcePattern({
      source_pattern: {
        distinct_domain_count: 2,
        class_counts: 'not-an-object',
        observed_patterns: [1, 'community_evidence_present'],
        competitor_source_domains: null,
        top_citations: 'nope',
      },
    });
    expect(pattern?.classCounts).toEqual([]);
    expect(pattern?.observedPatterns).toEqual(['community_evidence_present']);
    expect(pattern?.topCitations).toEqual([]);
    expect(pattern?.recommendedAction).toBeNull();
  });
});

describe('display helpers', () => {
  it('colours only by ownership, so independence is never a quality ranking', () => {
    expect(sourceClassBadgeValue('brand_owned')).toBe('owned');
    expect(sourceClassBadgeValue('competitor_owned')).toBe('competitor');
    expect(sourceClassBadgeValue('review_marketplace')).toBe('third-party');
    expect(sourceClassBadgeValue('community')).toBe('third-party');
  });

  it('renders no action label for an unknown or missing action token', () => {
    expect(recommendedActionLabel('brand_new_action')).toBeNull();
    expect(recommendedActionLabel(null)).toBeNull();
  });
});

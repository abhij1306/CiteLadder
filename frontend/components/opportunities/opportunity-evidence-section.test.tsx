import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import type { OpportunityDetail } from '@/lib/api/types';
import { renderWithProviders } from '@/test/render';

import { OpportunityEvidenceSection } from './opportunity-evidence-section';

const ID = '11111111-1111-4111-8111-111111111111';
const evidence = {
  keyword: 'running shoes',
  normalized_keyword: 'running shoes',
  query_key: 'running shoes',
  search_volume: 900,
  intent: 'commercial',
  market: { location_code: 2840, language_code: 'en' },
  owned_origin: 'https://www.example.com',
  competitors: [
    {
      competitor_id: ID,
      name: 'Rival',
      keyword: 'running shoes',
      rank_group: 3,
      url: 'https://rival.test/shoes',
      dataset_id: ID,
      row_id: ID,
      published_at: '2026-10-01T00:00:00Z',
      coverage: 'complete',
    },
  ],
  competitor_names: ['Rival'],
  target_resolution: { state: 'no_covering_page', candidates: [] },
  provider: 'dataforseo',
  statement: 'DataForSEO estimates that competitors rank for this search and you do not.',
};

const gap = (value: Record<string, unknown>) =>
  ({
    rule_id: 'search_keyword_gap',
    target_theme: 'running shoes',
    target_url: null,
    evidence: value,
  }) as unknown as OpportunityDetail;

describe('keyword-gap evidence', () => {
  it('says who ranks and where', () => {
    renderWithProviders(<OpportunityEvidenceSection detail={gap(evidence)} />);
    expect(screen.getByText('Rival ranks #3 with https://rival.test/shoes')).toBeInTheDocument();
  });

  it('states nothing it cannot read from malformed evidence', () => {
    // A competitor entry without its name or row cannot say who ranks.
    const nameless = { ...evidence, competitors: [{ rank_group: 3 }] };
    renderWithProviders(<OpportunityEvidenceSection detail={gap(nameless)} />);
    expect(screen.queryByText(/ranks/u)).not.toBeInTheDocument();
    expect(screen.getByText('running shoes')).toBeInTheDocument();
  });
});

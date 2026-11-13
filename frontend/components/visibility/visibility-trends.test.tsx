import { screen } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { describe, expect, it } from 'vite-plus/test';

import type { SurfaceRates, Visibility, VisibilityTrendPoint } from '@citeladder/contracts';
import { renderWithProviders as render } from '@/test/render';

import { VisibilityTrends } from './visibility-trends';

const ranking = (name: string, mention: number | null, isBrand = false) => ({
  name,
  is_brand: isBrand,
  logo_url: null,
  website_url: null,
  mention_rate: mention,
  citation_rate: 0.1,
  share_of_voice: 0.2,
  mention_count: 3,
  avg_position: isBrand ? 2 : null,
});

const rankings = [
  ranking('Acme', 0.31, true),
  ranking('Kmart Australia', 0.6),
  ranking('Target Australia', null),
];

const selected = {
  audit_id: '00000000-0000-4000-8000-000000000001',
  visibility_rate: 0.31,
  owned_citation_rate: 0.13,
  avg_position: 2,
  rankings,
  per_engine: [],
  model_provenance: [],
} as unknown as Visibility;

function point(completedAt: string, brandRate: number): VisibilityTrendPoint {
  return {
    audit_id: null,
    completed_at: completedAt,
    brand_mention_rate: brandRate,
    owned_citation_rate: 0.13,
    sov: { mention: 0.2 },
    rankings,
    analyzer_versions: ['1'],
    scoring_rule_versions: ['1'],
    spans_version_boundary: false,
    comparison_key: 'k',
  } as unknown as VisibilityTrendPoint;
}

const loaded = (points: VisibilityTrendPoint[]) =>
  ({ data: points, isError: false, isPending: false }) as unknown as UseQueryResult<
    VisibilityTrendPoint[]
  >;

function renderTrends(query = loaded([])) {
  render(
    <VisibilityTrends
      query={query}
      selected={selected}
      selectionBusy={false}
      engineFilter="all"
      surfaceRatesQuery={{ data: undefined } as unknown as UseQueryResult<SurfaceRates>}
      surfaceEngine={null}
      hasRuns
      isFiltered={false}
    />,
  );
}

describe('Visibility trends', () => {
  it('shows no Over time card for a single period, only the table', () => {
    renderTrends(loaded([point('2026-11-03T00:00:00Z', 0.31)]));
    expect(screen.getByRole('region', { name: 'Brand and competitors' })).toBeVisible();
    expect(screen.queryByText('Over time')).toBeNull();
    expect(screen.queryByRole('group', { name: /over time/u })).toBeNull();
  });

  it('keeps the line chart, each line named at its end, from the second run on', () => {
    const { container } = render(
      <VisibilityTrends
        query={loaded([point('2026-11-01T00:00:00Z', 0.25), point('2026-11-03T00:00:00Z', 0.31)])}
        selected={selected}
        selectionBusy={false}
        engineFilter="all"
        surfaceRatesQuery={{ data: undefined } as unknown as UseQueryResult<SurfaceRates>}
        surfaceEngine={null}
        hasRuns
        isFiltered={false}
      />,
    );
    expect(screen.getByRole('group', { name: /^Visibility over time/u })).toBeVisible();
    expect(screen.getByText('Over time')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Brand and competitors' })).toBeVisible();
    expect(
      [...container.querySelectorAll('[data-line-labels] text')].map((label) => label.textContent),
    ).toEqual(expect.arrayContaining(['You', 'Kmart Australia']));
    // The table and the chart share one row, the table the wider of the two.
    const row = screen
      .getByRole('region', { name: 'Brand and competitors' })
      .closest('[data-app-grid]');
    expect(row?.getAttribute('data-app-grid')).toBe('table-chart');
    expect(row?.contains(screen.getByRole('group', { name: /^Visibility over time/u }))).toBe(true);
  });

  it('names the headline mean position apart from the table Rank', () => {
    renderTrends();
    expect(screen.getByText('Average position in answers')).toBeVisible();
    expect(screen.queryByText('Average position')).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Rank' })).toBeVisible();
  });
});

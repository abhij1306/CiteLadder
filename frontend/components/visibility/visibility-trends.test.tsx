import { screen } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import type { Visibility, VisibilityTrendPoint } from '@citeladder/contracts';
import { renderWithProviders as render } from '@/test/render';

import { BrandTrend, InsightsLede } from './visibility-trends';

const ranking = (name: string, mention: number | null, isBrand = false) => ({
  name,
  is_brand: isBrand,
  logo_url: null,
  website_url: null,
  mention_rate: mention,
  citation_rate: 0.1,
  share_of_voice: 0.2,
  mention_count: 3,
  avg_position: isBrand ? 2.46 : null,
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
    events: [],
  } as unknown as VisibilityTrendPoint;
}

const loaded = (points: VisibilityTrendPoint[]) =>
  ({ data: points, isError: false, isSuccess: true }) as unknown as UseQueryResult<
    VisibilityTrendPoint[]
  >;

afterEach(() => window.history.replaceState(null, '', '/'));

describe('Insights lede', () => {
  it('heads with the rank and the brand ahead, and shows Position only when served', () => {
    const { unmount } = render(<InsightsLede selected={selected} />);
    expect(screen.getByRole('heading', { name: "You're #2 in AI visibility" })).toBeVisible();
    expect(screen.getByText('Kmart Australia is named more often.')).toBeVisible();
    expect(screen.getByText('Position')).toBeVisible();
    expect(screen.getByText('2.5')).toBeVisible();
    expect(screen.getByText('Not measured')).toBeVisible();
    unmount();

    const unpositioned = {
      ...selected,
      avg_position: null,
      rankings: rankings.map((row) => ({ ...row, avg_position: null })),
    } as Visibility;
    render(<InsightsLede selected={unpositioned} />);
    expect(screen.getByText('Share of voice')).toBeVisible();
    expect(screen.queryByText('Position')).toBeNull();
  });

  it('counts first-named answers only when the win count is known', () => {
    const withWins = (winCount: number | null) =>
      ({
        ...selected,
        rankings: rankings.map((row) =>
          row.is_brand ? { ...row, win_count: winCount, win_answers: 12, win_rate: null } : row,
        ),
      }) as Visibility;
    const { unmount } = render(<InsightsLede selected={withWins(5)} />);
    expect(screen.getByText('Named first in 5 of 12')).toBeVisible();
    unmount();

    render(<InsightsLede selected={withWins(null)} />);
    expect(screen.queryByText(/Named first in/u)).toBeNull();
  });
});

describe('Your brand over time', () => {
  const twoRuns = loaded([
    point('2026-11-01T00:00:00Z', 0.25),
    point('2026-11-03T00:00:00Z', 0.31),
  ]);
  const lineNames = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-end-labels] text, ul[aria-hidden] li span[title]')].map(
      (label) => label.textContent ?? '',
    );

  it('plots a focused brand alone, and falls back to every brand for one this selection never measured', () => {
    window.history.replaceState(null, '', '/insights?brand=Kmart%20Australia');
    const focused = render(<BrandTrend query={twoRuns} selected={selected} />);
    expect(screen.getByRole('button', { name: /Focus.*Kmart Australia/ })).toBeVisible();
    expect(lineNames(focused.container).some((name) => name.startsWith('You'))).toBe(false);
    focused.unmount();

    window.history.replaceState(null, '', '/insights?brand=Ghost');
    const fallback = render(<BrandTrend query={twoRuns} selected={selected} />);
    const roster = lineNames(fallback.container);
    expect(screen.getByRole('button', { name: /Focus.*All brands/ })).toBeVisible();
    expect(roster.some((name) => name.startsWith('You'))).toBe(true);
    expect(roster.some((name) => name.startsWith('Kmart Australia'))).toBe(true);
  });

  it('shows the chart skeleton while the history loads, and the empty state only once it read none', () => {
    const states = (container: HTMLElement) =>
      [...container.querySelectorAll<HTMLElement>('[data-state-block]')].map(
        (block) => block.dataset.stateBlock,
      );
    const pending = {
      data: undefined,
      isPending: true,
      isError: false,
      isSuccess: false,
      isFetching: true,
    } as unknown as UseQueryResult<VisibilityTrendPoint[]>;
    const loading = render(<BrandTrend query={pending} selected={selected} />);
    expect(states(loading.container)).toEqual(['loading']);
    expect(loading.container.querySelector('[data-chart-frame]')).toBeNull();
    loading.unmount();

    const none = render(<BrandTrend query={loaded([])} selected={selected} />);
    expect(states(none.container)).toEqual(['empty']);
  });

  it('plots one run as a point per brand under a key, not a list of values', () => {
    const { container } = render(
      <BrandTrend query={loaded([point('2026-11-17T00:00:00Z', 0.31)])} selected={selected} />,
    );
    expect(container.querySelector('[data-single-measurement]')).toBeNull();
    expect(container.querySelectorAll('[data-trend-point="you"]')).toHaveLength(1);
    expect(lineNames(container)).toEqual(['You', 'Kmart Australia', 'Target Australia']);
    expect(container.querySelectorAll('ul[aria-hidden] li [data-brand-mark]')).toHaveLength(3);
  });

  it('keys each line at the figures precision, not a rounded whole percent', () => {
    const { container } = render(
      <BrandTrend
        query={loaded([point('2026-11-01T00:00:00Z', 0.31), point('2026-11-03T00:00:00Z', 0.025)])}
        selected={selected}
      />,
    );
    const key = [...container.querySelectorAll('ul[aria-hidden] li')].map(
      (item) => item.textContent,
    );
    expect(key).toEqual(['AYou2.5%', 'KKmart Australia60.0%', 'TTarget Australia—']);
  });
});

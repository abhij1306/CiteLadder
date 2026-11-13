import { useQuery } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { typeSlices, type SeriesData } from '@/lib/visibility/sources';
import { renderWithProviders } from '@/test/render';
import { TypesCard, UsageCard } from './source-charts';

function Plot({ data }: Readonly<{ data: SeriesData }>) {
  const query = useQuery({
    queryKey: ['test-source-series', data],
    queryFn: async () => data,
    initialData: data,
  });
  return <UsageCard dimension="domain" query={query} />;
}

function line(key: string, shares: readonly (number | null)[], buckets: readonly string[]) {
  return {
    key,
    citations: 1,
    points: shares.map((share, index) => ({ at: buckets[index] ?? '', responses: 1, share })),
  };
}

const usageTable = () => screen.getByRole('table', { name: 'Source usage by domain' });
const cellsOf = (table: HTMLElement, name: string) =>
  within(within(table).getByRole('rowheader', { name }).closest('tr')!)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);

afterEach(() => vi.unstubAllEnvs());

describe('Source usage chart', () => {
  it('preserves calendar dates in a UTC-negative timezone and passes invalid labels through', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    const buckets = ['2026-01-15T00:00:00Z', '2026-01-16', 'invalid'];
    renderWithProviders(
      <Plot
        data={{
          dimension: 'domain',
          granularity: 'day',
          buckets,
          series: [line('example.test', [0.5], buckets)],
        }}
      />,
    );
    const headers = within(usageTable())
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual(['Series', 'Jan 15', 'Jan 16', 'invalid']);
  });

  it('folds the sources past the third into one Other line, keeping an unmeasured bucket unmeasured', () => {
    const buckets = ['2026-01-15', '2026-01-16', '2026-01-17'];
    renderWithProviders(
      <Plot
        data={{
          dimension: 'domain',
          granularity: 'day',
          buckets,
          series: [
            line('a.test', [0.5, 0.4, null], buckets),
            line('b.test', [0.3, 0.2, null], buckets),
            line('c.test', [0.2, 0, null], buckets),
            line('d.test', [0.1, 0.05, null], buckets),
            line('e.test', [0.05, 0.05, null], buckets),
          ],
        }}
      />,
    );
    const table = usageTable();
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent),
    ).toEqual(['a.test', 'b.test', 'c.test', 'Other']);
    expect(cellsOf(table, 'c.test')).toEqual(['20%', '0%', 'Not measured']);
    expect(cellsOf(table, 'Other')).toEqual(['15%', '10%', 'Not measured']);
  });

  it('keeps four sources as four named lines', () => {
    const buckets = ['2026-01-15'];
    renderWithProviders(
      <Plot
        data={{
          dimension: 'domain',
          granularity: 'day',
          buckets,
          series: ['a.test', 'b.test', 'c.test', 'd.test'].map((key) => line(key, [0.1], buckets)),
        }}
      />,
    );
    expect(
      within(usageTable())
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent),
    ).toEqual(['a.test', 'b.test', 'c.test', 'd.test']);
  });
});

function Types({ totals, total }: Readonly<{ totals: Record<string, number>; total: number }>) {
  const query = useQuery({
    queryKey: ['test-source-types', totals],
    queryFn: async () => totals,
    initialData: totals,
  });
  return <TypesCard slices={typeSlices(totals, 'domain')} total={total} query={query} />;
}

describe('Source types card', () => {
  it('puts your own domains first, then the largest types, and folds the rest into Other', () => {
    renderWithProviders(
      <Types
        totals={{
          brand_owned: 10,
          competitor_owned: 20,
          review_marketplace: 5,
          editorial_third_party: 40,
          community: 15,
          other_third_party: 10,
        }}
        total={100}
      />,
    );
    expect(screen.getByRole('img', { name: /^Source types:/ })).toHaveAccessibleName(
      'Source types: You 10.0%, Editorial 40.0%, Competitor 20.0%, Other 30.0%',
    );
  });

  it('shares citations that belong to no type as an unclassified remainder of the declared total', () => {
    renderWithProviders(<Types totals={{ brand_owned: 30, community: 30 }} total={80} />);
    expect(screen.getByRole('img', { name: /^Source types:/ })).toHaveAccessibleName(
      'Source types: You 37.5%, UGC 37.5%, Unclassified 25.0%',
    );
  });

  it('says the selection holds no citations instead of drawing an empty donut', () => {
    renderWithProviders(<Types totals={{}} total={0} />);
    expect(screen.getByText('No citations in this selection.')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Source types/ })).not.toBeInTheDocument();
  });
});

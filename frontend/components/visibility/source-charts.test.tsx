import { useQuery } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { SeriesData } from '@/lib/visibility/sources';
import { renderWithProviders } from '@/test/render';
import { UsageCard } from './source-charts';

vi.mock('@/components/ui/series-chart', () => ({
  SeriesChart: ({ labels }: { labels: string[] }) => (
    <output aria-label="Bucket dates">{labels.join(', ')}</output>
  ),
}));

const data: SeriesData = {
  dimension: 'domain',
  granularity: 'day',
  buckets: ['2026-01-15T00:00:00Z', '2026-01-16', 'invalid'],
  series: [
    {
      key: 'example.test',
      citations: 2,
      points: [{ at: '2026-01-15T00:00:00Z', responses: 2, share: 0.5 }],
    },
  ],
};
function Plot() {
  const query = useQuery({
    queryKey: ['test-source-series'],
    queryFn: async () => data,
    initialData: data,
  });
  return <UsageCard dimension="domain" query={query} />;
}

afterEach(() => vi.unstubAllEnvs());

describe('Source bucket dates', () => {
  it('preserves calendar dates in a UTC-negative timezone and passes invalid labels through', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    renderWithProviders(<Plot />);
    const label = screen.getByLabelText('Bucket dates');
    expect(label).toHaveTextContent('Jan 15');
    expect(label).toHaveTextContent('Jan 16');
    expect(label).toHaveTextContent('invalid');
  });
});

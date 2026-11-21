import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { METRIC_MARKS, PerformanceChart, type ChartSeries } from './performance-chart';

const day = (index: number, date: string | null, value: number | null) => ({
  index,
  date,
  value,
});

const clicks: ChartSeries = {
  key: 'clicks',
  label: 'Clicks',
  mark: METRIC_MARKS.clicks,
  selected: [day(1, '2026-07-01', 12), day(2, '2026-07-02', null), day(3, '2026-07-03', 30)],
  comparison: [day(1, '2026-06-01', 10), day(2, '2026-06-02', 14), day(3, '2026-06-03', null)],
};

const position: ChartSeries = {
  key: 'position',
  label: 'Average position',
  mark: METRIC_MARKS.position,
  selected: [day(1, '2026-07-01', 8.4), day(2, '2026-07-02', 7.25), day(3, '2026-07-03', 6)],
  comparison: null,
};

const rows = (name: string) =>
  within(screen.getByRole('table', { name }))
    .getAllByRole('row')
    .map((row) => row.textContent);

describe('PerformanceChart', () => {
  it('draws one chart per metric on its own scale, naming each comparison day and a missing bucket', () => {
    render(<PerformanceChart series={[clicks, position]} />);
    expect(rows('Clicks over 3 days, with comparison period')).toEqual([
      'SeriesJul 1, 2026 · vs Jun 1, 2026Jul 2, 2026 · vs Jun 2, 2026Jul 3, 2026 · vs Jun 3, 2026',
      'Clicks12Not measured30',
      'Clicks (comparison)1014Not measured',
    ]);
    expect(rows('Average position over 3 days')).toEqual([
      'SeriesJul 1, 2026Jul 2, 2026Jul 3, 2026',
      'Average position8.47.36.0',
    ]);
  });

  it('keeps the days of a comparison longer than the selection', () => {
    render(
      <PerformanceChart
        series={[
          {
            ...clicks,
            selected: [day(1, '2026-07-01', 12)],
            comparison: [day(1, '2026-06-01', 10), day(2, '2026-06-02', 14)],
          },
        ]}
      />,
    );
    expect(rows('Clicks over 2 days, with comparison period')).toEqual([
      'SeriesJul 1, 2026 · vs Jun 1, 2026Day 2 · vs Jun 2, 2026',
      'Clicks12Not measured',
      'Clicks (comparison)1014',
    ]);
  });

  it('states which absence it is when nothing can be plotted', () => {
    const { rerender } = render(<PerformanceChart series={[]} />);
    expect(screen.getByText('Select a figure above to chart it.')).toBeVisible();

    rerender(<PerformanceChart series={[{ ...clicks, selected: [], comparison: null }]} />);
    expect(screen.getByText('No measured days in the selected range.')).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

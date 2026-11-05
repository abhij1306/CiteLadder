import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vite-plus/test';

import { PerformanceChart, type ChartSeries } from './performance-chart';

const day = (index: number, date: string | null, value: number | null) => ({
  index,
  date,
  value,
});

const clicks: ChartSeries = {
  key: 'clicks',
  label: 'Clicks',
  tone: 1,
  selected: [day(1, '2026-07-01', 12), day(2, '2026-07-02', null), day(3, '2026-07-03', 30)],
  comparison: [day(1, '2026-06-01', 10), day(2, '2026-06-02', 14), day(3, '2026-06-03', null)],
};

const position: ChartSeries = {
  key: 'position',
  label: 'Average position',
  tone: 4,
  selected: [day(1, '2026-07-01', 8.4), day(2, '2026-07-02', 7.25), day(3, '2026-07-03', 6)],
  comparison: null,
};

const rows = (name: string) =>
  within(screen.getByRole('table', { name }))
    .getAllByRole('row')
    .map((row) => row.textContent);

describe('PerformanceChart', () => {
  it('tabulates every metric, comparison value and date, naming a missing bucket rather than zero', () => {
    render(<PerformanceChart series={[clicks, position]} />);
    expect(rows('Clicks, Average position over 3 days, with comparison period')).toEqual([
      'SeriesDay 1 · 2026-07-01Day 2 · 2026-07-02Day 3 · 2026-07-03',
      'Clicks12Not measured30',
      'Clicks (comparison)1014Not measured',
      'Average position8.47.36.0',
      'Comparison day2026-06-012026-06-022026-06-03',
    ]);
  });

  it('reads each day with the arrow keys: every value, its comparison peer and both dates', async () => {
    const user = userEvent.setup();
    render(<PerformanceChart series={[clicks, position]} />);

    await user.tab();
    expect(
      screen.getByRole('group', {
        name: 'Clicks, Average position over 3 days, with comparison period. Use the left and right arrow keys to read each point.',
      }),
    ).toHaveFocus();

    // From the latest day: right holds there, left steps back.
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('Day 3 · 2026-07-03', { selector: 'p' })).toBeVisible();
    expect(screen.getByText('30 vs Not measured')).toBeVisible();
    expect(screen.getByText('Comparison day · 2026-06-03')).toBeVisible();

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByText('Day 2 · 2026-07-02', { selector: 'p' })).toBeVisible();
    expect(screen.getByText('Not measured vs 14')).toBeVisible();

    await user.keyboard('{Escape}');
    expect(screen.queryByText('Day 2 · 2026-07-02', { selector: 'p' })).toBeNull();
  });

  it('breaks a line at an unmeasured bucket instead of joining across it', () => {
    const { container } = render(<PerformanceChart series={[{ ...clicks, comparison: null }]} />);
    const path = container.querySelector('[data-performance-line="selected"] path');
    // Day 2 is missing, so the pen lifts: two separate runs, each a lone dot.
    expect(path?.getAttribute('d')?.split('M').length).toBe(3);
    expect(container.querySelectorAll('[data-performance-line="selected"] circle')).toHaveLength(2);
  });

  it('states which absence it is when nothing can be plotted', () => {
    const { rerender } = render(<PerformanceChart series={[]} />);
    expect(screen.getByText('No metrics selected')).toBeVisible();

    rerender(<PerformanceChart series={[{ ...clicks, selected: [], comparison: null }]} />);
    expect(screen.getByText('No measured buckets in the selected range')).toBeVisible();
    expect(screen.queryByRole('group')).toBeNull();
  });
});

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vite-plus/test';

import { StepChart } from './step-chart';
import { SeriesTonesContext, areaPath, seriesTones } from './step-chart-parts';

const rows = (name: string) =>
  within(screen.getByRole('table', { name }))
    .getAllByRole('row')
    .map((row) => row.textContent);

const runsOf = (container: HTMLElement, tone = 'you') =>
  (container
    .querySelector(`[data-trend-line="${tone}"] path[fill="none"]`)
    ?.getAttribute('d')
    ?.split('M').length ?? 1) - 1;

describe('StepChart', () => {
  it('tabulates every line and value, naming a missing value rather than zero', () => {
    render(
      <StepChart
        label="Visibility trend"
        name="You"
        data={[
          { label: 'Jun', value: 40 },
          { label: 'Jul', value: null },
        ]}
        series={[{ label: 'Globex', values: [30, 35] }]}
        yFormat={(value) => `${value}%`}
      />,
    );
    expect(rows('Visibility trend')).toEqual([
      'SeriesJunJul',
      'You40%Not measured',
      'Globex30%35%',
    ]);
    expect(
      screen.getByText(
        /^Visibility trend\. You: 40% on Jun to 40% on Jun; Globex: 30% on Jun to 35% on Jul\.$/,
      ),
    ).toBeInTheDocument();
  });

  it('joins measurements with straight segments and shows a missing period as a band, never a bridge', () => {
    const { container } = render(
      <StepChart
        label="Mention rate"
        data={[
          { label: 'Jun', value: 40 },
          { label: 'Jul', value: 50 },
          { label: 'Aug', value: null },
          { label: 'Sep', value: 60 },
          { label: 'Oct', value: 70, breakBefore: true },
        ]}
      />,
    );
    const path =
      container.querySelector('[data-trend-line="you"] path[fill="none"]')?.getAttribute('d') ?? '';
    expect(path).not.toMatch(/[HVC]/);
    expect(runsOf(container)).toBe(3);
    expect(container.querySelector('[data-gap-bands]')).toHaveTextContent('No reading');
    expect(container.querySelectorAll('[data-gap-bands] rect')).toHaveLength(1);
    expect(container.querySelectorAll('[data-trend-line="you"] circle')).toHaveLength(4);
    expect(container.querySelectorAll('[data-you-fill]')).toHaveLength(1);
  });

  it('fills the area under each run of two or more points, down to the floor', () => {
    expect(areaPath([[0, 10], [10, 5], null, [20, 5]], 50)).toBe(
      'M0.0 50.0L0.0 10.0L10.0 5.0L10.0 50.0Z',
    );
  });

  it('colours a rival by who it is, so it keeps one colour across a page', () => {
    const chart = (rival: string) => (
      <SeriesTonesContext value={seriesTones(['Globex', 'Initech'])}>
        <StepChart
          label="Share"
          name="You"
          data={[
            { label: 'Jun', value: 10 },
            { label: 'Jul', value: 90 },
          ]}
          series={[{ label: rival, values: [20, 10] }]}
        />
      </SeriesTonesContext>
    );
    const { container, rerender } = render(chart('Initech'));
    const tones = () =>
      [...container.querySelectorAll('[data-trend-line]')].map((line) =>
        line.getAttribute('data-trend-line'),
      );
    expect(tones()).toEqual(['rival-2', 'you']);
    rerender(chart('Globex'));
    expect(tones()).toEqual(['rival-1', 'you']);
  });

  it('prints one measurement as compact rows under one date, not as a chart', () => {
    const { container } = render(
      <StepChart
        label="Share"
        name="You"
        data={[{ label: '1 Jun 2026', value: 10 }]}
        series={[{ label: 'Globex', values: [null] }]}
        yFormat={(value) => `${value}%`}
      />,
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(
      within(screen.getByRole('list', { name: 'Share' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['You10%', 'Globex—Not measured']);
    expect(screen.getAllByText('Measured 1 Jun 2026')).toHaveLength(1);
    expect(container.querySelector('[data-chart-frame]')?.getAttribute('data-chart-frame')).toBe(
      'auto',
    );
  });

  it('names lines at their end, and falls back to a key when the names would collide', () => {
    const { container, rerender } = render(
      <StepChart
        label="Share"
        name="You"
        data={[
          { label: 'Jun', value: 10 },
          { label: 'Jul', value: 90 },
        ]}
        series={[{ label: 'Globex', values: [20, 10] }]}
      />,
    );
    const labels = () =>
      [...container.querySelectorAll('[data-end-labels] text')].map((node) => node.textContent);
    expect(labels()).toEqual(['You 90', 'Globex 10']);
    expect(container.querySelector('ul[aria-hidden]')).toBeNull();
    const shapes = () =>
      [...container.querySelectorAll('[data-trend-line]')].map((line) => [
        line.getAttribute('data-trend-line'),
        line.querySelector('[data-marker-shape]')?.getAttribute('data-marker-shape'),
      ]);
    expect(shapes()).toEqual([
      ['rival-1', 'circle'],
      ['you', 'circle'],
    ]);

    rerender(
      <StepChart
        label="Share"
        name="You"
        data={[
          { label: 'Jun', value: 10 },
          { label: 'Jul', value: 50 },
        ]}
        series={[{ label: 'Globex', values: [20, 51] }]}
      />,
    );
    expect(labels()).toEqual([]);
    expect(container.querySelector('ul[aria-hidden]')).toHaveTextContent('You50Globex51');
    expect(shapes()).toEqual([
      ['rival-1', 'square'],
      ['you', 'circle'],
    ]);
  });

  it('dates a value older than the last point, and keys every line when one has nothing to label', () => {
    const { container, rerender } = render(
      <StepChart
        label="Share"
        name="You"
        data={[
          { label: '1 Jun 2026', axisLabel: 'Jun', value: 10 },
          { label: '1 Jul 2026', axisLabel: 'Jul', value: null },
        ]}
        series={[{ label: 'Globex', values: [80, 90] }]}
      />,
    );
    const labels = () =>
      [...container.querySelectorAll('[data-end-labels] text')].map((node) => node.textContent);
    expect(labels()).toEqual(['Globex 90', 'You 10 · as of Jun']);
    expect(container.querySelector('ul[aria-hidden]')).toBeNull();

    rerender(
      <StepChart
        label="Share"
        name="You"
        data={[
          { label: '1 Jun 2026', axisLabel: 'Jun', value: 10 },
          { label: '1 Jul 2026', axisLabel: 'Jul', value: 20 },
        ]}
        series={[{ label: 'Globex', values: [null, null] }]}
      />,
    );
    expect(labels()).toEqual([]);
    expect(container.querySelector('ul[aria-hidden]')).toHaveTextContent('You20Globex—');
  });

  it('draws your line in the accent unless the chart has no "you"', () => {
    const data = [
      { label: 'Jun', value: 1 },
      { label: 'Jul', value: 2 },
    ];
    const { container, rerender } = render(<StepChart label="Sessions" data={data} />);
    expect(container.querySelector('[data-trend-line="you"]')).not.toBeNull();
    rerender(<StepChart label="Sessions" data={data} you={false} />);
    expect(container.querySelector('[data-trend-line="you"]')).toBeNull();
    expect(container.querySelector('[data-trend-line="rival-1"]')).not.toBeNull();
  });

  it('ticks the events inside the plotted span, one counted marker per moment, and lists them', () => {
    const day = (date: string) => new Date(`${date}T00:00:00Z`).getTime();
    const { container } = render(
      <StepChart
        label="Mention rate"
        data={[
          { label: '1 Mar', value: 40, timestamp: day('2026-03-01') },
          {
            label: '15 Mar',
            value: 70,
            timestamp: day('2026-03-15'),
            versionChange: { note: 'Scoring rule scoring-v2 applied' },
          },
        ]}
        events={[
          { key: 'inside', timestamp: day('2026-03-05'), label: 'Implemented: reviews page' },
          { key: 'model', timestamp: day('2026-03-05'), label: 'Model changed', kind: 'model' },
          { key: 'before', timestamp: day('2026-02-01'), label: 'Implemented: old page' },
        ]}
        eventLegend
      />,
    );
    expect(
      [...container.querySelectorAll('[data-event-marker]')].map((marker) => marker.textContent),
    ).toEqual(['2']);
    expect(
      within(screen.getByRole('list', { name: 'Mention rate: marked' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Method changed at 15 Mar: Scoring rule scoring-v2 applied',
      'Implemented: reviews page',
      'Model changed',
    ]);
  });

  it('reads any point with the arrow keys in a tooltip sheet', async () => {
    const user = userEvent.setup();
    render(
      <StepChart
        label="Visibility trend"
        data={[
          { label: '1 Jun 2026', value: 40 },
          { label: '1 Jul 2026', value: 70 },
        ]}
      />,
    );
    await user.tab();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByText('1 Jun 2026', { selector: 'p' })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByText('1 Jun 2026', { selector: 'p' })).toBeNull();
  });
});

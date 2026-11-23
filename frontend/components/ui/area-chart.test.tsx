import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vite-plus/test';

import { AreaChart } from './area-chart';
import {
  breakBridges,
  chartRows,
  distinctTicks,
  eventsInSpan,
  gapRanges,
  niceTicks,
} from './area-chart-data';
import { roleColor } from './chart-tooltip';
import { SeriesTonesContext, seriesTones } from './step-chart-parts';

const points = (container: HTMLElement, tone: string) =>
  container.querySelectorAll(`[data-trend-point="${tone}"]`).length;

describe('AreaChart data', () => {
  it('ends every line at a point not comparable with the one before', () => {
    const rows = chartRows(
      [
        { label: 'Jun', value: 40 },
        { label: 'Jul', value: 50, breakBefore: true },
      ],
      [{ values: [40, 50] }, { values: [30, null] }],
    );
    expect(rows).toEqual([
      { x: 0, index: 0, break: false, l0: 40, l1: 30 },
      { x: 0.5, index: -1, break: true },
      { x: 1, index: 1, break: false, l0: 50, l1: null },
    ]);
  });

  it('bridges a break only between two measured points', () => {
    const data = [
      { label: 'a', value: 40, timestamp: 100 },
      { label: 'b', value: 50, timestamp: 200, breakBefore: true },
      { label: 'c', value: 60, timestamp: 300 },
      { label: 'd', value: 70, timestamp: 400, breakBefore: true },
    ];
    expect(breakBridges([40, 50, null, 70], data)).toEqual([
      { from: { x: 100, y: 40 }, to: { x: 200, y: 50 } },
    ]);
  });

  it('labels a run of same-day points once', () => {
    const label = new Map([
      [1, 'Nov 22'],
      [2, 'Nov 23'],
      [3, 'Nov 23'],
      [4, 'Nov 24'],
    ]);
    expect(distinctTicks([1, 2, 3, 4], (x) => label.get(x))).toEqual([1, 2, 4]);
  });

  it('widens a missing run halfway to its neighbours, and half a step at an end', () => {
    expect(gapRanges([40, null, null, 60, null], [0, 10, 20, 30, 40])).toEqual([
      { from: 5, to: 25 },
      { from: 35, to: 45 },
    ]);
    expect(gapRanges([40, 50], [0, 10])).toEqual([]);
  });

  it('puts y ticks on round steps from zero, keeping a given bound', () => {
    expect(niceTicks({ values: [96, 251] })).toEqual([0, 100, 200, 300]);
    expect(niceTicks({ values: [4199, 5600] })).toEqual([0, 2000, 4000, 6000]);
    expect(niceTicks({ values: [40], yMin: 0, yMax: 100 })).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks({ values: [3], yMin: 1, yMax: 10 })).toEqual([1, 2.5, 5, 7.5, 10]);
  });

  it('keeps only the events inside a timed span', () => {
    const data = [
      { label: 'a', value: 1, timestamp: 100 },
      { label: 'b', value: 2, timestamp: 200 },
    ];
    const events = [
      { key: 'in', timestamp: 150, label: 'Shipped' },
      { key: 'out', timestamp: 250, label: 'Later' },
    ];
    expect(eventsInSpan(data, events).map((event) => event.key)).toEqual(['in']);
    expect(
      eventsInSpan(
        [
          { label: 'a', value: 1 },
          { label: 'b', value: 2 },
        ],
        events,
      ),
    ).toEqual([]);
  });

  it('reads the colour role a class names, a current fill taking its text role', () => {
    expect(roleColor('fill-positive bg-positive', 'fill')).toBe('var(--color-positive)');
    expect(roleColor('fill-current text-negative bg-negative', 'fill')).toBe(
      'var(--color-negative)',
    );
    expect(roleColor('stroke-data-other', 'stroke')).toBe('var(--color-data-other)');
  });
});

describe('AreaChart', () => {
  it('tabulates every line and names each in the key with its latest value', () => {
    render(
      <AreaChart
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
    expect(
      within(screen.getByRole('table', { name: 'Visibility trend' }))
        .getAllByRole('row')
        .map((row) => row.textContent),
    ).toEqual(['SeriesJunJul', 'You40%Not measured', 'Globex30%35%']);
    expect(
      [...document.querySelectorAll('ul[aria-hidden] li')].map((item) => item.textContent),
    ).toEqual(['You40% · as of Jun', 'Globex35%']);
  });

  it('marks a rival by who it is and draws no point where a line went unmeasured', () => {
    const { container } = render(
      <SeriesTonesContext value={seriesTones(['Globex', 'Initech'])}>
        <AreaChart
          label="Mentions"
          data={[
            { label: 'Jun', value: 40 },
            { label: 'Jul', value: 50 },
            { label: 'Aug', value: 55 },
          ]}
          series={[{ label: 'Initech', values: [null, 20, null] }]}
        />
      </SeriesTonesContext>,
    );
    expect(points(container, 'you')).toBe(3);
    expect(points(container, 'rival-2')).toBe(1);
    expect(points(container, 'rival-1')).toBe(0);
  });

  it('prints one period as rows of values, not a chart', () => {
    const { container } = render(
      <AreaChart label="Mentions" name="You" data={[{ label: '1 Jun 2026', value: 40 }]} />,
    );
    expect(container.querySelector('[data-single-measurement]')).not.toBeNull();
    expect(container.querySelector('.recharts-surface')).toBeNull();
    expect(screen.getByText('Measured 1 Jun 2026')).toBeVisible();
  });

  it('says why there is no chart when no line was ever measured', () => {
    const { container, rerender } = render(
      <AreaChart
        label="Net sentiment"
        name="Net"
        empty="Too few mentions"
        data={[
          { label: 'Jun', value: null },
          { label: 'Jul', value: null },
        ]}
      />,
    );
    expect(screen.getByText('Too few mentions')).toBeVisible();
    expect(container.querySelector('[role="group"]')).toBeNull();
    rerender(
      <AreaChart
        label="Net sentiment"
        name="Net"
        empty="Too few mentions"
        data={[
          { label: 'Jun', value: null },
          { label: 'Jul', value: 10 },
        ]}
      />,
    );
    expect(screen.queryByText('Too few mentions')).toBeNull();
    expect(container.querySelector('[role="group"]')).not.toBeNull();
  });

  it('reads a point with the arrow keys in a tooltip card', async () => {
    const user = userEvent.setup();
    render(
      <AreaChart
        label="Visibility trend"
        name="You"
        data={[
          { label: '1 Jun 2026', value: 40 },
          { label: '1 Jul 2026', value: 70 },
        ]}
      />,
    );
    expect(screen.queryByText('1 Jul 2026', { selector: 'p' })).toBeNull();
    await user.tab();
    await user.keyboard('{ArrowRight}');
    const card = screen.getByText('1 Jul 2026', { selector: 'p' }).parentElement;
    expect(card).toHaveTextContent('1 Jul 2026You70');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByText('1 Jun 2026', { selector: 'p' }).parentElement).toHaveTextContent(
      '1 Jun 2026You40',
    );
  });
});

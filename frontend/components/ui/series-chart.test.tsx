import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { SeriesChart } from './series-chart';

const series = [
  {
    key: 'example',
    label: 'example.test',
    strokeClass: 'stroke-chart-1',
    swatchClass: 'bg-chart-1',
    color: 'var(--color-chart-1)',
    points: [
      { value: 20, label: 'Jan 15' },
      { value: 40, label: 'Jan 16' },
    ],
  },
];

describe('Series chart loading', () => {
  it('holds the plot box before the drawing arrives, then draws into that same box', async () => {
    const { container } = render(
      <SeriesChart series={series} labels={['Jan 15', 'Jan 16']} size="lg" />,
    );

    // The legend and the reading for assistive technology do not wait for
    // the chart library.
    expect(screen.getByRole('button', { name: 'example.test' })).toBeInTheDocument();
    const description = screen.getByText('example.test: from 20% to 40%');
    const box = description.nextElementSibling;
    expect(box).toBeEmptyDOMElement();

    // The drawing fills the box that was already there; nothing replaces it.
    // The first import transforms the chart library, so it gets a cold budget.
    await waitFor(
      () => expect(box?.querySelector('.recharts-responsive-container')).toBeInTheDocument(),
      { timeout: 15_000 },
    );
    expect(description.nextElementSibling).toBe(box);
    expect(container.querySelectorAll('.recharts-responsive-container')).toHaveLength(1);
  }, 20_000);
});

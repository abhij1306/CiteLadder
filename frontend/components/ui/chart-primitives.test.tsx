import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vite-plus/test';

import { DonutChart } from './donut-chart';
import { Sparkline } from './sparkline';
import { StackedBar } from './stacked-bar';

describe('DonutChart', () => {
  const slices = [
    { name: 'CiteLadder', value: 50 },
    { name: 'Acme', value: 30 },
    { name: 'Other', value: 20, other: true },
  ];

  it('names every share in the figure and lists each share and count in the legend', () => {
    render(<DonutChart slices={slices} totalLabel="Mentions" label="Share of voice" />);
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Share of voice: CiteLadder 50.0%, Acme 30.0%, Other 20.0%',
    );
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent);
    expect(rows).toEqual(['CiteLadder50.0%50', 'Acme30.0%30', 'Other20.0%20']);
  });

  it('shows the total in the centre, and a hovered or focused row’s share in its place', async () => {
    const user = userEvent.setup();
    render(<DonutChart slices={slices} totalLabel="Mentions" total={1240} />);
    const figure = screen.getByRole('img');
    const [brand] = screen.getAllByRole('button');
    expect(figure).toHaveTextContent('1,240Mentions');
    fireEvent.mouseEnter(brand!);
    expect(figure).toHaveTextContent('50.0%CiteLadder');
    fireEvent.mouseLeave(brand!);
    expect(figure).toHaveTextContent('1,240Mentions');
    await user.tab();
    await user.tab();
    expect(figure).toHaveTextContent('30.0%Acme');
  });

  it('lists the part of a declared total no slice covers as its own remainder', () => {
    render(
      <DonutChart
        slices={[{ name: 'Editorial', value: 40 }]}
        total={50}
        totalLabel="Citations"
        remainderLabel="Unclassified"
        label="Source types"
      />,
    );
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Source types: Editorial 80.0%, Unclassified 20.0%',
    );
    expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'Editorial80.0%40',
      'Unclassified20.0%10',
    ]);
  });
});

describe('StackedBar', () => {
  it('names each part with its share and count', () => {
    render(
      <StackedBar
        label="Answers by engine"
        segments={[
          { label: 'ChatGPT', value: 60 },
          { label: 'Claude', value: 30 },
          { label: 'Other', value: 10, other: true },
        ]}
      />,
    );
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Answers by engine: ChatGPT 60.0% (60), Claude 30.0% (30), Other 10.0% (10)',
    );
  });

  it('keeps the part of a declared total no segment covers as its own remainder', () => {
    render(
      <StackedBar label="Source types" total={50} segments={[{ label: 'Editorial', value: 40 }]} />,
    );
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Source types: Editorial 80.0% (40), Unclassified 20.0% (10)',
    );
  });
});

describe('Sparkline', () => {
  it('is a named image when labelled and hidden when a number sits beside it', () => {
    const { rerender } = render(
      <Sparkline values={[1, 3, null, 2]} tone="accent" label="Mentions, last 4 weeks" />,
    );
    expect(screen.getByRole('img')).toHaveAccessibleName('Mentions, last 4 weeks');
    rerender(<Sparkline values={[1, 3, null, 2]} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('leaves a gap for an unmeasured value instead of drawing it at the bottom', () => {
    render(<Sparkline values={[0, null, 10]} label="Trend" />);
    const path = screen.getByRole('img').querySelector('path')!;
    expect(path.getAttribute('d')).toBe('M3.0 21.0M77.0 3.0');
  });
});

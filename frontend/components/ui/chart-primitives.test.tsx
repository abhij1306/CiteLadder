import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { Sparkline } from './sparkline';
import { StackedBar } from './stacked-bar';

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

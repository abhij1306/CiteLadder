import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { seriesColor } from './chart-tooltip';
import { PartDonut } from './part-donut';
import { Sparkline } from './sparkline';
import { type SERIES_STROKE, SeriesTonesContext, seriesTones } from './step-chart-parts';

describe('seriesColor', () => {
  it('names a variable globals.css emits for every tone, so a script-drawn series has a colour', () => {
    const css = readFileSync(join(import.meta.dirname, '../../apps/app/src/globals.css'), 'utf8');
    const emitted = css.replaceAll(/@theme inline \{[^}]*\}/g, '');
    const tones = ['you', 'rival-1', 'rival-2', 'rival-3', 'rival-4', 'other'] satisfies Array<
      keyof typeof SERIES_STROKE
    >;
    const missing = tones
      .map((tone) => /var\((--[\w-]+)\)/.exec(seriesColor(tone))?.[1])
      .filter((name) => !name || !emitted.includes(`${name}:`));
    expect(missing).toEqual([]);
  });
});

const rows = (name: string) =>
  within(screen.getByRole('table', { name }))
    .getAllByRole('row')
    .map((row) => [...row.children].map((cell) => cell.textContent));

describe('PartDonut', () => {
  it('names every part with its share and count, and gives you the accent', () => {
    const { container } = render(
      <PartDonut
        label="Source types"
        parts={[
          { label: 'Your site', value: 60, you: true },
          { label: 'Editorial', value: 30 },
          { label: 'Other', value: 10, other: true },
        ]}
      />,
    );
    expect(rows('Source types')).toEqual([
      ['Series', 'Share', 'Value'],
      ['Your site', '60.0%', '60'],
      ['Editorial', '30.0%', '30'],
      ['Other', '10.0%', '10'],
    ]);
    expect(
      [...container.querySelectorAll('[data-part]')].map((part) => part.getAttribute('data-part')),
    ).toEqual(['you', 'rival-1', 'other']);
  });

  it('colours a rival part by who it is when the page names its rivals', () => {
    const { container } = render(
      <SeriesTonesContext value={seriesTones(['Globex', 'Initech'])}>
        <PartDonut
          label="Share"
          parts={[
            { label: 'Your site', value: 60, you: true },
            { label: 'Initech', value: 30 },
            { label: 'Other', value: 10, other: true },
          ]}
        />
      </SeriesTonesContext>,
    );
    expect(
      [...container.querySelectorAll('[data-part]')].map((part) => part.getAttribute('data-part')),
    ).toEqual(['you', 'rival-2', 'other']);
  });

  it('keeps the part of a declared total no segment covers as its own remainder', () => {
    render(
      <PartDonut
        label="Source types"
        total={50}
        totalLabel="citations"
        parts={[{ label: 'Editorial', value: 40 }]}
      />,
    );
    expect(rows('Source types: 50 citations')).toEqual([
      ['Series', 'Share', 'Value'],
      ['Editorial', '80.0%', '40'],
      ['Unclassified', '20.0%', '10'],
    ]);
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

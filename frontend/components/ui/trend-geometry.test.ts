import { describe, expect, it } from 'vite-plus/test';

import { labelledIndexes, trendScale } from './trend-geometry';

const DAY = 86_400_000;

/** A 400px chart whose tick labels are three characters wide (a 36px gutter). */
function scaleOf(count: number, width = 400) {
  return trendScale({
    width,
    height: 200,
    lines: [Array.from({ length: count }, () => 0.3)],
    timestamps: Array.from({ length: count }, (_, index) => index * DAY),
    tickWidth: () => 3,
  });
}

describe('trendScale', () => {
  it('keeps the first and last of two runs inside the plot, each with its date', () => {
    const scale = scaleOf(2);
    // The plot runs from 36 to 376; each end point sits 32px inside it.
    expect([scale.x(0), scale.x(1)]).toEqual([68, 344]);
    expect(labelledIndexes(scale, 2)).toEqual([0, 1]);
  });

  it('spreads many runs between the same insets, by time', () => {
    const scale = scaleOf(5);
    expect([0, 1, 2, 3, 4].map(scale.x)).toEqual([68, 137, 206, 275, 344]);
    expect(scale.xAt(0.5)).toBe(206);
  });

  it('uses the whole width of a plot too narrow for the insets', () => {
    const scale = scaleOf(2, 160);
    expect([scale.x(0), scale.x(1)]).toEqual([36, 136]);
  });
});

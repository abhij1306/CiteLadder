import { describe, expect, it } from 'vite-plus/test';

import { labelledIndexes, trendScale } from './trend-geometry';

const DAY = 86_400_000;

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
    expect([scale.x(0), scale.x(1)]).toEqual([68, 344]);
    expect(labelledIndexes(scale, 2)).toEqual([0, 1]);
  });

  it('spreads many runs between the same insets, by time', () => {
    const scale = scaleOf(5);
    expect([0, 1, 2, 3, 4].map(scale.x)).toEqual([68, 137, 206, 275, 344]);
    expect(scale.xAt(0.5)).toBe(206);
  });

  it('places measurements by date, so an uneven gap looks uneven', () => {
    const scale = trendScale({
      width: 400,
      height: 200,
      lines: [[1, 2, 3]],
      timestamps: [0, 1 * DAY, 4 * DAY],
      tickWidth: () => 3,
    });
    expect([0, 1, 2].map(scale.x)).toEqual([68, 137, 344]);
  });

  it('draws at most the gridlines it is allowed, the floor included', () => {
    const ticks = (maxTicks?: number) =>
      trendScale({
        width: 400,
        height: 200,
        lines: [[0, 87]],
        timestamps: [0, DAY],
        tickWidth: () => 3,
        tickCount: 5,
        maxTicks,
      }).ticks;
    expect(ticks()).toEqual([0, 20, 40, 60, 80, 100]);
    expect(ticks(4)).toEqual([0, 50, 100]);
  });

  it('uses the whole width of a plot too narrow for the insets', () => {
    const scale = scaleOf(2, 160);
    expect([scale.x(0), scale.x(1)]).toEqual([36, 136]);
  });

  it('puts the tick gutter and the top inset on the 4px grid', () => {
    const scale = trendScale({
      width: 400,
      height: 200,
      lines: [[1]],
      timestamps: [0],
      tickWidth: () => 5,
    });
    expect([scale.padLeft, scale.padTop, scale.plotHeight]).toEqual([52, 12, 156]);
  });
});

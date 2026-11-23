import { describe, expect, it } from 'vite-plus/test';

import { breakNote, chartTipLeft } from './chart-frame';

describe('chartTipLeft', () => {
  it('sits 16 right of the crosshair on whole pixels, flips left near the edge and stays 8 inside', () => {
    expect(chartTipLeft(81.6, 600)).toBe(98);
    expect(chartTipLeft(500.4, 600)).toBe(268);
    expect(chartTipLeft(120, 240)).toBe(8);
    expect(chartTipLeft(-40, 600)).toBe(8);
  });
});

describe('breakNote', () => {
  it('explains a gap and a restarted line, and says nothing about an unbroken series', () => {
    const points = [{}, {}, {}];
    expect(breakNote(points, [{ values: [1, 2, 3] }, { values: [null, 2, null] }])).toBeNull();
    expect(breakNote(points, [{ values: [1, null, 3] }])).toBe(
      'A gap is a period with no reading.',
    );
    const broken = [{}, { breakBefore: true }, {}];
    expect(breakNote(broken, [{ values: [1, null, 3] }])).toBe(
      'A gap is a period with no reading. A line starts again where the measurement conditions changed.',
    );
    expect(breakNote(broken, [{ values: [1, null, 3] }], true)).toBe(
      'A gap is a period with no reading.',
    );
    expect(breakNote(broken, [{ values: [1, 2, 3] }], true)).toBe(
      'A dashed line joins runs measured under different conditions.',
    );
  });
});

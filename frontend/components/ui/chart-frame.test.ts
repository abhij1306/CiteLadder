import { describe, expect, it } from 'vite-plus/test';

import { chartTipLeft } from './chart-frame';

describe('chartTipLeft', () => {
  it('sits 16 right of the crosshair on whole pixels, flips left near the edge and stays 8 inside', () => {
    expect(chartTipLeft(81.6, 600)).toBe(98);
    expect(chartTipLeft(500.4, 600)).toBe(268);
    expect(chartTipLeft(120, 240)).toBe(8);
    expect(chartTipLeft(-40, 600)).toBe(8);
  });
});

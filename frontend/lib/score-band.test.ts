import { describe, expect, it } from 'vite-plus/test';

import { scoreBand } from './score-band';

describe('scoreBand', () => {
  it('bands a score at its boundaries', () => {
    expect(scoreBand(49)).toBe('low');
    expect(scoreBand(50)).toBe('mid');
    expect(scoreBand(79)).toBe('mid');
    expect(scoreBand(80)).toBe('high');
  });
});

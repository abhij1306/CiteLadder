import { describe, expect, it } from 'vite-plus/test';
import { coverageLine, formatNet, stateCopy, themeLabel } from './perception';

describe('perception display', () => {
  it('signs net sentiment and keeps a missing value missing', () => {
    expect([formatNet(33.4), formatNet(-12.6), formatNet(0), formatNet(null)]).toEqual([
      '+33',
      '-13',
      '0',
      null,
    ]);
  });

  it('names every coverage bucket that holds a mention', () => {
    expect(
      coverageLine({
        mentions: 10,
        classified: 6,
        pending: 0,
        not_assessable: 1,
        low_confidence: 2,
        unavailable: [{ reason: 'model_not_configured', count: 1 }],
      }),
    ).toBe(
      '6 of 10 mentions classified · 2 low confidence · 1 not assessable · 1 unavailable (classifier not set up)',
    );
  });

  it('explains an unavailable read by its reason', () => {
    expect(stateCopy('unavailable', 'platform_cap').description).toBe(
      'The platform classification limit was reached for these answers.',
    );
    expect(themeLabel('security_privacy')).toBe('Security and privacy');
    expect(themeLabel('pricing')).toBe('Pricing');
  });
});

import { describe, expect, it } from 'vite-plus/test';

import { aiSourceLabel, countDomainMax, isAiReferralsEmpty, toCountChartPoints } from './series';

describe('AI referral display helpers', () => {
  it('preserves unavailable points', () => {
    expect(toCountChartPoints([{ date: '2026-08-01', value: null }])[0]?.value).toBeNull();
  });

  it('names known AI sources and spells out an unknown one', () => {
    expect(aiSourceLabel('google_ai_overview')).toBe('Google AI Overview');
    expect(aiSourceLabel('new_engine')).toBe('New engine');
  });

  it('uses a readable count scale and honest empty state', () => {
    expect(countDomainMax([101, 199])).toBe(200);
    expect(isAiReferralsEmpty({ referral_volume: [], referral_share: [] } as never)).toBe(true);
  });
});

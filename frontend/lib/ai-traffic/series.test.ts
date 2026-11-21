import { describe, expect, it } from 'vite-plus/test';

import {
  aiSourceLabel,
  countDomainMax,
  isAiReferralsEmpty,
  toCountChartPoints,
  toPercentChartPoints,
} from './series';

const WEEKLY = { granularity: 'week', windowEnd: '2026-11-18' } as const;

describe('AI referral display helpers', () => {
  it('preserves unavailable points', () => {
    expect(toCountChartPoints([{ date: '2026-08-01', value: null }], WEEKLY)[0]?.value).toBeNull();
  });

  it('sets a bucket the window cuts apart from the line, so it never reads as a rise or a drop', () => {
    const series = [
      { date: '2026-11-09', value: 120 },
      { date: '2026-11-16', value: 31 },
    ];
    expect(toCountChartPoints(series, WEEKLY)).toEqual([
      { label: 'Nov 9', axisLabel: 'Nov 9', value: 120, breakBefore: false },
      { label: 'Nov 16 (in progress)', axisLabel: 'Nov 16', value: 31, breakBefore: true },
    ]);
    expect(
      toCountChartPoints([{ date: '2026-10-18', value: 9 }, ...series], WEEKLY).slice(0, 2),
    ).toEqual([
      { label: 'Oct 18 (partial week)', axisLabel: 'Oct 12', value: 9, breakBefore: false },
      { label: 'Nov 9', axisLabel: 'Nov 9', value: 120, breakBefore: true },
    ]);
    expect(
      toPercentChartPoints(series, { granularity: 'week', windowEnd: '2026-11-22' }).map(
        (point) => point.breakBefore,
      ),
    ).toEqual([false, false]);
    expect(
      toCountChartPoints([{ date: '2026-11-01', value: 4 }], {
        granularity: 'month',
        windowEnd: '2026-11-29',
      })[0]?.label,
    ).toBe('Nov 1 (in progress)');
    expect(
      toCountChartPoints(series, { granularity: 'day', windowEnd: '2026-11-16' }).at(-1)?.label,
    ).toBe('Nov 16');
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

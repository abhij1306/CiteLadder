export type ScoreBand = 'low' | 'mid' | 'high';

const MID_FROM = 50;
const HIGH_FROM = 80;

export function scoreBand(score: number): ScoreBand {
  if (score >= HIGH_FROM) return 'high';
  return score >= MID_FROM ? 'mid' : 'low';
}

/**
 * The one score band (F7). A 0–100 score reads as low below 50, mid below 80
 * and high from 80, wherever a score is coloured or named by band (the score
 * ring, Site Health's readiness dimensions), so the two never disagree.
 */
export type ScoreBand = 'low' | 'mid' | 'high';

const MID_FROM = 50;
const HIGH_FROM = 80;

export function scoreBand(score: number): ScoreBand {
  if (score >= HIGH_FROM) return 'high';
  return score >= MID_FROM ? 'mid' : 'low';
}

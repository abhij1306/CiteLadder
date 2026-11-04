import type { DataTone } from './data-tone';

/**
 * Score-band mapping (§ score bands): low 0–24, mid 25–49, good 50–74,
 * high 75–100. Returns the bridged token utility classes for the band's
 * marks (ring stroke, meter tone) so data-viz primitives stay token-only (no
 * raw hex). The numeral beside a mark keeps the foreground ink. */
export type ScoreBand = 'low' | 'mid' | 'good' | 'high';

export function scoreBand(score: number): ScoreBand {
  if (score >= 75) return 'high';
  if (score >= 50) return 'good';
  if (score >= 25) return 'mid';
  return 'low';
}

/**
 * Ring/arc stroke per band, on the outcome scale: low is bad, mid is mixed,
 * and the two passing bands share the good family, `good` at a lighter step
 * so the ring still separates them by lightness.
 */
export const scoreBandStroke: Record<ScoreBand, string> = {
  low: 'stroke-danger',
  mid: 'stroke-warning',
  good: 'stroke-success/55',
  high: 'stroke-success',
};

/** Horizontal meter tone per band, on the same outcome steps as the ring. */
export const scoreBandTone: Record<ScoreBand, DataTone> = {
  low: 'danger',
  mid: 'warning',
  good: 'success-soft',
  high: 'success',
};

/**
 * Null-aware text class for a score cell: muted for a missing score (which
 * renders the `Not measured` placeholder), the foreground ink otherwise. A
 * score is a figure, not a state, so it never takes the band colour. Shared
 * by every score table so the missing-score treatment never diverges.
 */
export function scoreTextClass(score: number | null): string {
  return score === null ? 'text-muted' : 'text-foreground';
}

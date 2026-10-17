import type { DataTone } from './data-tone';

/**
 * Score-band mapping (§ score bands): low 0–24, mid 25–49, good 50–74,
 * high 75–100. Returns the bridged token utility classes for stroke/text
 * so data-viz primitives stay token-only (no raw hex). */
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

/**
 * Band as text. Uses the outcome `*-text` inks, which are the AA-gated
 * variants — the marks are not guaranteed readable as type.
 */
export const scoreBandText: Record<ScoreBand, string> = {
  low: 'text-danger-text',
  mid: 'text-warning-text',
  good: 'text-success-text',
  high: 'text-success-text',
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
 * renders the `Not measured` placeholder), the band colour otherwise. Shared by every
 * score table so the missing-score treatment never diverges.
 */
export function scoreTextClass(score: number | null): string {
  if (score === null) return 'text-muted';
  return scoreBandText[scoreBand(score)];
}

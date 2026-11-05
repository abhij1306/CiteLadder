/**
 * The colour vocabulary a data mark may speak: an outcome family, a chart
 * series, or neutral. `MeterRow` and the distribution bars resolve their fill
 * here, so a bar and its key can never pick different tokens for the same
 * meaning. A chart's own series take `ChartTone` (`chart.tsx`) by position.
 *
 *   - outcome (`success` … `neutral`) — a state: good, bad, mixed, informative.
 *     `success-soft` is the lighter good step, for a passing band that must
 *     still separate from the best one by lightness (score bands).
 *   - series (`1` … `8`) — categorical identity in a chart; never a state.
 *
 * Accent is deliberately absent: it is the action colour, never data.
 */
type OutcomeTone = 'success' | 'success-soft' | 'warning' | 'danger' | 'info' | 'neutral';

type SeriesIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** A mark's colour: an outcome family or a chart series. */
export type DataTone = OutcomeTone | { series: SeriesIndex };

/** Static class strings, so Tailwind can see every one of them. */
const OUTCOME_FILL: Record<OutcomeTone, string> = {
  success: 'bg-positive',
  'success-soft': 'bg-positive/55',
  warning: 'bg-warning',
  danger: 'bg-negative',
  info: 'bg-info',
  neutral: 'bg-line-control',
};

const SERIES_FILL: Record<SeriesIndex, string> = {
  1: 'bg-data-1',
  2: 'bg-data-2',
  3: 'bg-data-3',
  4: 'bg-data-other',
  5: 'bg-data-other',
  6: 'bg-data-other',
  7: 'bg-data-other',
  8: 'bg-data-other',
};

/** The fill class for a mark (bar, dot, rule) in the given tone. */
export function dataFillClass(tone: DataTone): string {
  return typeof tone === 'string' ? OUTCOME_FILL[tone] : SERIES_FILL[tone.series];
}

/**
 * The colour vocabulary a data mark may speak: an outcome family, a chart
 * series, or neutral. `Meter`, `LegendSwatch` and the chart series tokens all
 * resolve their fill here, so a bar and its legend key can never pick
 * different tokens for the same meaning.
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
  success: 'bg-success',
  'success-soft': 'bg-success/55',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  neutral: 'bg-neutral',
};

const SERIES_FILL: Record<SeriesIndex, string> = {
  1: 'bg-chart-1',
  2: 'bg-chart-2',
  3: 'bg-chart-3',
  4: 'bg-chart-4',
  5: 'bg-chart-5',
  6: 'bg-chart-6',
  7: 'bg-chart-7',
  8: 'bg-chart-8',
};

/** The fill class for a mark (bar, dot, rule) in the given tone. */
export function dataFillClass(tone: DataTone): string {
  return typeof tone === 'string' ? OUTCOME_FILL[tone] : SERIES_FILL[tone.series];
}

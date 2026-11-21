import { SERIES_FILL, SERIES_STROKE } from '@/components/ui/step-chart-parts';
import { cn } from '@/lib/utils';
import { Absence } from '@/components/ui/absence';
import { InfoHint } from '@/components/ui/info-hint';
import type { PerformanceWindow } from '@/lib/api/performance';
import { formatCount } from '@/lib/format';
import {
  METRIC_CARDS,
  formatMetric,
  type PerformanceMetricKey,
} from '@/lib/performance/performance';
import { FigureStrip } from '@/components/ui/figure-strip';

import type { MetricMark } from './performance-chart';

const METRIC_HELP: Record<PerformanceMetricKey, string> = {
  clicks: 'Total clicks from Google Search results',
  impressions: 'Total impressions in Google Search results',
  ctr: 'Average click-through rate (Clicks / Impressions)',
  position: 'Average ranking position in Google Search results',
};

function metricComparison(
  metricKey: PerformanceMetricKey,
  comparison: PerformanceWindow,
  compareLabel: string,
) {
  return {
    label:
      comparison.evidence_state === 'not_run' ? `${compareLabel} (not imported)` : compareLabel,
    value: formatMetric(metricKey, comparison.totals[metricKey] ?? null),
  };
}

function MetricMarker({ mark, plotted }: Readonly<{ mark: MetricMark; plotted: boolean }>) {
  return (
    <svg aria-hidden width={12} height={12} viewBox="0 0 12 12" className="shrink-0">
      <circle
        cx={6}
        cy={6}
        r={5}
        strokeWidth={2}
        fill={plotted ? undefined : 'none'}
        className={cn(SERIES_STROKE[mark.tone], plotted && SERIES_FILL[mark.tone])}
      />
    </svg>
  );
}

export function MetricDefinitions() {
  return (
    <InfoHint label="What these metrics mean">
      {METRIC_CARDS.map((card) => (
        <span key={card.key} className="block">{`${card.label}: ${METRIC_HELP[card.key]}.`}</span>
      ))}
    </InfoHint>
  );
}

export function MetricCards({
  selected,
  comparison,
  selectedLabel,
  compareLabel,
  active,
  onToggle,
  marks,
  loading = false,
  className,
  'data-testid': testId,
}: Readonly<{
  selected: PerformanceWindow;
  comparison: PerformanceWindow | null;
  selectedLabel: string;
  compareLabel: string;
  active: ReadonlySet<PerformanceMetricKey>;
  onToggle: (key: PerformanceMetricKey) => void;
  marks: Record<PerformanceMetricKey, MetricMark>;
  loading?: boolean;
  className?: string;
  'data-testid'?: string;
}>) {
  return (
    <div className={className}>
      <FigureStrip
        label="Search Console metrics"
        testId={testId}
        segments={METRIC_CARDS.map((card) => {
          const plotted = active.has(card.key);
          return {
            key: card.key,
            label: card.label,
            caption: comparison ? selectedLabel : undefined,
            value: formatMetric(card.key, selected.totals[card.key] ?? null),
            loading,
            comparison: comparison
              ? metricComparison(card.key, comparison, compareLabel)
              : undefined,
            marker: <MetricMarker mark={marks[card.key]} plotted={plotted} />,
            onSelect: () => onToggle(card.key),
            actionLabel: `Plot ${card.label.toLowerCase()}`,
            selected: plotted,
          };
        })}
      />
    </div>
  );
}

const GA4_SUMMARY_ENTRIES = [
  { key: 'sessions' as const, label: 'Sessions' },
  { key: 'key_events' as const, label: 'Key events' },
];

function ga4ComparisonLabel(
  comparison: PerformanceWindow,
  value: number | null | undefined,
  compareLabel: string,
) {
  if (comparison.evidence_state === 'not_run') return `${compareLabel} (not imported)`;
  if (value === null || value === undefined)
    return (
      <>
        {compareLabel}: <Absence state="not_measured" />
      </>
    );
  return `${compareLabel}: ${formatCount(value)}`;
}

export function Ga4SummaryRow({
  selected,
  comparison,
  compareLabel,
  loading = false,
}: Readonly<{
  selected: PerformanceWindow;
  comparison: PerformanceWindow | null;
  compareLabel: string;
  loading?: boolean;
}>) {
  return (
    <div data-testid="ga4-summary" className="min-w-0">
      <FigureStrip
        segments={GA4_SUMMARY_ENTRIES.map((entry) => {
          const value = selected.totals[entry.key];
          const comparisonValue = comparison ? comparison.totals[entry.key] : undefined;
          return {
            key: entry.key,
            label: entry.label,
            value: value === null || value === undefined ? null : formatCount(value),
            loading,
            sub: comparison ? (
              <span className="tabular-nums">
                {ga4ComparisonLabel(comparison, comparisonValue, compareLabel)}
              </span>
            ) : undefined,
          };
        })}
      />
    </div>
  );
}

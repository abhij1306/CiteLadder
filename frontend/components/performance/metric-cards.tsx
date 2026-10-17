'use client';

import { Card, CardContent } from '@/components/ui/card';
import { LegendSwatch } from '@/components/ui/chart';
import { InfoHint } from '@/components/ui/info-hint';
import { Stack } from '@/components/ui/layout';
import { MetricValue } from '@/components/ui/metric-value';
import { StatGrid, StatItem } from '@/components/ui/stat-grid';
import { MetricGroup, MetricItem } from '@/components/ui/workspace';
import type { PerformanceWindow } from '@/lib/api/performance';
import { availabilityLabel, formatCount } from '@/lib/format';
import {
  METRIC_CARDS,
  formatMetric,
  type PerformanceMetricKey,
} from '@/lib/performance/performance';

/** The one missing-figure label on this surface. */
const NOT_MEASURED = availabilityLabel('not_measured');

/** A formatted figure, or null when the window measured nothing for it. */
function measured(key: PerformanceMetricKey, value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : formatMetric(key, value);
}

/**
 * The four selectable GSC metric cards.
 *
 * Each card shows the EXACT value for the selected range and, when a
 * comparison is active, the comparison window's own absolute value beneath
 * it — never a percentage. A derived ratio would hide the denominator a
 * reader needs to judge whether a change matters at all; two absolute numbers
 * do not.
 *
 * Selecting a card toggles its series on the chart below. At least one metric
 * always stays selected, so the chart never renders as an empty plot.
 *
 * The four render as ONE connected band (`StatGrid surface="band"`) rather
 * than four detached cards: they are a single control group over one window.
 * The cards are neutral; the metric's chart colour appears only as the series
 * key beside the label, and only while the metric is plotted. Selection is the
 * shared selected-row face plus `aria-pressed`.
 */
const METRIC_HELP: Record<PerformanceMetricKey, string> = {
  clicks: 'Total clicks from Google Search results',
  impressions: 'Total impressions in Google Search results',
  ctr: 'Average click-through rate (Clicks / Impressions)',
  position: 'Average ranking position in Google Search results',
};

/**
 * The comparison half of a card: the comparison window's own absolute value,
 * under a label that names THAT window.
 */
function MetricCardComparison({
  metricKey,
  comparison,
  comparisonValue,
  compareLabel,
  loading,
}: Readonly<{
  metricKey: PerformanceMetricKey;
  comparison: PerformanceWindow;
  comparisonValue: number | null | undefined;
  compareLabel: string;
  loading: boolean;
}>) {
  const statusLabel =
    comparison.evidence_state === 'not_run' ? `${compareLabel} — not imported` : compareLabel;
  return (
    <span className="border-border-subtle grid gap-0.5 border-t pt-1">
      <span>{statusLabel}</span>
      <MetricValue
        size="figureSm"
        value={measured(metricKey, comparisonValue)}
        label={NOT_MEASURED}
        loading={loading}
      />
    </span>
  );
}

/**
 * The label row's end: the series key (shown only while the metric is plotted
 * — a key on an unplotted metric would point at a line that is not there) and
 * the metric's definition. `StatItem` raises it above the cell's stretched
 * toggle, so the definition stays reachable.
 */
function MetricMarker({
  metricKey,
  label,
  color,
  plotted,
}: Readonly<{
  metricKey: PerformanceMetricKey;
  label: string;
  color: string;
  plotted: boolean;
}>) {
  return (
    <>
      <LegendSwatch color={color} shape="line" className={plotted ? undefined : 'invisible'} />
      <InfoHint label={label}>{METRIC_HELP[metricKey]}</InfoHint>
    </>
  );
}

export function MetricCards({
  selected,
  comparison,
  selectedLabel,
  compareLabel,
  active,
  onToggle,
  colors,
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
  colors: Record<PerformanceMetricKey, string>;
  /** A read is in flight. The cards spin rather than claiming a value is absent. */
  loading?: boolean;
  className?: string;
  'data-testid'?: string;
}>) {
  return (
    <StatGrid
      surface="band"
      columns={4}
      size="figure"
      label="Search Console metrics"
      className={className}
      data-testid={testId}
    >
      {METRIC_CARDS.map((card) => {
        const value = measured(card.key, selected.totals[card.key]);
        const plotted = active.has(card.key);
        return (
          <StatItem
            key={card.key}
            label={card.label}
            // The period labels earn their place only when TWO values stack:
            // with one number the range is already stated in the toolbar.
            caption={comparison ? selectedLabel : undefined}
            value={value}
            missingLabel={NOT_MEASURED}
            loading={loading}
            detail={
              comparison ? (
                <MetricCardComparison
                  metricKey={card.key}
                  comparison={comparison}
                  comparisonValue={comparison.totals[card.key]}
                  compareLabel={compareLabel}
                  loading={loading}
                />
              ) : undefined
            }
            marker={
              <MetricMarker
                metricKey={card.key}
                label={card.label}
                color={colors[card.key]}
                plotted={plotted}
              />
            }
            onSelect={() => onToggle(card.key)}
            actionLabel={`Plot ${card.label.toLowerCase()}`}
            selected={plotted}
          />
        );
      })}
    </StatGrid>
  );
}

const GA4_SUMMARY_ENTRIES = [
  { key: 'sessions' as const, label: 'Sessions' },
  { key: 'key_events' as const, label: 'Key events' },
];

/**
 * Sessions and key events for the selected range: one compact,
 * non-interactive row beneath the GSC cards.
 *
 * GA4 measures a different population than Search Console, so they never join
 * the chart or the metric selection — mixing them into one plot would imply a
 * comparability that does not exist. A null value means no included GA4 row
 * fed the window and renders as not measured, never as zero.
 */
/** An unimported window is a different fact from a metric missing in an imported one. */
function ga4ComparisonLabel(
  comparison: PerformanceWindow,
  value: number | null | undefined,
  compareLabel: string,
) {
  if (comparison.evidence_state === 'not_run') return `${compareLabel} — not imported`;
  if (value === null || value === undefined)
    return `${compareLabel}: ${NOT_MEASURED.toLowerCase()}`;
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
    <Card data-testid="ga4-summary">
      <CardContent>
        <Stack gap="compact">
          <MetricGroup>
            {GA4_SUMMARY_ENTRIES.map((entry) => {
              const value = selected.totals[entry.key];
              const comparisonValue = comparison ? comparison.totals[entry.key] : undefined;
              return (
                <MetricItem
                  key={entry.key}
                  label={entry.label}
                  value={
                    <MetricValue
                      size="figureSm"
                      value={value === null ? null : formatCount(value)}
                      label={NOT_MEASURED}
                      loading={loading}
                    />
                  }
                  detail={
                    comparison ? (
                      <span className="tabular-nums">
                        {ga4ComparisonLabel(comparison, comparisonValue, compareLabel)}
                      </span>
                    ) : undefined
                  }
                />
              );
            })}
          </MetricGroup>
          <p className="type-caption">
            Google Analytics 4 · Property-wide organic and AI sessions · Key events as configured in
            GA4
          </p>
        </Stack>
      </CardContent>
    </Card>
  );
}

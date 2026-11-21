import type { DemandDetectorPolicy } from '@citeladder/contracts';
import { queryRelevanceSchema } from '@citeladder/contracts/opportunity-evidence';
import type { DemandSignal } from '@/lib/api/demand';
import { numericMetric, signalDefinition } from '@/lib/demand/signals';
import { formatCount, formatMean, formatPercent } from '@/lib/format';
import { Absence } from '@/components/ui/absence';
import { AppGrid } from '@/components/ui/app-grid';
import { Stack } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';
import { wellClasses } from '@/components/ui/slip';

export function SignalInsight({
  signal,
  policy,
}: Readonly<{ signal: DemandSignal; policy: DemandDetectorPolicy }>) {
  const detail = (DETAIL[signal.signal_type] ?? (() => null))(signal, policy);
  return (
    <Stack as="section" aria-label="Reading">
      <p className={textRole('body', 'text-ink-2')}>
        {detail ?? signalDefinition(signal.signal_type, policy)}
      </p>
      <QueryRelevanceEvidence signal={signal} />
    </Stack>
  );
}

const DETAIL: Record<
  string,
  (signal: DemandSignal, policy: DemandDetectorPolicy) => string | null
> = {
  striking_distance: strikingDistanceDetail,
  property_relative_ctr_gap: ctrGapDetail,
  high_impression_low_ctr: ctrGapDetail,
  emerging_query: emergingDetail,
};

function strikingDistanceDetail(signal: DemandSignal): string | null {
  const position = numericMetric(signal, 'position');
  const impressions = numericMetric(signal, 'impressions');
  const observed = [
    position === null ? null : `ranks #${formatMean(position)}`,
    impressions === null ? null : `${formatCount(impressions)} impressions`,
  ].filter(Boolean);
  if (!observed.length) return null;
  return `This query ${observed.join(' with ')}, close enough that better coverage can lift it into the positions that earn clicks.`;
}

function ctrGapDetail(signal: DemandSignal): string | null {
  const median = numericMetric(signal, 'cohort_median_ctr');
  const ctr = numericMetric(signal, 'ctr');
  if (median === null || ctr === null) return null;
  return `A ${formatPercent(ctr)} click-through rate against a ${formatPercent(median)} median for this position band. The ranking is fine; the result is not being clicked.`;
}

function emergingDetail(signal: DemandSignal, { trends }: DemandDetectorPolicy): string | null {
  const prior = numericMetric(signal, 'prior_impressions');
  const recent = numericMetric(signal, 'recent_impressions');
  if (prior === null || recent === null || prior <= 0) return null;
  return `Impressions grew ${formatPercent((recent - prior) / prior)} (+${formatCount(recent - prior)}) across the last two ${trends.window_days}-day windows.`;
}

function coverageLabel(value: number | undefined) {
  return value === undefined ? <Absence state="not_measured" /> : formatPercent(value);
}

function QueryRelevanceEvidence({ signal }: Readonly<{ signal: DemandSignal }>) {
  const parsed = queryRelevanceSchema.safeParse(signal.evidence.query_relevance);
  if (!parsed.success) return null;
  const relevance = parsed.data;
  if (relevance.state === 'unknown') {
    return (
      <Stack gap="tight" className={wellClasses()}>
        <span className={textRole('body', 'text-ink-2')}>Query relevance unavailable</span>
        <p className="type-caption">
          {relevance.reason === 'page_content_unavailable'
            ? 'The resolved page had no usable inspected content.'
            : 'No usable query terms were available for comparison.'}
        </p>
      </Stack>
    );
  }
  const missing = Array.from(
    new Set([...(relevance.absent_from_title ?? []), ...(relevance.absent_from_h1 ?? [])]),
  );
  return (
    <section className={wellClasses()} aria-label="Query relevance">
      <Stack>
        <Stack gap="tight">
          <span className={textRole('body', 'text-ink-2')}>Query relevance</span>
          {relevance.statement ? <p className="type-caption">{relevance.statement}</p> : null}
        </Stack>
        <AppGrid as="dl" layout="thirds" className="type-caption">
          <div>
            <dt className="text-ink-2">Title</dt>
            <dd className={textRole('emphasis', 'tabular-nums')}>
              {coverageLabel(relevance.title_coverage)}
            </dd>
          </div>
          <div>
            <dt className="text-ink-2">H1</dt>
            <dd className={textRole('emphasis', 'tabular-nums')}>
              {coverageLabel(relevance.h1_coverage)}
            </dd>
          </div>
          <div>
            <dt className="text-ink-2">Page text</dt>
            <dd className={textRole('emphasis', 'tabular-nums')}>
              {coverageLabel(relevance.primary_content_coverage)}
            </dd>
          </div>
        </AppGrid>
        {missing.length > 0 ? (
          <p className="type-caption">
            <span className={textRole('body', 'text-ink-2')}>Missing from title or H1:</span>{' '}
            {missing.join(', ')}
          </p>
        ) : null}
      </Stack>
    </section>
  );
}

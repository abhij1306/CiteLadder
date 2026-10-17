'use client';

import type { DemandSignal } from '@/lib/api/demand';
import { numericMetric, signalTypeMeta } from '@/lib/demand/signals';
import { availabilityLabel, formatCount } from '@/lib/format';
import { panelClasses } from '@/components/ui/panel';
import { textRole } from '@/components/ui/typography';

/**
 * The plain-language reading of one signal, for its evidence drawer.
 *
 * Every figure quoted here must come from `signal.metrics`/`signal.evidence`.
 * When a metric was not observed the sentence drops it rather than
 * substituting a default — a page whose whole premise is "versioned GSC
 * evidence" cannot print a count it did not measure.
 */
export function SignalInsight({ signal }: Readonly<{ signal: DemandSignal }>) {
  const detail = (DETAIL[signal.signal_type] ?? (() => null))(signal);
  return (
    <section className="grid gap-2" aria-label="Reading">
      <p className={textRole('body')}>{detail ?? signalTypeMeta(signal.signal_type).definition}</p>
      <QueryRelevanceEvidence signal={signal} />
    </section>
  );
}

const DETAIL: Record<string, (signal: DemandSignal) => string | null> = {
  striking_distance: strikingDistanceDetail,
  property_relative_ctr_gap: ctrGapDetail,
  high_impression_low_ctr: ctrGapDetail,
  emerging_query: emergingDetail,
};

function strikingDistanceDetail(signal: DemandSignal): string | null {
  const position = numericMetric(signal, 'position');
  const impressions = numericMetric(signal, 'impressions');
  const observed = [
    position === null ? null : `ranks #${position.toFixed(1)}`,
    impressions === null ? null : `${formatCount(impressions)} impressions`,
  ].filter(Boolean);
  if (!observed.length) return null;
  return `This query ${observed.join(' with ')} — close enough that better coverage can lift it into the positions that earn clicks.`;
}

function ctrGapDetail(signal: DemandSignal): string | null {
  const median = numericMetric(signal, 'cohort_median_ctr');
  const ctr = numericMetric(signal, 'ctr');
  if (median === null || ctr === null) return null;
  return `A ${(ctr * 100).toFixed(1)}% click-through rate against a ${(median * 100).toFixed(1)}% median for this position band. The ranking is fine; the result is not being clicked.`;
}

function emergingDetail(signal: DemandSignal): string | null {
  const prior = numericMetric(signal, 'prior_impressions');
  const recent = numericMetric(signal, 'recent_impressions');
  if (prior === null || recent === null || prior <= 0) return null;
  return `Impressions grew ${Math.round(((recent - prior) / prior) * 100)}% (+${formatCount(recent - prior)}) across the last two 14-day windows.`;
}

type QueryRelevance = {
  state: string;
  reason?: string;
  title_coverage?: number;
  h1_coverage?: number;
  primary_content_coverage?: number;
  absent_from_title?: string[];
  absent_from_h1?: string[];
  statement?: string | null;
};

function queryRelevance(signal: DemandSignal): QueryRelevance | null {
  const value = signal.evidence.query_relevance;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const relevance = value as Record<string, unknown>;
  if (typeof relevance.state !== 'string') return null;
  return relevance as QueryRelevance;
}

function coverageLabel(value: number | undefined) {
  return typeof value === 'number'
    ? `${Math.round(value * 100)}%`
    : availabilityLabel('not_measured');
}

function QueryRelevanceEvidence({ signal }: Readonly<{ signal: DemandSignal }>) {
  const relevance = queryRelevance(signal);
  if (!relevance) return null;
  if (relevance.state !== 'measured') {
    return (
      <div className={panelClasses({ tone: 'well', pad: 'compact' }, 'grid gap-1')}>
        <span className={textRole('label')}>Query relevance unavailable</span>
        <p className="type-caption">
          {relevance.reason === 'page_content_unavailable'
            ? 'The resolved page had no usable inspected content.'
            : 'No usable query terms were available for comparison.'}
        </p>
      </div>
    );
  }
  const missing = Array.from(
    new Set([...(relevance.absent_from_title ?? []), ...(relevance.absent_from_h1 ?? [])]),
  );
  return (
    <section
      className={panelClasses({ tone: 'well', pad: 'compact' })}
      aria-label="Query relevance"
    >
      <div className="grid gap-2">
        <div>
          <span className={textRole('label')}>Query relevance</span>
          <p className="type-caption mt-0.5">
            {relevance.statement ??
              'Query-term coverage measured against the currently inspected page.'}
          </p>
        </div>
        <dl className="type-caption grid grid-cols-3 gap-3">
          <div>
            <dt className="text-muted">Title</dt>
            <dd className={textRole('emphasis', 'tabular-nums')}>
              {coverageLabel(relevance.title_coverage)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">H1</dt>
            <dd className={textRole('emphasis', 'tabular-nums')}>
              {coverageLabel(relevance.h1_coverage)}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Page text</dt>
            <dd className={textRole('emphasis', 'tabular-nums')}>
              {coverageLabel(relevance.primary_content_coverage)}
            </dd>
          </div>
        </dl>
        {missing.length > 0 ? (
          <p className="type-caption">
            <span className={textRole('label')}>Missing from title or H1:</span>{' '}
            {missing.join(', ')}
          </p>
        ) : null}
      </div>
    </section>
  );
}

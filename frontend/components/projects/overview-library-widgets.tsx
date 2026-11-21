import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { comparisonDeclinedReason } from '@citeladder/contracts/comparison-reason';
import { overviewWidgetTitles, type OverviewWidgetKey } from '@citeladder/contracts/overview';

import { BrandMark } from '@/components/ui/brand-mark';
import { Delta } from '@/components/ui/delta';
import { Inline } from '@/components/ui/layout';
import { AreaChart } from '@/components/ui/area-chart';
import { textRole } from '@/components/ui/typography';
import { Absence, printed } from '@/components/ui/absence';
import { ValueLedger } from '@/components/ui/facts';
import type { Project } from '@citeladder/contracts';
import { isMetricsPending } from '@/lib/api/visibility-queries';
import { formatCount, formatPercent, pluralCount } from '@/lib/format';
import {
  useLatestMovers,
  useLatestNearMisses,
  useLatestPerception,
  useLatestVisibility,
  useSearchPerformance,
  useTrafficOverview,
  useVisibilityTrend,
  WIDGET_ROWS,
} from '@/lib/overview/widget-queries';
import { formatRate } from '@/lib/visibility/dashboard';
import {
  gatedFigure,
  netReading,
  shareReading,
  type GatedReading,
} from '@/lib/visibility/perception';
import { hostOf, pathOf } from '@/lib/visibility/sources';
import { toChartPoints } from '@/lib/visibility/trends';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';
import { FigureStrip } from '@/components/ui/figure-strip';

import { overviewWidgetShape } from './overview-loading';
import { WidgetFrame } from './widget-frame';

function WidgetCard({
  id,
  href,
  fill,
  children,
}: Readonly<{
  id: OverviewWidgetKey;
  href: string;
  fill?: 'figure';
  children: ReactNode;
}>) {
  return (
    <WidgetFrame
      id={`widget-${id}`}
      title={overviewWidgetTitles[id]}
      fill={fill}
      link={{ href, label: 'Open', name: overviewWidgetTitles[id] }}
    >
      {children}
    </WidgetFrame>
  );
}

function Loaded<T>({
  widget,
  query,
  waitsOn,
  subject,
  fallback,
  children,
}: Readonly<{
  widget: OverviewWidgetKey;
  query: UseQueryResult<T>;
  waitsOn?: UseQueryResult<unknown>;
  subject: string;
  fallback: string;
  children: (data: T) => ReactNode;
}>) {
  const failed = waitsOn?.isError ? waitsOn : query;
  if (isMetricsPending(failed.error)) return metricsPending;
  if (failed.isError)
    return (
      <Notice
        kind="read"
        title={`Couldn't load ${subject}`}
        {...readErrorProps(failed)}
        fallback={fallback}
      />
    );
  if (query.data === undefined)
    return (
      <StateBlock kind="loading" label={`Loading ${subject}`} shape={overviewWidgetShape(widget)} />
    );
  return children(query.data);
}

const unavailable = <Absence state="unavailable" />;
const noMeasuredRun = <StateBlock kind="empty" inline message="No measured run yet." />;
const metricsPending = (
  <StateBlock kind="empty" inline message="Results are still being prepared." />
);

function notCompared(status: string, skippedRuns = 0) {
  const message =
    comparisonDeclinedReason(status, skippedRuns) ??
    'The latest run cannot be compared with an earlier one.';
  return <StateBlock kind="empty" inline message={message} />;
}

const valueOr = (value: string | null) => value ?? unavailable;
const gatedOr = (reading: GatedReading | null) =>
  reading ? gatedFigure(reading) : { value: unavailable };
const count = (value: number | null) => (value === null ? null : formatCount(value));

function Rows({ rows }: Readonly<{ rows: { key: string; label: ReactNode; value: ReactNode }[] }>) {
  return <ValueLedger items={rows} rows={WIDGET_ROWS} />;
}

export function VisibilityTrendWidget({ project }: Readonly<{ project: Project }>) {
  const query = useVisibilityTrend(project);
  return (
    <WidgetCard id="visibility_trend" href="/insights">
      <Loaded
        widget="visibility_trend"
        query={query}
        subject="visibility trends"
        fallback="Visibility trends could not be loaded."
      >
        {(points) =>
          points.length ? (
            <AreaChart
              data={toChartPoints(points, 'brand_mention_rate')}
              label="Visibility by run"
              height="sm"
              yMax={100}
              yFormat={(value) => `${Math.round(value)}%`}
              legend={false}
            />
          ) : (
            <StateBlock kind="empty" inline message="No completed runs yet." />
          )
        }
      </Loaded>
    </WidgetCard>
  );
}

export function ShareOfVoiceWidget({ project }: Readonly<{ project: Project }>) {
  const query = useLatestVisibility(project);
  return (
    <WidgetCard id="share_of_voice" href="/insights?metric=sov">
      <Loaded
        widget="share_of_voice"
        query={query}
        subject="share of voice"
        fallback="Share of voice could not be loaded."
      >
        {(visibility) => {
          if (!visibility) return noMeasuredRun;
          return visibility.rankings.length ? (
            <Rows
              rows={visibility.rankings.slice(0, WIDGET_ROWS).map((row) => ({
                key: row.name,
                label: (
                  <Inline as="span">
                    <BrandMark
                      name={row.name}
                      logoUrl={row.logo_url}
                      websiteUrl={row.website_url}
                      placement="inline"
                    />
                    {row.is_brand ? <strong>{row.name}</strong> : row.name}
                  </Inline>
                ),
                value: printed(formatRate(row.share_of_voice)),
              }))}
            />
          ) : (
            <StateBlock kind="empty" inline message="No brands measured in the latest run." />
          );
        }}
      </Loaded>
    </WidgetCard>
  );
}

export function TopMoversWidget({ project }: Readonly<{ project: Project }>) {
  const { visibility, movers, comparison } = useLatestMovers(project);
  const status = comparison?.status ?? 'no_baseline';
  if (visibility.isError || (visibility.data !== undefined && status !== 'comparable'))
    return (
      <WidgetCard id="top_movers" href="/visibility?tab=domains">
        <Loaded
          widget="top_movers"
          query={visibility}
          subject="top movers"
          fallback="Top movers could not be loaded."
        >
          {(latest) => (latest ? notCompared(status, comparison?.skipped_runs) : noMeasuredRun)}
        </Loaded>
      </WidgetCard>
    );
  return (
    <WidgetCard id="top_movers" href="/visibility?tab=domains">
      <Loaded
        widget="top_movers"
        query={movers}
        subject="top movers"
        fallback="Top movers could not be loaded."
      >
        {(data) => {
          if (data.comparison_status !== 'comparable') return notCompared(data.comparison_status);
          const rows = [...data.risers, ...data.fallers].slice(0, WIDGET_ROWS);
          return rows.length ? (
            <Rows
              rows={rows.map((mover) => ({
                key: mover.key,
                label: mover.key,
                value: <Delta value={mover.delta} policy="neutral" unit=" pp" />,
              }))}
            />
          ) : (
            <StateBlock kind="empty" inline message="No source changed its citation share." />
          );
        }}
      </Loaded>
    </WidgetCard>
  );
}

export function RetrievalWidget({ project }: Readonly<{ project: Project }>) {
  const { visibility, misses } = useLatestNearMisses(project);
  return (
    <WidgetCard id="retrieval" href="/visibility?tab=read-not-cited">
      {visibility.data === null ? (
        noMeasuredRun
      ) : (
        <Loaded
          widget="retrieval"
          query={misses}
          waitsOn={visibility}
          subject="retrieved sources"
          fallback="Retrieved sources could not be loaded."
        >
          {(data) => (
            <>
              <p className={textRole('caption')}>
                {data.responses
                  ? pluralCount(data.responses, 'answer')
                  : 'No engine shows what it read'}
              </p>
              <Rows
                rows={data.items.map((item) => ({
                  key: item.url,
                  label: `${hostOf(item.url)}${pathOf(item.url)}`,
                  value: `${item.retrieved} read · ${item.cited} cited`,
                }))}
              />
            </>
          )}
        </Loaded>
      )}
    </WidgetCard>
  );
}

export function PerceptionWidget({ project }: Readonly<{ project: Project }>) {
  const { visibility, perception } = useLatestPerception(project);
  if (visibility.data === null)
    return (
      <WidgetCard id="perception" href="/perception">
        {noMeasuredRun}
      </WidgetCard>
    );
  return (
    <WidgetCard id="perception" href="/perception" fill="figure">
      <Loaded
        widget="perception"
        query={perception}
        waitsOn={visibility}
        subject="perception"
        fallback="Perception could not be loaded."
      >
        {(data) => {
          const score = data.state === 'value' ? (data.brand?.score ?? null) : null;
          return (
            <FigureStrip
              segments={[
                {
                  key: 'net',
                  label: 'Net sentiment',
                  ...gatedOr(score && netReading(score.net_sentiment, score.classified)),
                },
                {
                  key: 'positive',
                  label: 'Positive',
                  ...gatedOr(score && shareReading(score.positive_share, score.classified)),
                },
                {
                  key: 'negative',
                  label: 'Negative',
                  ...gatedOr(score && shareReading(score.negative_share, score.classified)),
                },
              ]}
            />
          );
        }}
      </Loaded>
    </WidgetCard>
  );
}

export function AiTrafficWidget({ project }: Readonly<{ project: Project }>) {
  const query = useTrafficOverview(project);
  return (
    <WidgetCard id="ai_traffic" href="/ai-traffic" fill="figure">
      <Loaded
        widget="ai_traffic"
        query={query}
        subject="AI traffic"
        fallback="AI traffic could not be loaded."
      >
        {({ crawl, referrals }) => {
          const visits = referrals.referral_volume.at(-1)?.value ?? null;
          return (
            <FigureStrip
              segments={[
                {
                  key: 'requests',
                  label: 'AI crawler requests',
                  value: valueOr(count(crawl.requests)),
                },
                { key: 'bots', label: 'Active bots', value: valueOr(count(crawl.active_bots)) },
                {
                  key: 'referrals',
                  label: 'Latest AI referrals',
                  value: visits === null ? unavailable : formatCount(visits),
                },
              ]}
            />
          );
        }}
      </Loaded>
    </WidgetCard>
  );
}

export function SearchConsoleWidget({ project }: Readonly<{ project: Project }>) {
  const query = useSearchPerformance(project);
  return (
    <WidgetCard id="search_console" href="/performance" fill="figure">
      <Loaded
        widget="search_console"
        query={query}
        subject="Search Console"
        fallback="Search Console could not be loaded."
      >
        {({ selected }) =>
          selected.evidence_state === 'not_run' ? (
            <StateBlock
              kind="empty"
              inline
              message="Connect Search Console to see clicks and impressions."
            />
          ) : (
            <FigureStrip
              segments={[
                { key: 'clicks', label: 'Clicks', value: valueOr(count(selected.totals.clicks)) },
                {
                  key: 'impressions',
                  label: 'Impressions',
                  value: valueOr(count(selected.totals.impressions)),
                },
                {
                  key: 'ctr',
                  label: 'CTR',
                  value: valueOr(
                    selected.totals.ctr === null ? null : formatPercent(selected.totals.ctr),
                  ),
                },
              ]}
            />
          )
        }
      </Loaded>
    </WidgetCard>
  );
}

'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { overviewWidgetTitles, type OverviewWidgetKey } from '@citeladder/contracts/overview';

import { ProjectLink } from '@/components/ui/project-link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { QueryState } from '@/components/ui/query-state';
import { ReadError } from '@/components/ui/read-error';
import { Stack } from '@/components/ui/layout';
import { StatRow } from '@/components/ui/stat-row';
import { TrendChart } from '@/components/ui/trend-chart';
import { textRole } from '@/components/ui/typography';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { ValueLedger } from '@/components/ui/facts';
import { Icon } from '@/components/ui/icon';
import type { Project } from '@citeladder/contracts';
import { isMetricsPending } from '@/lib/api/visibility-queries';
import { formatCount, formatPercent } from '@/lib/format';
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
import { formatNet, formatShare } from '@/lib/visibility/perception';
import { hostOf, pathOf } from '@/lib/visibility/sources';
import { toChartPoints } from '@/lib/visibility/trends';

/** Every library widget has the same floor, so loading, empty and error states never resize it. */
function WidgetCard({
  id,
  href,
  children,
}: Readonly<{ id: OverviewWidgetKey; href: string; children: ReactNode }>) {
  return (
    <Card aria-labelledby={`widget-${id}`} className="flex h-full min-h-64 flex-col">
      <CardHeader
        actions={
          <Button asChild variant="ghost">
            <ProjectLink href={href}>
              Open <Icon icon={ArrowRight} />
            </ProjectLink>
          </Button>
        }
      >
        <CardTitle id={`widget-${id}`}>{overviewWidgetTitles[id]}</CardTitle>
      </CardHeader>
      <Stack as={CardContent} gap="compact" className="flex-1 content-start">
        {children}
      </Stack>
    </Card>
  );
}

/**
 * Loading, failed or loaded, in the same footprint. A read that waits on the
 * latest run (`waitsOn`) stays disabled while that read fails, so the failure
 * shown is the one that can be retried. A run whose metrics are not written
 * yet is not a failure: it says so instead.
 */
function Loaded<T>({
  query,
  waitsOn,
  fallback,
  children,
}: Readonly<{
  query: UseQueryResult<T>;
  waitsOn?: UseQueryResult<unknown>;
  fallback: string;
  children: (data: T) => ReactNode;
}>) {
  const failed = waitsOn?.isError ? waitsOn : query;
  if (isMetricsPending(failed.error)) return metricsPending;
  if (failed.isError)
    return (
      <ReadError
        error={failed.error}
        fallback={fallback}
        onRetry={() => void failed.refetch()}
        pending={failed.isFetching}
      />
    );
  if (query.data === undefined) return <QueryState kind="loading" />;
  return children(query.data);
}

const unavailable = <UnavailableValue state="unavailable" />;
/** The latest projection is `null`: no run has been measured yet. */
const noMeasuredRun = <QueryState kind="empty" inline message="No measured run yet." />;
const metricsPending = (
  <QueryState kind="empty" inline message="Results are still being prepared." />
);

const DIFFERENT_SETTINGS = 'The earlier run used different settings, so sources are not compared.';

/** Why the latest run has no source movement to rank, by its comparison status. */
const NOT_COMPARED: Readonly<Record<string, string>> = {
  changed_context: DIFFERENT_SETTINGS,
  matched_subset: DIFFERENT_SETTINGS,
  identity_unavailable: "This run's settings could not be identified, so it is not compared.",
  partial_coverage:
    'The latest or earlier run did not finish every answer, so shares would mislead.',
  coverage_unavailable:
    'The latest or earlier run has no expected-answer count, so its coverage cannot be checked.',
  no_observations: 'The latest or earlier run recorded no answers to compare.',
  invalid_baseline: 'The earlier run does not finish before the latest one starts.',
  baseline_pending: 'The comparison with an earlier run is still being prepared.',
};

function notCompared(status: string, skippedRuns = 0) {
  let message = NOT_COMPARED[status] ?? 'The latest run cannot be compared with an earlier one.';
  if (status === 'no_baseline')
    message = skippedRuns
      ? 'No earlier run used the same settings and scoring to compare with.'
      : 'No earlier run to compare with yet.';
  return <QueryState kind="empty" inline message={message} />;
}

const valueOr = (value: string | null) => value ?? unavailable;
const count = (value: number | null) => (value === null ? null : formatCount(value));

/** A ledger padded to the widget's row count, so a short list keeps the card's height. */
function Rows({ rows }: Readonly<{ rows: { key: string; label: ReactNode; value: ReactNode }[] }>) {
  return <ValueLedger items={rows} rows={WIDGET_ROWS} />;
}

export function VisibilityTrendWidget({ project }: Readonly<{ project: Project }>) {
  const query = useVisibilityTrend(project);
  return (
    <WidgetCard id="visibility_trend" href="/visibility?tab=trends">
      <Loaded query={query} fallback="Visibility trends could not be loaded.">
        {(points) =>
          points.length ? (
            <TrendChart
              data={toChartPoints(points, 'brand_mention_rate')}
              label="Brand mention rate by run"
              height="sm"
              yMax={100}
              yFormat={(value) => `${Math.round(value)}%`}
              legend={false}
            />
          ) : (
            <QueryState kind="empty" inline message="No completed runs yet." />
          )
        }
      </Loaded>
    </WidgetCard>
  );
}

export function ShareOfVoiceWidget({ project }: Readonly<{ project: Project }>) {
  const query = useLatestVisibility(project);
  return (
    <WidgetCard id="share_of_voice" href="/visibility?tab=trends">
      <Loaded query={query} fallback="Share of voice could not be loaded.">
        {(visibility) => {
          if (!visibility) return noMeasuredRun;
          return visibility.rankings.length ? (
            <Rows
              rows={visibility.rankings.slice(0, WIDGET_ROWS).map((row) => ({
                key: row.name,
                label: row.is_brand ? <strong>{row.name}</strong> : row.name,
                value: formatRate(row.share_of_voice),
              }))}
            />
          ) : (
            <QueryState kind="empty" inline message="No brands measured in the latest run." />
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
      <WidgetCard id="top_movers" href="/visibility?tab=sources">
        <Loaded query={visibility} fallback="Top movers could not be loaded.">
          {(latest) => (latest ? notCompared(status, comparison?.skipped_runs) : noMeasuredRun)}
        </Loaded>
      </WidgetCard>
    );
  return (
    <WidgetCard id="top_movers" href="/visibility?tab=sources">
      <Loaded query={movers} fallback="Top movers could not be loaded.">
        {(data) => {
          if (data.comparison_status !== 'comparable') return notCompared(data.comparison_status);
          const rows = [...data.risers, ...data.fallers].slice(0, WIDGET_ROWS);
          return rows.length ? (
            <Rows
              rows={rows.map((mover) => ({
                key: mover.key,
                label: mover.key,
                value: `${mover.delta > 0 ? '+' : ''}${mover.delta} pp`,
              }))}
            />
          ) : (
            <QueryState kind="empty" inline message="No source changed its citation share." />
          );
        }}
      </Loaded>
    </WidgetCard>
  );
}

export function RetrievalWidget({ project }: Readonly<{ project: Project }>) {
  const { visibility, misses } = useLatestNearMisses(project);
  return (
    <WidgetCard id="retrieval" href="/visibility?tab=sources&source_standing=near_miss">
      {visibility.data === null ? (
        noMeasuredRun
      ) : (
        <Loaded
          query={misses}
          waitsOn={visibility}
          fallback="Retrieved sources could not be loaded."
        >
          {(data) => (
            <>
              <p className={textRole('caption')}>
                {data.responses
                  ? `Your pages engines read but did not cite, across ${formatCount(data.responses)} answers that show what they read.`
                  : 'No engine in this run shows what it read.'}
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
      <WidgetCard id="perception" href="/visibility?tab=perception">
        {noMeasuredRun}
      </WidgetCard>
    );
  return (
    <WidgetCard id="perception" href="/visibility?tab=perception">
      <Loaded query={perception} waitsOn={visibility} fallback="Perception could not be loaded.">
        {(data) => {
          const score = data.brand?.score ?? null;
          return (
            <StatRow
              segments={[
                {
                  key: 'net',
                  label: 'Net sentiment',
                  value: valueOr(formatNet(score?.net_sentiment ?? null)),
                },
                {
                  key: 'positive',
                  label: 'Positive',
                  value: valueOr(formatShare(score?.positive_share ?? null)),
                },
                {
                  key: 'negative',
                  label: 'Negative',
                  value: valueOr(formatShare(score?.negative_share ?? null)),
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
    <WidgetCard id="ai_traffic" href="/ai-traffic">
      <Loaded query={query} fallback="AI Traffic could not be loaded.">
        {({ crawl, referrals }) => {
          const visits = referrals.referral_volume.at(-1)?.value ?? null;
          return (
            <StatRow
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
    <WidgetCard id="search_console" href="/performance">
      <Loaded query={query} fallback="Search Console could not be loaded.">
        {({ selected }) =>
          selected.evidence_state === 'not_run' ? (
            <QueryState
              kind="empty"
              inline
              message="Connect Search Console to see clicks and impressions."
            />
          ) : (
            <StatRow
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
                    selected.totals.ctr === null ? null : formatPercent(selected.totals.ctr, 1),
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

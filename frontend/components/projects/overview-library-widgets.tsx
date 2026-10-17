'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { ProjectLink } from '@/components/layout/scoped-link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { ReadError } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendChart } from '@/components/ui/trend-chart';
import { textRole } from '@/components/ui/typography';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { ledgerClasses, MetricGroup, MetricItem } from '@/components/ui/workspace';
import type { Project } from '@/lib/api/types';
import { formatCount, formatPercent } from '@/lib/format';
import { WIDGET_TITLES } from '@/lib/overview/layout';
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
}: Readonly<{ id: keyof typeof WIDGET_TITLES; href: string; children: ReactNode }>) {
  return (
    <Card aria-labelledby={`widget-${id}`} className="flex h-full min-h-64 flex-col">
      <CardHeader
        actions={
          <Button asChild variant="ghost" size="sm">
            <ProjectLink href={href}>
              Open <ArrowRight className="ms-1 size-3.5" aria-hidden />
            </ProjectLink>
          </Button>
        }
      >
        <CardTitle id={`widget-${id}`}>{WIDGET_TITLES[id]}</CardTitle>
      </CardHeader>
      <CardContent className="grid flex-1 content-start gap-3">{children}</CardContent>
    </Card>
  );
}

/** Loading, failed or loaded, in the same footprint. */
function Loaded<T>({
  query,
  fallback,
  children,
}: Readonly<{
  query: UseQueryResult<T>;
  fallback: string;
  children: (data: T) => ReactNode;
}>) {
  if (query.isError)
    return (
      <ReadError
        error={query.error}
        fallback={fallback}
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
      />
    );
  if (query.data === undefined) return <Skeleton className="h-32 w-full" />;
  return children(query.data);
}

const unavailable = <UnavailableValue state="unavailable" />;
const valueOr = (value: string | null) => value ?? unavailable;
const count = (value: number | null) => (value === null ? null : formatCount(value));

/** A ledger padded to the widget's row count, so a short list keeps the card's height. */
function Rows({ rows }: Readonly<{ rows: { key: string; label: ReactNode; value: ReactNode }[] }>) {
  const padding = Array.from({ length: Math.max(0, WIDGET_ROWS - rows.length) });
  return (
    <ol className={ledgerClasses('open')}>
      {rows.map((row) => (
        <li key={row.key} className="flex h-8 items-center justify-between gap-3">
          <span className={textRole('body', 'min-w-0 truncate')}>{row.label}</span>
          <span className={textRole('label', 'shrink-0 tabular-nums')}>{row.value}</span>
        </li>
      ))}
      {padding.map((_, index) => (
        <li key={`pad-${index}`} aria-hidden className="h-8" />
      ))}
    </ol>
  );
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
              className="w-full"
            />
          ) : (
            <InlineEmpty>No completed runs yet.</InlineEmpty>
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
        {(visibility) =>
          visibility.rankings.length ? (
            <Rows
              rows={visibility.rankings.slice(0, WIDGET_ROWS).map((row) => ({
                key: row.name,
                label: row.is_brand ? <strong>{row.name}</strong> : row.name,
                value: formatRate(row.share_of_voice),
              }))}
            />
          ) : (
            <InlineEmpty>No brands measured in the latest run.</InlineEmpty>
          )
        }
      </Loaded>
    </WidgetCard>
  );
}

export function TopMoversWidget({ project }: Readonly<{ project: Project }>) {
  const { visibility, movers, comparable } = useLatestMovers(project);
  if (visibility.isError || (visibility.data && !comparable))
    return (
      <WidgetCard id="top_movers" href="/visibility?tab=sources">
        <Loaded query={visibility} fallback="Top movers could not be loaded.">
          {() => <InlineEmpty>No comparable earlier run to compare with yet.</InlineEmpty>}
        </Loaded>
      </WidgetCard>
    );
  return (
    <WidgetCard id="top_movers" href="/visibility?tab=sources">
      <Loaded query={movers} fallback="Top movers could not be loaded.">
        {(data) => {
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
            <InlineEmpty>No source changed its citation share.</InlineEmpty>
          );
        }}
      </Loaded>
    </WidgetCard>
  );
}

export function RetrievalWidget({ project }: Readonly<{ project: Project }>) {
  const { visibility, misses } = useLatestNearMisses(project);
  const noRun = visibility.data !== undefined && !visibility.data.audit_id;
  return (
    <WidgetCard id="retrieval" href="/visibility?tab=sources&source_standing=near_miss">
      {noRun ? (
        <InlineEmpty>No completed runs yet.</InlineEmpty>
      ) : (
        <Loaded query={misses} fallback="Retrieved sources could not be loaded.">
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
  const { perception } = useLatestPerception(project);
  return (
    <WidgetCard id="perception" href="/visibility?tab=perception">
      <Loaded query={perception} fallback="Perception could not be loaded.">
        {(data) => {
          const score = data.brand?.score ?? null;
          return (
            <MetricGroup>
              <MetricItem
                label="Net sentiment"
                value={valueOr(formatNet(score?.net_sentiment ?? null))}
              />
              <MetricItem
                label="Positive"
                value={valueOr(formatShare(score?.positive_share ?? null))}
              />
              <MetricItem
                label="Negative"
                value={valueOr(formatShare(score?.negative_share ?? null))}
              />
            </MetricGroup>
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
            <MetricGroup>
              <MetricItem label="AI crawler requests" value={valueOr(count(crawl.requests))} />
              <MetricItem label="Active bots" value={valueOr(count(crawl.active_bots))} />
              <MetricItem
                label="Latest AI referrals"
                value={visits === null ? unavailable : formatCount(visits)}
              />
            </MetricGroup>
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
            <InlineEmpty>Connect Search Console to see clicks and impressions.</InlineEmpty>
          ) : (
            <MetricGroup>
              <MetricItem label="Clicks" value={valueOr(count(selected.totals.clicks))} />
              <MetricItem label="Impressions" value={valueOr(count(selected.totals.impressions))} />
              <MetricItem
                label="CTR"
                value={valueOr(
                  selected.totals.ctr === null ? null : formatPercent(selected.totals.ctr, 1),
                )}
              />
            </MetricGroup>
          )
        }
      </Loaded>
    </WidgetCard>
  );
}

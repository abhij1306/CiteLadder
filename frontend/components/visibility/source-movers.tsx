'use client';

import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';

import { BusyBar } from '@/components/ui/busy-bar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ClampText } from '@/components/ui/table';
import { Delta } from '@/components/ui/delta';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { Stack } from '@/components/ui/layout';
import { ReadError } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { textRole } from '@/components/ui/typography';
import { splitPaneClasses } from '@/components/ui/workspace';
import type { SourceFilters } from '@/components/visibility/source-rows';
import { queryKeys } from '@/lib/api/query-keys';
import { visibilityApi } from '@/lib/api/visibility';
import { pathOf, percent } from '@/lib/visibility/sources';
import { selectionParams, type SourceQueries } from '@/lib/visibility/use-source-analysis';
import type { visibilitySourceMoversSchema } from '@citeladder/contracts/visibility-evidence';

type Movers = z.infer<typeof visibilitySourceMoversSchema>;
type Mover = Movers['risers'][number];

/** Each list reserves this many rows, so a short list never shortens the card. */
const MOVER_ROWS = 5;

/**
 * Sources ranked by change in citation share against the dashboard's
 * comparison, which is the previous comparable period. Without a comparable
 * baseline there is no movement to rank.
 */
export function useSourceMovers(
  filters: SourceFilters,
  queries: SourceQueries,
  { dimension, enabled }: Readonly<{ dimension: 'domain' | 'url'; enabled: boolean }>,
) {
  const comparison = queries.visibilityQuery.data?.comparison;
  const baseline = comparison?.status === 'comparable' ? comparison.baseline_audit_ids : undefined;
  const params = {
    ...selectionParams(filters, queries),
    baseline_audit_ids: baseline,
    dimension,
    limit: MOVER_ROWS,
  };
  return useQuery({
    queryKey: queryKeys.visibility.sourceMovers(queries.projectId ?? '', params),
    queryFn: ({ signal }) =>
      visibilityApi.getSourceMovers(queries.projectId!, params, {
        signal,
        workspaceId: queries.workspaceId,
      }),
    enabled: enabled && Boolean(queries.projectId && queries.activeRunId && baseline?.length),
  });
}

const STATUS_COPY: Record<string, string> = {
  no_baseline: 'No comparable earlier period to compare this one with yet.',
  no_observations: 'The earlier period has no answers to compare with.',
  partial_coverage: 'One of the periods did not finish every answer, so shares would mislead.',
  changed_context: 'The earlier period was measured differently, so it is not comparable.',
  invalid_baseline: 'The earlier period does not finish before this one starts.',
  identity_unavailable: 'The earlier period cannot be matched to this one.',
};

const ROW = 'flex h-[var(--table-row-height)] items-center justify-between gap-3';

function MoverList({
  title,
  movers,
  dimension,
}: Readonly<{ title: string; movers: Mover[]; dimension: 'domain' | 'url' }>) {
  const padding = Math.max(0, MOVER_ROWS - Math.max(1, movers.length));
  return (
    <Stack as="section" gap="tight" aria-label={title} className="min-w-0">
      <h3 className={textRole('label', 'text-secondary')}>{title}</h3>
      <div>
        {movers.length ? (
          movers.map((mover) => (
            <div key={mover.key} className={ROW}>
              <ClampText lines={1} className="min-w-0">
                {dimension === 'url' ? pathOf(mover.key) : mover.key}
              </ClampText>
              <span className="flex shrink-0 items-center gap-3">
                <span className={textRole('caption', 'text-secondary tabular-nums')}>
                  {`${percent(mover.previous_share, 1)} → ${percent(mover.current_share, 1)}`}
                </span>
                <Delta value={mover.delta} policy="neutral" unit=" pp" />
              </span>
            </div>
          ))
        ) : (
          <div className={ROW}>
            <InlineEmpty>No source moved this way.</InlineEmpty>
          </div>
        )}
        {Array.from({ length: padding }, (_, index) => (
          <div key={`pad-${index}`} className={ROW} aria-hidden />
        ))}
      </div>
    </Stack>
  );
}

function MoversBody({
  query,
  dimension,
  comparable,
}: Readonly<{
  query: ReturnType<typeof useSourceMovers>;
  dimension: 'domain' | 'url';
  comparable: boolean;
}>) {
  const box = 'min-h-[calc(var(--table-row-height)*6)]';
  if (!comparable) {
    return (
      <div className={box}>
        <InlineEmpty>{STATUS_COPY.no_baseline}</InlineEmpty>
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className={box}>
        <ReadError
          error={query.error}
          fallback="Could not load top movers."
          onRetry={() => void query.refetch()}
          pending={query.isFetching}
        />
      </div>
    );
  }
  const data = query.data;
  if (!data) return <Skeleton className={box} />;
  if (data.comparison_status !== 'comparable') {
    return (
      <div className={box}>
        <InlineEmpty>
          {STATUS_COPY[data.comparison_status] ?? STATUS_COPY.identity_unavailable}
        </InlineEmpty>
      </div>
    );
  }
  return (
    <div className={splitPaneClasses('peers')}>
      <MoverList title="Rising" movers={data.risers} dimension={dimension} />
      <MoverList title="Falling" movers={data.fallers} dimension={dimension} />
    </div>
  );
}

/** Risers and fallers by citation share, current period against the previous one. */
export function TopMoversCard({
  dimension,
  query,
  comparable,
}: Readonly<{
  dimension: 'domain' | 'url';
  query: ReturnType<typeof useSourceMovers>;
  /** Whether the dashboard found a comparable earlier period at all. */
  comparable: boolean;
}>) {
  return (
    <Card className="relative">
      <BusyBar active={query.isFetching} label="Updating top movers" />
      <CardHeader>
        <CardTitle>Top movers</CardTitle>
        <CardDescription>
          {`The ${dimension === 'url' ? 'pages' : 'domains'} whose share of citations changed most against the previous comparable period, in percentage points.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MoversBody query={query} dimension={dimension} comparable={comparable} />
      </CardContent>
    </Card>
  );
}

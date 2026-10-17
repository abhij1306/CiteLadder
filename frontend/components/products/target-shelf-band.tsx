'use client';

import type { Shelf } from '@citeladder/contracts/commerce-suite';

import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { DisplayTime } from '@/components/ui/display-time';
import { Stack } from '@/components/ui/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { textRole } from '@/components/ui/typography';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { MetricGroup, metricItemClasses } from '@/components/ui/workspace';
import { pluralCount } from '@/lib/format';
import { cn } from '@/lib/utils';

import type { CommerceQueries } from './commerce-queries';

const percentage = (value: number | null | undefined) =>
  value == null ? null : `${(value * 100).toFixed(1)}%`;

type Snapshot = NonNullable<Shelf['snapshot']>;
type Metric = { label: string; definition: string; value: string | null };

function metrics(snapshot: Snapshot | null): Metric[] {
  return [
    {
      label: 'Product visibility',
      definition: 'Share of answers that recommended you.',
      value: percentage(snapshot?.product_visibility),
    },
    {
      label: 'Share of shelf',
      definition: 'Your share of every recommendation named.',
      value: percentage(snapshot?.share_of_shelf),
    },
    {
      label: 'Average position',
      definition: 'Your mean rank in answers that ranked products.',
      value: snapshot?.average_shelf_position?.toFixed(2) ?? null,
    },
    {
      label: 'First-position rate',
      definition: 'Share of ranked answers that put you first.',
      value: percentage(snapshot?.first_position_win_rate),
    },
  ];
}

/**
 * The measured outcome for the selected target, at the top of its detail:
 * what each number means, and how many answers it rests on.
 */
export function TargetShelfBand({ query }: Readonly<{ query: CommerceQueries['shelf'] }>) {
  if (query.isPending) return <Skeleton className="h-24 w-full" />;
  // A failed read is not an unmeasured target: rendering "Not measured" for a
  // request that never landed would report a missing metric as an observed absence.
  if (query.isError)
    return (
      <ReadError {...readErrorProps(query)} fallback="AI Shelf metrics could not be loaded." />
    );
  const snapshot = query.data.snapshot;
  // No successful answer is a failed measurement, not an unmeasured target.
  const unavailable = snapshot !== null && snapshot.successful_execution_count === 0;
  return (
    <Card data-testid="target-shelf-band">
      <CardContent className="grid gap-3">
        <MetricGroup>
          {metrics(snapshot).map(({ label, definition, value }) => (
            // The cell IS the stack: `dt`/`dd` have to stay direct children of
            // the `<dl>`'s own child, so an extra wrapper here is invalid.
            <Stack key={label} gap="tight" className={cn(metricItemClasses, 'content-start')}>
              <dt className={textRole('label')}>{label}</dt>
              <dd>
                {value === null ? (
                  <UnavailableValue
                    state={unavailable ? 'unavailable' : 'not_measured'}
                    className="inline-flex"
                  />
                ) : (
                  // A heading: the KPI, not its label, is what a reader scans for.
                  <CardTitle className={textRole('figure')}>{value}</CardTitle>
                )}
              </dd>
              <dd className="type-caption">{definition}</dd>
            </Stack>
          ))}
        </MetricGroup>
        {snapshot ? (
          <p className="type-caption">
            Measured <DisplayTime value={snapshot.measured_at} dateOnly /> from{' '}
            {pluralCount(snapshot.successful_execution_count, 'answer')} and{' '}
            {pluralCount(snapshot.recognized_slot_count, 'recognized recommendation')}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

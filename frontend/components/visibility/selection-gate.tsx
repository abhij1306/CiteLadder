import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

import type { Visibility } from '@citeladder/contracts';
import { isMetricsPending } from '@/lib/api/visibility-queries';
import { Stack } from '@/components/ui/layout';
import { Notice, readErrorProps, type RetryableRead } from '@/components/ui/notice';
import { BusyRung } from '@/components/ui/rung-meter';
import { Skeleton } from '@/components/ui/skeleton';
import { StateBlock, screenState } from '@/components/ui/state-block';

function isMeasured(data: Visibility | null): data is Visibility {
  if (data === null) return false;
  if (data.selection_mode !== 'range') return true;
  return (data.source_audit_ids?.length ?? 0) > 0;
}

export function SelectionGate({
  query,
  pending,
  children,
}: Readonly<{
  query: UseQueryResult<Visibility | null, unknown>;
  pending?: ReactNode;
  children: (selected: Visibility) => ReactNode;
}>) {
  if (query.isPending && pending) return pending;
  if (query.status === 'error' && isMetricsPending(query.error)) {
    return <Notice tone="info">Results for this run are still being prepared.</Notice>;
  }
  const state = screenState(query, {
    subject: 'the selected measurement',
    shape: { kind: 'figures' },
    hasMeasurement: isMeasured,
    notMeasured: {
      description: 'Results appear here once a run in this selection finishes measuring.',
    },
  });
  if (state.kind === 'state') return <StateBlock {...state.state} />;
  return children(state.data);
}

export function AnalysisRead<T>({
  query,
  title,
  busyLabel,
  busy,
  ready,
  children,
}: Readonly<{
  query: RetryableRead;
  title: string;
  busyLabel: string;
  busy: boolean;
  ready: T | undefined;
  children: (ready: T) => ReactNode;
}>) {
  if (query.error)
    return (
      <Notice
        kind="read"
        {...readErrorProps(query)}
        title={title}
        fallback="The request failed or timed out."
      />
    );
  if (ready === undefined)
    return (
      <Stack gap="workspace" aria-busy>
        <Skeleton variant="list" />
        <Skeleton variant="chart" />
      </Stack>
    );
  return (
    <div className="relative">
      <BusyRung active={busy} label={busyLabel} />
      {children(ready)}
    </div>
  );
}

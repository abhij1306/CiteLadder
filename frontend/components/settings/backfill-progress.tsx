'use client';

import { useQuery } from '@tanstack/react-query';

import { textRole } from '@/components/ui/typography';
import { integrationsApi, type IntegrationBackfillProgress } from '@/lib/api/integrations';
import { queryKeys } from '@/lib/api/query-keys';
import { SYNC_RUN_POLL_MS } from '@/lib/integrations/sync-runs';
import { formatShortDate } from '@/lib/format';

/**
 * The history-import line on a connection card.
 *
 * Selecting a property enqueues a year of history as rolling-window-sized
 * chunks, which then drain in the background with nothing on screen to say
 * so. This renders that rollup: how many windows are done, and which dates
 * are actually covered once they are.
 *
 * Every state stays distinct. `not_started` renders NOTHING
 * rather than "0 of 0 windows": no import was ever enqueued, which is not
 * the same as an import that has covered nothing yet. `partial` says so
 * explicitly instead of reporting the coverage as complete.
 */
export function BackfillProgress({
  workspaceId,
  connectionId,
}: Readonly<{ workspaceId: string; connectionId: string }>) {
  const progressQuery = useQuery({
    queryKey: queryKeys.integrations.backfillProgress(connectionId),
    queryFn: ({ signal }) =>
      integrationsApi.getBackfillProgress(connectionId, { signal, workspaceId }),
    // Poll only while windows are still draining; a settled import is static.
    refetchInterval: (query) =>
      query.state.data?.state === 'importing' ? SYNC_RUN_POLL_MS : false,
  });
  const progress = progressQuery.data ?? null;
  if (!progress || progress.state === 'not_started') return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={textRole('label')}>History</span>
      <span className="type-caption tabular-nums">{progressLabel(progress)}</span>
    </div>
  );
}

function progressLabel(progress: IntegrationBackfillProgress): string {
  const { completed_windows: completed, total_windows: total } = progress;
  if (progress.state === 'importing') {
    return `Importing — ${completed} of ${total} windows`;
  }
  const covered = coveredLabel(progress);
  if (progress.state === 'partial') {
    // The failed chunks are named, not folded into the covered range: their
    // slice of history is absent and the range would otherwise imply it is
    // not.
    return `${covered} · ${progress.failed_windows} of ${total} windows failed`;
  }
  return covered;
}

function coveredLabel(progress: IntegrationBackfillProgress): string {
  const { covered_from: from, covered_through: through } = progress;
  // A completed import with no covered range imported no rows at all — the
  // windows succeeded and the provider returned nothing for them.
  if (!from || !through) return 'No history imported';
  return `${formatShortDate(from)}–${formatShortDate(through)}`;
}

import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DisplayTime } from '@/components/ui/display-time';
import { Drawer } from '@/components/ui/drawer';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { Stack } from '@/components/ui/layout';
import { panelClasses } from '@/components/ui/panel';
import { ReadError } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { StatGrid } from '@/components/ui/stat-grid';
import { textRole } from '@/components/ui/typography';
import type { SearchIntelligenceRun } from '@/lib/api/search-intelligence';
import { formatCount } from '@/lib/format';
import { words } from '@/lib/ai-traffic/vocabulary';
import { reportedCost, runEstimate } from './search-intelligence-format';

const RUN_STATUS_LABELS: Readonly<Record<string, string>> = {
  succeeded: 'Complete',
  partial: 'Stopped early',
  failed: 'Failed',
  uncertain: 'Outcome unknown',
  cancelled: 'Cancelled',
  queued: 'Queued',
  running: 'Running',
};

/** Why an acquisition stopped, in the reader's terms. */
const STOP_REASONS: Readonly<Record<string, string>> = {
  cost_ceiling_reached:
    'The next request could have cost more than the estimate you confirmed, so it was not sent.',
  cost_ceiling_exceeded:
    'DataForSEO charged more than the estimate, so the remaining requests stopped.',
  auth_failure: 'DataForSEO refused the saved credential. Update it in provider settings.',
  client_error:
    'The DataForSEO connection settings are not valid. Check them in provider settings.',
  connection_changed: 'The DataForSEO connection changed after review. Review the analysis again.',
  pricing_changed: 'DataForSEO pricing changed after review. Review the analysis again.',
  provider_result_missing:
    'A request was sent but its result never arrived. It may have been charged; it is never resent automatically.',
  provider_cost_unavailable:
    'DataForSEO did not report what a request cost, so the analysis stopped.',
  provider_scope_violation:
    'DataForSEO returned results outside the reviewed website, so they were not saved.',
  acquisition_queue_terminal: 'The analysis stopped before every request finished.',
};

export function RunNotice({
  run,
  onCancel,
  cancelling,
}: Readonly<{
  run: SearchIntelligenceRun | null;
  onCancel: (runId: string) => void;
  cancelling: boolean;
}>) {
  if (!run) return null;
  if (run.status === 'queued' || run.status === 'running')
    return (
      <div className="type-body bg-info-bg text-info-text flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] p-3">
        <span className="flex items-center gap-2">
          <RefreshCw className="size-4 animate-spin" aria-hidden />
          Analysis in progress: {run.completed_calls} of {run.planned_calls} requests complete.
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={cancelling}
          onClick={() => onCancel(run.id)}
        >
          Cancel
        </Button>
      </div>
    );
  if (!['partial', 'failed', 'uncertain'].includes(run.status)) return null;
  return (
    <output className="type-body bg-warning-bg block rounded-[var(--radius-control)] p-3">
      <Stack gap="tight">
        <p className={textRole('itemTitle')}>
          Analysis {RUN_STATUS_LABELS[run.status]?.toLowerCase()}
        </p>
        <p className="text-muted">
          {STOP_REASONS[run.error_code] ||
            run.error_detail ||
            `${run.completed_calls} of ${run.planned_calls} requests completed.`}{' '}
          Saved results remain available below.
        </p>
      </Stack>
    </output>
  );
}

export function CostDetails({
  open,
  onOpenChange,
  runs,
  pending,
  error,
  onRetry,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runs: SearchIntelligenceRun[] | undefined;
  pending: boolean;
  /** The failed read, or null when the history loaded. */
  error: unknown;
  onRetry: () => void;
}>) {
  let content = <InlineEmpty>No analysis has been run yet.</InlineEmpty>;
  if (runs?.length) {
    content = (
      <ul className="grid gap-3">
        {runs.map((run) => (
          <li key={run.id} className={panelClasses({ tone: 'well' }, 'grid gap-3')}>
            <div className="grid gap-1">
              <p className={textRole('itemTitle')}>
                {words(run.action)} · {RUN_STATUS_LABELS[run.status] ?? run.status}
              </p>
              <p className={textRole('caption')}>
                <DisplayTime value={run.created_at} />
              </p>
            </div>
            <StatGrid
              columns={2}
              items={[
                {
                  key: 'estimated',
                  label: 'Estimated',
                  value: runEstimate(run),
                },
                {
                  key: 'reported',
                  label: 'Charged by DataForSEO',
                  value: reportedCost(run),
                },
                {
                  key: 'calls',
                  label: 'Requests completed',
                  value: `${run.completed_calls} of ${run.planned_calls}`,
                },
                { key: 'rows', label: 'Saved results', value: formatCount(run.received_rows) },
                {
                  key: 'uncertain',
                  label: 'Requests with unknown outcome',
                  value: run.uncertain_calls,
                },
              ]}
            />
          </li>
        ))}
      </ul>
    );
  }
  if (error)
    content = (
      <ReadError error={error} fallback="Cost history could not be loaded." onRetry={onRetry} />
    );
  if (pending) content = <Skeleton className="h-32 w-full" />;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Cost details"
      description="What each confirmed analysis was estimated to cost and what it was charged."
    >
      {content}
    </Drawer>
  );
}

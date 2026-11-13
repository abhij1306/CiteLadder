import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { DisplayTime } from '@/components/ui/display-time';
import { Drawer } from '@/components/ui/drawer';
import { Stack } from '@/components/ui/layout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { panelClasses } from '@/components/ui/panel';
import { QueryState } from '@/components/ui/query-state';
import { ReadError } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { StatRow } from '@/components/ui/stat-row';
import { textRole } from '@/components/ui/typography';
import type { SearchIntelligenceRun } from '@/lib/api/search-intelligence';
import { formatCount } from '@/lib/format';
import { words } from '@/lib/ai-traffic/vocabulary';
import { SEARCH_RUN_STATES } from '@/lib/search-intelligence/status';
import { reportedCost, runEstimate } from './search-intelligence-format';

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
  onReview,
  cancelling,
}: Readonly<{
  run: SearchIntelligenceRun | null;
  /** Cancel and Review again are offered only to a role that may run analyses. */
  onCancel?: (runId: string) => void;
  /** Opens the analysis review: the recovery for a stopped run. */
  onReview?: () => void;
  cancelling: boolean;
}>) {
  if (!run) return null;
  if (SEARCH_RUN_STATES[run.status].active)
    return (
      <Callout
        tone="info"
        icon={RefreshCw}
        action={
          onCancel ? (
            <Button variant="secondary" disabled={cancelling} onClick={() => onCancel(run.id)}>
              Cancel
            </Button>
          ) : undefined
        }
      >
        Analysis in progress: {run.completed_calls} of {run.planned_calls} requests complete.
      </Callout>
    );
  if (!['partial', 'failed', 'uncertain'].includes(run.status)) return null;
  const reason =
    STOP_REASONS[run.error_code] ||
    run.error_detail ||
    `${run.completed_calls} of ${run.planned_calls} requests completed.`;
  // A stopped analysis is recovered by reviewing and running it again.
  return (
    <MutationNotice
      notice={{
        message: `Analysis ${SEARCH_RUN_STATES[run.status].label.toLowerCase()}. ${reason} Saved results remain available below.`,
        retryable: false,
      }}
      recovery={
        onReview ? (
          <Button type="button" variant="secondary" onClick={onReview}>
            Review again
          </Button>
        ) : undefined
      }
    />
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
  let content = <QueryState kind="empty" inline message="No analysis has been run yet." />;
  if (runs?.length) {
    content = (
      <Stack as="ul" gap="compact">
        {runs.map((run) => (
          <Stack as="li" gap="compact" key={run.id} className={panelClasses()}>
            <Stack gap="tight">
              <p className={textRole('itemTitle')}>
                {words(run.action)} · {SEARCH_RUN_STATES[run.status].label}
              </p>
              <p className={textRole('caption')}>
                <DisplayTime value={run.created_at} />
              </p>
            </Stack>
            <StatRow
              segments={[
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
          </Stack>
        ))}
      </Stack>
    );
  }
  if (error)
    content = (
      <ReadError error={error} fallback="Cost history could not be loaded." onRetry={onRetry} />
    );
  if (pending) content = <Skeleton variant="block" />;
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

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { IssueFixProgress } from '@citeladder/contracts';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Inline, Stack } from '@/components/ui/layout';
import { ReadError } from '@/components/ui/read-error';
import { textRole } from '@/components/ui/typography';
import { ApiError } from '@/lib/api/errors';
import { siteHealthMutations, siteHealthQueries } from '@/lib/api/site-health-queries';
import { formatCount } from '@/lib/format';
import { useWorkspaceCapability } from '@/lib/project/project-scope';

/** The project whose crawl the issue is in: Re-run all refreshes its reads once it lands. */
export type IssueFixScope = Readonly<{ workspaceId: string; projectId: string }>;

/**
 * "N of M pages fixed": pages marked fixed or verified fixed, of the pages the
 * issue is on at their latest audit plus those verified fixed since the crawl.
 */
export function fixedLabel(
  progress: Pick<IssueFixProgress, 'fixed_url_count' | 'affected_url_count'>,
) {
  const total = progress.affected_url_count;
  return `${formatCount(progress.fixed_url_count)} of ${formatCount(total)} ${total === 1 ? 'page' : 'pages'} fixed`;
}

type Notice = { tone: 'info' | 'negative'; text: string };
type ActionProps = Readonly<{
  scope: IssueFixScope;
  crawlId: string;
  groupId: string;
  onNotice: (notice: Notice | null) => void;
}>;

/**
 * Mark fixed and Re-run all for one issue (SH-B12), with how far its fix has
 * come. Marking says the person fixed it; only an audit verifies it. Re-run all
 * re-audits the tracked pages the issue is still open on, one page fetch each.
 * A role without `write` sees no Mark fixed, and one without `run` no Re-run
 * all (AR-7: hidden, not disabled).
 */
export function IssueFixActions({
  scope,
  crawlId,
  groupId,
}: Readonly<{ scope: IssueFixScope; crawlId: string; groupId: string }>) {
  const query = useQuery(siteHealthQueries.issueFixes(scope.workspaceId, crawlId));
  const canWrite = useWorkspaceCapability('write');
  const canRun = useWorkspaceCapability('run');
  const [notice, setNotice] = useState<Notice | null>(null);
  if (query.isError && !query.data)
    return (
      <ReadError
        error={query.error}
        fallback="Could not load how many pages are fixed."
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
      />
    );
  const progress = query.data?.items.find((item) => item.group_id === groupId);
  if (!progress) return null;
  const awaiting = progress.fixed_url_count - progress.verified_url_count;
  const rerunCount = progress.rerun_url_count;
  return (
    <Stack gap="tight" className="min-w-0">
      <Inline className="flex-wrap">
        <span className={textRole('itemTitle', 'tabular-nums')}>{fixedLabel(progress)}</span>
        {awaiting > 0 ? (
          <span className="type-caption tabular-nums">
            {formatCount(awaiting)} awaiting a re-audit
          </span>
        ) : null}
      </Inline>
      <Inline className="flex-wrap">
        {canWrite ? (
          <MarkFixedButton
            scope={scope}
            crawlId={crawlId}
            groupId={groupId}
            onNotice={setNotice}
            done={progress.fixed_url_count >= progress.affected_url_count}
          />
        ) : null}
        {canRun && rerunCount !== null ? (
          <RerunAllButton
            scope={scope}
            crawlId={crawlId}
            groupId={groupId}
            onNotice={setNotice}
            none={rerunCount === 0}
          />
        ) : null}
      </Inline>
      {canRun || rerunCount === null ? (
        <span className="type-caption">{rerunCaption(rerunCount)}</span>
      ) : null}
      {notice ? <Callout tone={notice.tone}>{notice.text}</Callout> : null}
    </Stack>
  );
}

/** Mark fixed; `done` once every page is marked or verified fixed. */
function MarkFixedButton({
  scope,
  crawlId,
  groupId,
  onNotice,
  done,
}: ActionProps & Readonly<{ done: boolean }>) {
  const mark = useMutation(siteHealthMutations.markIssueFixed(scope.workspaceId, crawlId));
  return (
    <Button
      disabled={mark.isPending || done}
      onClick={() => {
        onNotice(null);
        mark.mutate(groupId, {
          onError: () =>
            onNotice({
              tone: 'negative',
              text: 'Could not mark this issue fixed. Please try again.',
            }),
        });
      }}
    >
      {mark.isPending ? 'Marking fixed…' : 'Mark fixed'}
    </Button>
  );
}

/** Re-run all; `none` when no tracked page with the issue is left to re-audit. */
function RerunAllButton({
  scope,
  crawlId,
  groupId,
  onNotice,
  none,
}: ActionProps & Readonly<{ none: boolean }>) {
  const rerun = useMutation(siteHealthMutations.rerunIssue(scope, crawlId));
  return (
    <Button
      disabled={rerun.isPending || none}
      onClick={() => {
        onNotice(null);
        rerun.mutate(groupId, {
          onSuccess: (result) =>
            onNotice({
              tone: 'info',
              text: `Re-auditing ${pagesLabel(result.page_count)}. The progress updates when the audit finishes.`,
            }),
          onError: (error) => onNotice({ tone: 'negative', text: rerunErrorMessage(error) }),
        });
      }}
    >
      {rerun.isPending ? 'Re-running…' : 'Re-run all'}
    </Button>
  );
}

const pagesLabel = (count: number) => `${formatCount(count)} ${count === 1 ? 'page' : 'pages'}`;

/** What Re-run all would do: null is a site-level finding, which no page re-audit judges. */
function rerunCaption(count: number | null): string {
  if (count === null) return 'A full crawl re-checks this site-wide issue.';
  if (count === 0) return 'No tracked page with this issue is left to re-audit.';
  return `Re-run all re-audits ${pagesLabel(count)}, one page fetch each.`;
}

function rerunErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Could not re-run this issue. Please try again.';
  if (error.code === 'crawl_already_active')
    return 'A crawl is running. Re-run this issue when it finishes.';
  if (error.code === 'site_health_fetches_exhausted')
    return 'Not enough page fetches remain this period to re-audit every page.';
  if (error.status === 403) return 'Re-auditing pages requires a Starter plan.';
  if (error.status === 409) return 'No tracked page with this issue can be re-audited.';
  return 'Could not re-run this issue. Please try again.';
}

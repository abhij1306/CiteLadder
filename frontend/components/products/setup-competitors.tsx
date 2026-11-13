import { useMutation } from '@tanstack/react-query';
import { Users } from 'lucide-react';

import { Callout } from '@/components/ui/callout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { QueryState } from '@/components/ui/query-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Inline, Stack } from '@/components/ui/layout';
import { commerceMutations } from '@/lib/api/commerce';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import type { CommerceTarget } from '@citeladder/contracts/commerce-suite';
import type { useCompetitorDiscovery } from '@/lib/products/competitor-discovery';

import type { CommerceQueries } from './commerce-queries';
import { competitorHost, competitorState, discoveryMessage } from './commerce-format';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { sameTarget } from '@/lib/products/targets';

type Discovery = ReturnType<typeof useCompetitorDiscovery>;

/** Only the candidates found for the target on screen. */
function forTarget(
  rows: NonNullable<CommerceQueries['competitors']['data']>,
  target: CommerceTarget,
) {
  return rows.filter((row) => sameTarget({ kind: row.target_kind, id: row.target_id }, target));
}

/**
 * Competitor discovery and review for one catalog product or category, on its
 * page's Setup: Find competitors, then approve or reject each candidate.
 */
export function SetupCompetitors({
  projectId,
  target,
  query,
  discovery,
}: Readonly<{
  projectId: string;
  target: CommerceTarget;
  query: CommerceQueries['competitors'];
  discovery: Discovery;
}>) {
  const { workspaceId } = useProjectScope();
  const decide = useMutation(commerceMutations.decideCompetitor({ workspaceId, projectId }));
  // Finding competitors is a run; approving one is a write. A role without
  // either reads the candidates and their state only.
  const canRun = useWorkspaceCapability('run');
  const canWrite = useWorkspaceCapability('write');
  // The tracker follows every run in the project, so a bulk discovery across
  // three categories otherwise showed all three banners on each one, and made
  // every target read as "Finding…" while any of them was running.
  const tasks = discovery.tasks.filter((task) => sameTarget(task.target, target));
  const running = tasks.some((task) => !task.terminal);
  const rows = query.data ? forTarget(query.data, target) : [];
  return (
    <Card>
      <CardHeader
        actions={
          canRun ? (
            <Button
              variant="secondary"
              disabled={discovery.discover.isPending || running}
              onClick={() => discovery.discover.mutate([target])}
            >
              {running ? 'Finding…' : 'Find competitors'}
            </Button>
          ) : undefined
        }
      >
        <CardTitle>Competitors</CardTitle>
        <CardDescription>Candidates do not enter measurement until approved.</CardDescription>
      </CardHeader>
      <CardContent>
        <Stack>
          {tasks.map((task) =>
            task.status === 'failed' ? (
              <MutationNotice
                key={task.id}
                notice={{
                  message: discoveryMessage(task.status, task.target.kind, task.error_code),
                  retryable: false,
                }}
                recovery={
                  canRun ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={discovery.discover.isPending || running}
                      onClick={() => discovery.discover.mutate([target])}
                    >
                      Find again
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <Callout key={task.id} tone="info">
                {discoveryMessage(task.status, task.target.kind, task.error_code)}
              </Callout>
            ),
          )}
          {discovery.discover.isError ? (
            <MutationNotice
              notice={mutationNoticeForError(discovery.discover.error, {
                action: 'start competitor discovery',
              })}
            />
          ) : null}
          {decide.isError ? (
            <MutationNotice
              notice={mutationNoticeForError(decide.error, {
                action: 'save the competitor decision',
              })}
            />
          ) : null}
          <CompetitorRows
            query={query}
            rows={rows}
            running={running}
            canFind={canRun}
            pending={decide.isPending}
            onDecide={canWrite ? (id, decision) => decide.mutate({ id, decision }) : undefined}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}

function CompetitorRows({
  query,
  rows,
  running,
  canFind,
  pending,
  onDecide,
}: Readonly<{
  query: CommerceQueries['competitors'];
  rows: NonNullable<CommerceQueries['competitors']['data']>;
  running: boolean;
  /** Whether the reader is offered Find competitors. */
  canFind: boolean;
  pending: boolean;
  /** Approves or rejects a candidate; omitted for a role that may not. */
  onDecide?: (id: string, decision: 'approved' | 'rejected') => void;
}>) {
  if (query.isError)
    return <ReadError {...readErrorProps(query)} fallback="Competitors could not be loaded." />;
  if (query.isPending) return <QueryState kind="loading" />;
  if (!rows.length) {
    return (
      <QueryState
        kind="empty"
        icon={Users}
        heading={running ? 'Looking for competitors…' : 'No candidates yet'}
        description={running || !canFind ? undefined : 'Run Find competitors.'}
        headingLevel={3}
      />
    );
  }
  return (
    <ul className={ledgerClasses()}>
      {rows.map((row) => (
        <Inline as="li" key={row.id} gap="compact" className={ledgerItemClasses('flex-wrap')}>
          <Stack gap="tight" className="min-w-0 flex-1">
            <a
              className={textRole('emphasis', 'text-link truncate')}
              href={row.canonical_url}
              target="_blank"
              rel="noreferrer"
            >
              {row.product_name || competitorHost(row.canonical_url)}
            </a>
            <span className="type-caption truncate">
              {[
                row.brand_name,
                competitorHost(row.canonical_url),
                row.source_kind === 'ai_observed' ? 'Seen in AI answers' : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </Stack>
          <Badge variant="status" value={competitorState(row.state).tone}>
            {competitorState(row.state).label}
          </Badge>
          {row.state === 'pending' && onDecide ? (
            <Inline>
              <Button
                variant="primary"
                disabled={pending}
                onClick={() => onDecide(row.id, 'approved')}
              >
                Approve
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => onDecide(row.id, 'rejected')}
              >
                Reject
              </Button>
            </Inline>
          ) : null}
        </Inline>
      ))}
    </ul>
  );
}

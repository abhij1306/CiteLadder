'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { QueryState } from '@/components/ui/query-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Stack } from '@/components/ui/layout';
import { commerceApi } from '@/lib/api/commerce';
import { humanizeApiError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/api/query-keys';
import type { CommerceTarget } from '@citeladder/contracts/commerce-suite';
import type { useCompetitorDiscovery } from '@/lib/products/competitor-discovery';

import type { CommerceQueries } from './commerce-queries';
import { competitorHost, competitorState, discoveryMessage } from './commerce-format';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses } from '@/components/ui/workspace';
import { useActiveWorkspaceId } from '@/lib/project/project-context';
import { sameTarget } from '@/lib/products/use-commerce-target';

type Discovery = ReturnType<typeof useCompetitorDiscovery>;

/** Only the candidates found for the target on screen. */
function forTarget(
  rows: NonNullable<CommerceQueries['competitors']['data']>,
  target: CommerceTarget,
) {
  return rows.filter((row) => sameTarget({ kind: row.target_kind, id: row.target_id }, target));
}

export function TargetCompetitors({
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
  const client = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) => {
      if (!workspaceId) throw new Error('Workspace is not available.');
      return commerceApi.decideCompetitor(projectId, id, decision, { workspaceId });
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: queryKeys.commerce.competitors(projectId) }),
  });
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
          <Button
            variant="secondary"
            disabled={!workspaceId || discovery.discover.isPending || running}
            onClick={() => discovery.discover.mutate([target])}
          >
            {running ? 'Finding…' : 'Find competitors'}
          </Button>
        }
      >
        <CardTitle>Competitors on this shelf</CardTitle>
        <CardDescription>Candidates do not enter measurement until approved.</CardDescription>
      </CardHeader>
      <CardContent>
        <Stack>
          {tasks.map((task) => (
            <Alert key={task.id} tone={task.status === 'failed' ? 'danger' : 'info'}>
              {discoveryMessage(task.status, task.target.kind, task.error_code)}
            </Alert>
          ))}
          {discovery.discover.isError ? (
            <Alert tone="danger">
              {
                humanizeApiError(
                  discovery.discover.error,
                  'Competitor discovery could not start. Please try again.',
                ).message
              }
            </Alert>
          ) : null}
          {decide.isError ? (
            <Alert tone="danger">The competitor decision failed. Please try again.</Alert>
          ) : null}
          <CompetitorRows
            query={query}
            rows={rows}
            running={running}
            pending={!workspaceId || decide.isPending}
            onDecide={(id, decision) => decide.mutate({ id, decision })}
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
  pending,
  onDecide,
}: Readonly<{
  query: CommerceQueries['competitors'];
  rows: NonNullable<CommerceQueries['competitors']['data']>;
  running: boolean;
  pending: boolean;
  onDecide: (id: string, decision: 'approved' | 'rejected') => void;
}>) {
  if (query.isError)
    return <ReadError {...readErrorProps(query)} fallback="Competitors could not be loaded." />;
  if (query.isPending) return <QueryState kind="loading" />;
  if (!rows.length) {
    return (
      <QueryState
        kind="empty"
        icon={Users}
        heading={running ? 'Looking for competitors…' : 'No candidates yet for this target'}
        description={running ? undefined : 'Run Find competitors.'}
        headingLevel={3}
      />
    );
  }
  return (
    <ul className={ledgerClasses()}>
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center gap-3 py-2">
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
          {row.state === 'pending' ? (
            <div className="flex gap-2">
              <Button disabled={pending} onClick={() => onDecide(row.id, 'approved')}>
                Approve
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => onDecide(row.id, 'rejected')}
              >
                Reject
              </Button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

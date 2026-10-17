'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DisplayTime } from '@/components/ui/display-time';
import { LineDiff } from '@/components/ui/line-diff';
import { ReadError } from '@/components/ui/read-error';
import { Skeleton } from '@/components/ui/skeleton';
import { textRole } from '@/components/ui/typography';
import { diffLines } from '@/lib/agent/diff';
import { agentWriteFailure } from '@/lib/agent/errors';
import { OUTPUT_PHASE_LABEL } from '@/lib/agent/vocabulary';
import { agentMutations, agentQueries, type AgentRevision } from '@/lib/api/agent';
import { queryKeys } from '@/lib/api/query-keys';
import { ContentMarkdown } from '@/lib/markdown/markdown';

type View = { id: string; mode: 'view' | 'compare' } | null;

/**
 * Every revision of the output, newest first. Any earlier revision can be
 * viewed or restored; a restore appends a new revision rather than rewinding.
 */
export function OutputHistory({
  workspaceId,
  chatId,
  latestRevisionId,
  canRestore,
}: Readonly<{
  workspaceId: string;
  chatId: string;
  latestRevisionId: string;
  canRestore: boolean;
}>) {
  const query = useQuery(agentQueries.revisions(workspaceId, chatId, latestRevisionId));
  const [viewing, setViewing] = useState<View>(null);
  const queryClient = useQueryClient();
  const restore = useMutation({
    ...agentMutations.restoreRevision(workspaceId),
    onSuccess: async () => {
      setViewing(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.agent.chat(chatId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agent.revisions(chatId) }),
      ]);
    },
  });

  if (query.isError)
    return (
      <ReadError
        error={query.error}
        fallback="Revision history could not be loaded."
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
      />
    );
  if (!query.data) return <Skeleton className="h-32 w-full" />;
  const revisions = [...query.data.items].sort((a, b) => b.number - a.number);
  const current = revisions.find((revision) => revision.id === latestRevisionId);
  const toggle = (id: string, mode: 'view' | 'compare') =>
    setViewing((open) => (open?.id === id && open.mode === mode ? null : { id, mode }));
  return (
    <div className="grid gap-3">
      {restore.isError ? (
        <Alert tone="danger">{agentWriteFailure(restore.error).message}</Alert>
      ) : null}
      <ol aria-label="Revisions" className="divide-border-subtle grid divide-y">
        {revisions.map((revision) => (
          <li key={revision.id} className="grid gap-2 py-3">
            <RevisionRow
              revision={revision}
              latest={revision.id === latestRevisionId}
              open={viewing?.id === revision.id ? viewing.mode : null}
              current={current}
              onToggle={(mode) => toggle(revision.id, mode)}
              restoring={restore.isPending}
              canRestore={canRestore}
              onRestore={() => restore.mutate({ chatId, revisionId: revision.id })}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function RevisionRow({
  revision,
  latest,
  open,
  current,
  onToggle,
  restoring,
  canRestore,
  onRestore,
}: Readonly<{
  revision: AgentRevision;
  latest: boolean;
  open: 'view' | 'compare' | null;
  current: AgentRevision | undefined;
  onToggle: (mode: 'view' | 'compare') => void;
  restoring: boolean;
  canRestore: boolean;
  onRestore: () => void;
}>) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className={textRole('itemTitle')}>Revision {revision.number}</span>
        <span className={textRole('caption')}>
          {revision.author === 'user' ? 'Your edit' : 'Agent'} ·{' '}
          {OUTPUT_PHASE_LABEL[revision.phase]}
          {revision.approved_at ? ' · Approved' : ''} · <DisplayTime value={revision.created_at} />
        </span>
        {latest ? <span className={textRole('caption')}>Current</span> : null}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open === 'view'}
          onClick={() => onToggle('view')}
        >
          {open === 'view' ? 'Hide' : 'View'}
        </Button>
        {latest || !current ? null : (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open === 'compare'}
            onClick={() => onToggle('compare')}
          >
            Compare with current
          </Button>
        )}
        {latest || !canRestore ? null : (
          <Button variant="secondary" size="sm" disabled={restoring} onClick={onRestore}>
            Restore
          </Button>
        )}
      </div>
      {open === 'view' ? (
        <div className="grid gap-2">
          <h4 className={textRole('itemTitle')}>{revision.title}</h4>
          <ContentMarkdown markdown={revision.body} density="compact" />
        </div>
      ) : null}
      {open === 'compare' && current ? <RevisionDiff before={revision} after={current} /> : null}
    </>
  );
}

/** What changed from this revision to the current one, line by line. */
function RevisionDiff({
  before,
  after,
}: Readonly<{ before: AgentRevision; after: AgentRevision }>) {
  const lines = diffLines(
    `# ${before.title}\n\n${before.body}`,
    `# ${after.title}\n\n${after.body}`,
  );
  if (lines === null)
    return (
      <p className={textRole('body')}>
        These revisions are too long to compare line by line. View each one instead.
      </p>
    );
  const changed = lines.filter((line) => line.kind !== 'same').length;
  const noun = changed === 1 ? 'line' : 'lines';
  const summary = changed === 0 ? 'no changes' : `${changed} changed ${noun}`;
  return (
    <div className="grid gap-2">
      <p className={textRole('caption')}>
        Revision {before.number} → current (revision {after.number}): {summary}
      </p>
      <LineDiff lines={lines} label={`Changes from revision ${before.number}`} />
    </div>
  );
}

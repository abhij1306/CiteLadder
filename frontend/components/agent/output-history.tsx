import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { DisplayTime } from '@/components/ui/display-time';
import { Inline, Stack } from '@/components/ui/layout';
import { LineDiff } from '@/components/ui/line-diff';
import { textRole } from '@/components/ui/typography';
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import { Eye, EyeOff, GitCompare } from '@/lib/icons';
import { diffLines } from '@/lib/agent/diff';
import { agentWriteFailure } from '@/lib/agent/errors';
import { agentMutations, agentQueries, type AgentRevision } from '@/lib/api/agent';
import { useAgentLinkHosts } from '@/lib/agent/link-hosts';
import { ContentMarkdown } from '@/lib/markdown/markdown';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';

type View = { id: string; mode: 'view' | 'compare' } | null;

export function OutputHistory({
  workspaceId,
  chatId,
  outputId,
  latestRevisionId,
  canRestore,
}: Readonly<{
  workspaceId: string;
  chatId: string;
  outputId: string;
  latestRevisionId: string;
  canRestore: boolean;
}>) {
  const query = useQuery(agentQueries.revisions(workspaceId, chatId, outputId, latestRevisionId));
  const [viewing, setViewing] = useState<View>(null);
  const restore = useMutation(agentMutations.restoreRevision(workspaceId));

  if (query.isError)
    return (
      <Notice
        kind="read"
        {...readErrorProps(query)}
        title="Couldn't load the revision history"
        fallback="Revision history could not be loaded."
      />
    );
  if (!query.data)
    return <StateBlock kind="loading" label="Loading revisions…" shape={{ kind: 'list' }} />;
  const revisions = [...query.data.items].sort((a, b) => b.number - a.number);
  const current = revisions.find((revision) => revision.id === latestRevisionId);
  const toggle = (id: string, mode: 'view' | 'compare') =>
    setViewing((open) => (open?.id === id && open.mode === mode ? null : { id, mode }));
  return (
    <Stack gap="compact">
      {restore.isError ? (
        <Notice kind="mutation" notice={agentWriteFailure(restore.error, 'restore the revision')} />
      ) : null}
      <ol aria-label="Revisions" className={ledgerClasses()}>
        {revisions.map((revision) => (
          <Stack as="li" key={revision.id} className={ledgerItemClasses()}>
            <RevisionRow
              revision={revision}
              latest={revision.id === latestRevisionId}
              open={viewing?.id === revision.id ? viewing.mode : null}
              current={current}
              onToggle={(mode) => toggle(revision.id, mode)}
              restoring={restore.isPending}
              canRestore={canRestore}
              onRestore={() =>
                restore.mutate(
                  { chatId, outputId, revisionId: revision.id },
                  { onSuccess: () => setViewing(null) },
                )
              }
            />
          </Stack>
        ))}
      </ol>
    </Stack>
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
  const knownHosts = useAgentLinkHosts(revision.web_sources);
  return (
    <>
      <Inline className="flex-wrap">
        <span className={textRole('body')}>Revision {revision.number}</span>
        <span className={textRole('caption')}>
          {revisionAuthorLabel(revision.author)} · <DisplayTime value={revision.created_at} />
        </span>
        {latest ? <span className={textRole('caption')}>Current</span> : null}
        <span className="flex-1" />
        <Button variant="quiet" aria-expanded={open === 'view'} onClick={() => onToggle('view')}>
          <Icon icon={open === 'view' ? EyeOff : Eye} />
          {open === 'view' ? 'Hide' : 'View'}
        </Button>
        {latest || !current ? null : (
          <Button
            variant="quiet"
            aria-expanded={open === 'compare'}
            onClick={() => onToggle('compare')}
          >
            <Icon icon={GitCompare} />
            Compare with current
          </Button>
        )}
        {latest || !canRestore ? null : (
          <Button variant="secondary" disabled={restoring} onClick={onRestore}>
            Restore
          </Button>
        )}
      </Inline>
      {open === 'view' ? (
        <Stack gap="compact">
          <h4 className={textRole('subheading')}>{revision.title}</h4>
          <ContentMarkdown markdown={revision.body} density="compact" knownHosts={knownHosts} />
        </Stack>
      ) : null}
      {open === 'compare' && current ? <RevisionDiff before={revision} after={current} /> : null}
    </>
  );
}

function revisionAuthorLabel(author: AgentRevision['author']) {
  switch (author) {
    case 'user':
      return 'Your edit';
    case 'fetch':
      return 'Fetched page';
    case 'agent':
      return 'Agent';
    default: {
      const _exhaustive: never = author;
      return _exhaustive;
    }
  }
}

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
      <p className={textRole('body', 'text-ink-2')}>
        These revisions are too long to compare line by line. View each one instead.
      </p>
    );
  const changed = lines.filter((line) => line.kind !== 'same').length;
  const noun = changed === 1 ? 'line' : 'lines';
  const summary = changed === 0 ? 'no changes' : `${changed} changed ${noun}`;
  return (
    <Stack gap="compact">
      <p className={textRole('caption')}>
        Revision {before.number} → current (revision {after.number}): {summary}
      </p>
      <LineDiff lines={lines} label={`Changes from revision ${before.number}`} />
    </Stack>
  );
}

import { useMutation } from '@tanstack/react-query';

import { StatusMark } from '@/components/ui/status-mark';
import { Button } from '@/components/ui/button';
import { Stack } from '@/components/ui/layout';
import { LedgerItem, LedgerList } from '@/components/ui/ledger-list';
import { TextLink } from '@/components/ui/text-link';
import { Users } from '@/lib/icons';
import { commerceMutations } from '@/lib/api/commerce';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import type { CommerceTarget } from '@citeladder/contracts/commerce-suite';
import type { useCompetitorDiscovery } from '@/lib/products/competitor-discovery';

import type { CommerceQueries } from './commerce-queries';
import { competitorHost, competitorState, discoveryMessage } from './commerce-format';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { sameTarget } from '@/lib/products/targets';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';
import { Section, SectionContent, SectionHeader, SectionTitle } from '@/components/ui/section';

type Discovery = ReturnType<typeof useCompetitorDiscovery>;

function forTarget(
  rows: NonNullable<CommerceQueries['competitors']['data']>,
  target: CommerceTarget,
) {
  return rows.filter((row) => sameTarget({ kind: row.target_kind, id: row.target_id }, target));
}

export function SetupCompetitors({
  projectId,
  target,
  query,
  discovery,
  level = 2,
}: Readonly<{
  projectId: string;
  target: CommerceTarget;
  query: CommerceQueries['competitors'];
  discovery: Discovery;
  level?: 2 | 3;
}>) {
  const { workspaceId } = useProjectScope();
  const decide = useMutation(commerceMutations.decideCompetitor({ workspaceId, projectId }));
  const canRun = useWorkspaceCapability('run');
  const canWrite = useWorkspaceCapability('write');
  const tasks = discovery.tasks.filter((task) => sameTarget(task.target, target));
  const running = tasks.some((task) => !task.terminal);
  const rows = query.data ? forTarget(query.data, target) : [];
  return (
    <Section>
      <SectionHeader
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
        <SectionTitle level={level}>Competitors</SectionTitle>
      </SectionHeader>
      <SectionContent>
        <Stack>
          {tasks.map((task) =>
            task.status === 'failed' ? (
              <Notice
                kind="mutation"
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
              <Notice key={task.id} tone="info">
                {discoveryMessage(task.status, task.target.kind, task.error_code)}
              </Notice>
            ),
          )}
          {discovery.discover.isError ? (
            <Notice
              kind="mutation"
              notice={mutationNoticeForError(discovery.discover.error, {
                action: 'start competitor discovery',
              })}
            />
          ) : null}
          {decide.isError ? (
            <Notice
              kind="mutation"
              notice={mutationNoticeForError(decide.error, {
                action: 'save the competitor decision',
              })}
            />
          ) : null}
          <CompetitorRows
            query={query}
            rows={rows}
            running={running}
            pending={decide.isPending}
            onDecide={canWrite ? (id, decision) => decide.mutate({ id, decision }) : undefined}
          />
        </Stack>
      </SectionContent>
    </Section>
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
  onDecide?: (id: string, decision: 'approved' | 'rejected') => void;
}>) {
  if (query.isError)
    return (
      <Notice
        kind="read"
        {...readErrorProps(query)}
        title="Couldn't load competitors"
        fallback="Competitors could not be loaded."
      />
    );
  if (query.isPending)
    return <StateBlock kind="loading" label="Loading competitors" shape={{ kind: 'list' }} />;
  if (!rows.length) {
    return (
      <StateBlock
        kind="empty"
        icon={Users}
        heading={running ? 'Looking for competitors…' : 'No candidates yet'}
        headingLevel={3}
      />
    );
  }
  return (
    <LedgerList>
      {rows.map((row) => (
        <LedgerItem
          key={row.id}
          title={
            <TextLink variant="external" href={row.canonical_url} text="inherit">
              {row.product_name || competitorHost(row.canonical_url)}
            </TextLink>
          }
          caption={[
            row.brand_name,
            competitorHost(row.canonical_url),
            row.source_kind === 'ai_observed' ? 'Seen in AI answers' : '',
          ]
            .filter(Boolean)
            .join(' · ')}
          meta={
            <StatusMark variant="status" value={competitorState(row.state).tone}>
              {competitorState(row.state).label}
            </StatusMark>
          }
          links={
            row.state === 'pending' && onDecide ? (
              <>
                <Button
                  variant="secondary"
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
              </>
            ) : undefined
          }
        />
      ))}
    </LedgerList>
  );
}

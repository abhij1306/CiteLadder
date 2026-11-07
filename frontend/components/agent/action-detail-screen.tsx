'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import {
  isDeclarable,
  MarkImplementedButton,
  ContextualLinkDeclarationRoute,
} from '@/components/agent/action-declaration';
import { DeclarationStatus } from '@/components/agent/declaration-status';
import { useAgentCatalog } from '@/components/agent/use-agent-catalog';
import { ActionPriorityBadge, ActionStatusBadge } from '@/components/agent/action-status-badge';
import { DetailScreen } from '@/components/layout/page-shell';
import { ProjectLink } from '@/components/ui/project-link';
import { EvidenceDrawer } from '@/components/opportunities/evidence-drawer';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle, cardClasses } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FactList, type Fact } from '@/components/ui/facts';
import { Inline, Stack } from '@/components/ui/layout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { QueryState } from '@/components/ui/query-state';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import {
  EditorialSectionHeader,
  ledgerClasses,
  ledgerItemClasses,
} from '@/components/ui/workspace';
import { agentHandoffHref } from '@/lib/agent/handoff';
import {
  approachLabel,
  familyLabel,
  measurementLegLabel,
  targetKindLabel,
} from '@/lib/agent/vocabulary';
import { actionsMutations, actionsQueries, type ActionDetail } from '@/lib/api/actions';
import { agentQueries } from '@/lib/api/agent';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { queryKeys } from '@/lib/api/query-keys';
import { readableUrl } from '@/lib/format';
import { useProjectContext, useWorkspaceCapability } from '@/lib/project/project-context';

const BACK = { href: '/agent/actions', label: 'Back to Actions' } as const;

/** One Action: diagnosis, member evidence, its declaration and linked chats. */
export function ActionDetailScreen() {
  const { actionId = '' } = useParams();
  const { activeProjectId, activeWorkspaceId } = useProjectContext();
  const query = useQuery({
    ...actionsQueries.detail(activeWorkspaceId ?? '', actionId),
    enabled: Boolean(activeWorkspaceId && actionId),
  });

  if (query.isError)
    return (
      <DetailScreen back={BACK}>
        <QueryState
          kind="error"
          {...readErrorProps(query)}
          fallback="This Action could not be loaded."
        />
      </DetailScreen>
    );
  if (!activeWorkspaceId)
    return (
      <DetailScreen back={BACK}>
        <Callout tone="info">Choose a workspace to open this Action.</Callout>
      </DetailScreen>
    );
  if (!query.data)
    return (
      <DetailScreen back={BACK}>
        <QueryState kind="loading" />
      </DetailScreen>
    );
  if (query.data.project_id !== activeProjectId)
    return (
      <DetailScreen back={BACK}>
        <Callout tone="negative">
          This Action belongs to another project. Choose an Action from the current project.
        </Callout>
      </DetailScreen>
    );
  // Keyed so a mutation's state (and its Retry) never outlives its Action.
  return (
    <ActionDetailView
      key={query.data.id}
      action={query.data}
      workspaceId={activeWorkspaceId ?? ''}
    />
  );
}

function ActionDetailView({
  action,
  workspaceId,
}: Readonly<{ action: ActionDetail; workspaceId: string }>) {
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  // Owned here, not by the controls, so a failure notice renders in the body
  // and the one-row header never has to hold it.
  const update = useStatusUpdate(workspaceId);
  return (
    <DetailScreen
      title={readableUrl(action.target_label)}
      back={{ ...BACK, projectId: action.project_id }}
      actions={<ActionControls action={action} update={update} />}
      lead={<ActionFacts action={action} />}
      aside={
        <>
          <TextList title="Avoid" items={action.diagnosis.donts ?? []} />
          <TextList
            title="Measure with"
            items={(action.diagnosis.measure_with ?? []).map(measurementLegLabel).filter(isText)}
          />
        </>
      }
    >
      {update.isError ? (
        <MutationNotice
          notice={mutationNoticeForError(update.error, {
            action: 'update this Action',
          })}
          onRetry={() => update.variables && update.mutate(update.variables)}
        />
      ) : null}
      <Diagnosis action={action} onOpenEvidence={setEvidenceId} />
      <Implementation action={action} workspaceId={workspaceId} />
      <LinkedChats action={action} workspaceId={workspaceId} />
      <EvidenceDrawer
        opportunityId={evidenceId}
        projectId={action.project_id}
        open={evidenceId !== null}
        onOpenChange={(open) => {
          if (!open) setEvidenceId(null);
        }}
      />
    </DetailScreen>
  );
}

function useStatusUpdate(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    ...actionsMutations.updateStatus(workspaceId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.actions.all }),
  });
}

type StatusUpdate = ReturnType<typeof useStatusUpdate>;

function ActionControls({
  action,
  update,
}: Readonly<{ action: ActionDetail; update: StatusUpdate }>) {
  const mayWrite = useWorkspaceCapability('write');
  const dismissed = action.status === 'dismissed';
  return (
    <>
      {mayWrite ? (
        <Button
          variant="secondary"
          disabled={update.isPending}
          onClick={() =>
            update.mutate({
              actionId: action.id,
              status: dismissed ? 'open' : 'dismissed',
            })
          }
        >
          {dismissed ? 'Reopen' : 'Dismiss'}
        </Button>
      ) : null}
      <Button asChild variant="primary">
        <ProjectLink href={agentHandoffHref({ actionId: action.id })}>Work on this</ProjectLink>
      </Button>
    </>
  );
}

function ActionFacts({ action }: Readonly<{ action: ActionDetail }>) {
  const facts: Fact[] = [
    { label: 'Status', value: <ActionStatusBadge status={action.status} /> },
    { label: 'Priority', value: <ActionPriorityBadge score={action.priority_score} /> },
    { label: 'Target', value: targetKindLabel(action.target_kind) ?? 'Target' },
  ];
  const sources = action.families.map(familyLabel).filter(isText);
  if (sources.length) facts.push({ label: 'Source', value: sources.join(', ') });
  return (
    <Stack as="section" aria-label="Summary">
      {action.target_url ? (
        <TextLink
          variant="external"
          href={action.target_url}
          text="body"
          className="justify-self-start break-all"
        >
          {action.target_url}
        </TextLink>
      ) : null}

      <FactList layout="inline" facts={facts} />
      {action.evidence_cleared_at ? (
        <Callout tone="info">No current evidence targets this Action. Its chats are kept.</Callout>
      ) : null}
    </Stack>
  );
}

function Diagnosis({
  action,
  onOpenEvidence,
}: Readonly<{ action: ActionDetail; onOpenEvidence: (id: string) => void }>) {
  return (
    <Card aria-labelledby="action-diagnosis">
      <CardHeader>
        <CardTitle id="action-diagnosis">Diagnosis</CardTitle>
      </CardHeader>
      <CardContent>
        {action.members.length === 0 ? (
          <QueryState kind="empty" inline message="No current finding targets this Action." />
        ) : (
          <ul className={ledgerClasses()}>
            {action.members.map((member) => (
              <Inline
                as="li"
                key={member.id}
                gap="compact"
                className={ledgerItemClasses('flex-wrap items-start')}
              >
                <Stack as="span" gap="tight" className="min-w-0 flex-1">
                  <span className={textRole('itemTitle')}>{member.title}</span>
                  <span className={textRole('caption')}>{member.remediation}</span>
                </Stack>
                <Button variant="ghost" onClick={() => onOpenEvidence(member.id)}>
                  View evidence
                </Button>
              </Inline>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const isText = (value: string | null): value is string => Boolean(value);

/**
 * The declaration loop: what was declared and what each leg awaits,
 * or the way to declare work done outside CiteLadder. An Agent output is
 * declared from its chat, which names the exact revision shipped.
 */
function Implementation({
  action,
  workspaceId,
}: Readonly<{ action: ActionDetail; workspaceId: string }>) {
  const mayWrite = useWorkspaceCapability('write');
  const [declared, setDeclared] = useState(false);
  const approach = approachLabel(action.diagnosis.approach ?? action.approach);
  const canDeclare = isDeclarable(action) && mayWrite;
  if (!action.declaration && !canDeclare && !approach) return null;
  let declarationBody: ReactNode = null;
  if (action.declaration) {
    declarationBody = (
      <DeclarationStatus
        declaration={action.declaration}
        workspaceId={workspaceId}
        focusOnMount={declared}
      />
    );
  } else if (canDeclare) {
    declarationBody = (
      <Stack>
        <p className={textRole('body')}>
          When this work is live, declare it so CiteLadder can measure it. To declare an Agent
          output, use Mark implemented in its chat.
        </p>
        <div>
          {action.members.some((member) => member.rule_id === 'site_contextual_links') ? (
            <ContextualLinkDeclarationRoute />
          ) : (
            <MarkImplementedButton
              workspaceId={workspaceId}
              action={action}
              revision={null}
              onDeclared={() => setDeclared(true)}
            />
          )}
        </div>
      </Stack>
    );
  }
  return (
    <Card aria-labelledby="action-implementation">
      <CardHeader>
        <CardTitle id="action-implementation">Implementation</CardTitle>
      </CardHeader>
      <CardContent>
        <Stack>
          {approach ? <p className={textRole('itemTitle')}>{approach}</p> : null}
          {declarationBody}
        </Stack>
      </CardContent>
    </Card>
  );
}

function TextList({ title, items }: Readonly<{ title: string; items: string[] }>) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Stack as="ul" gap="tight" className="list-inside list-disc">
          {items.map((item) => (
            <li key={item} className={textRole('body')}>
              {item}
            </li>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

function LinkedChats({
  action,
  workspaceId,
}: Readonly<{ action: ActionDetail; workspaceId: string }>) {
  const { kindLabel } = useAgentCatalog();
  const chats = useInfiniteQuery(
    agentQueries.chats(workspaceId, action.project_id, { actionId: action.id }),
  );
  const rows = chats.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Stack as="section" aria-labelledby="action-chats">
      <EditorialSectionHeader title="Chats" headingId="action-chats" />
      {chats.isError ? (
        <ReadError {...readErrorProps(chats)} fallback="Linked chats could not be loaded." />
      ) : null}
      {chats.isSuccess && rows.length === 0 ? (
        <QueryState kind="empty" inline message="No chats have worked on this Action yet." />
      ) : null}
      {rows.length > 0 ? (
        <Stack as="ul" gap="compact">
          {rows.map((chat) => (
            <Stack as="li" gap="tight" key={chat.id} className={cardClasses()}>
              <TextLink
                href={`/agent/chats/${chat.id}`}
                text="itemTitle"
                className="justify-self-start"
              >
                {chat.title}
              </TextLink>
              {chat.output_kind ? (
                <span className={textRole('caption')}>{kindLabel(chat.output_kind)}</span>
              ) : null}
            </Stack>
          ))}
        </Stack>
      ) : null}
      {chats.hasNextPage ? (
        <Button
          variant="secondary"
          className="justify-self-start"
          disabled={chats.isFetchingNextPage}
          onClick={() => void chats.fetchNextPage()}
        >
          Show more chats
        </Button>
      ) : null}
    </Stack>
  );
}

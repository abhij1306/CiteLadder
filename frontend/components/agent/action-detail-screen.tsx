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
import { ActionStatusBadge } from '@/components/agent/action-status-badge';
import { PageLoading } from '@/components/layout/page-loading';
import { PageShell } from '@/components/layout/page-shell';
import { ProjectLink } from '@/components/layout/scoped-link';
import { EvidenceDrawer } from '@/components/opportunities/evidence-drawer';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { Button } from '@/components/ui/button';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { Stack } from '@/components/ui/layout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { panelClasses } from '@/components/ui/panel';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { EditorialSectionHeader, ledgerClasses, splitPaneClasses } from '@/components/ui/workspace';
import { agentHandoffHref } from '@/lib/agent/handoff';
import {
  approachLabel,
  familyLabel,
  FAMILY_STATE_LABEL,
  measurementLegLabel,
  OUTPUT_PHASE_LABEL,
  targetKindLabel,
} from '@/lib/agent/vocabulary';
import { actionsMutations, actionsQueries, type ActionDetail } from '@/lib/api/actions';
import { agentQueries } from '@/lib/api/agent';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { queryKeys } from '@/lib/api/query-keys';
import { useProjectContext, useWorkspaceCapability } from '@/lib/project/project-context';

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
      <PageShell>
        <ReadError {...readErrorProps(query)} fallback="This Action could not be loaded." />
      </PageShell>
    );
  if (!activeWorkspaceId)
    return (
      <PageShell>
        <Alert tone="info">Choose a workspace to open this Action.</Alert>
      </PageShell>
    );
  if (!query.data)
    return (
      <PageShell>
        <PageLoading />
      </PageShell>
    );
  if (query.data.project_id !== activeProjectId)
    return (
      <PageShell>
        <Alert tone="danger">
          This Action belongs to another project. Choose an Action from the current project.
        </Alert>
      </PageShell>
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
    <PageShell
      title={action.target_label}
      back={{ href: '/agent/actions', label: 'Back to Actions', projectId: action.project_id }}
      actions={<ActionControls action={action} update={update} />}
    >
      <Stack gap="section">
        {update.isError ? (
          <MutationNotice
            notice={mutationNoticeForError(update.error, { action: 'update this Action' })}
            onRetry={() => update.variables && update.mutate(update.variables)}
          />
        ) : null}
        <ActionFacts action={action} />
        <div className={splitPaneClasses('main-aside')}>
          <Stack gap="workspace" className="min-w-0">
            <Diagnosis action={action} onOpenEvidence={setEvidenceId} />
            <Implementation action={action} workspaceId={workspaceId} />
          </Stack>
          <Stack as="aside" gap="workspace" className="min-w-0">
            <ActionEvidence action={action} />
            <TextList title="Avoid" items={action.diagnosis.donts ?? []} />
            <TextList
              title="Measure with"
              items={(action.diagnosis.measure_with ?? []).map(measurementLegLabel).filter(isText)}
            />
          </Stack>
        </div>
        <LinkedChats action={action} workspaceId={workspaceId} />
      </Stack>
      <EvidenceDrawer
        opportunityId={evidenceId}
        projectId={action.project_id}
        open={evidenceId !== null}
        onOpenChange={(open) => {
          if (!open) setEvidenceId(null);
        }}
      />
    </PageShell>
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
          size="sm"
          disabled={update.isPending}
          onClick={() =>
            update.mutate({ actionId: action.id, status: dismissed ? 'open' : 'dismissed' })
          }
        >
          {dismissed ? 'Reopen' : 'Dismiss'}
        </Button>
      ) : null}
      <Button asChild size="sm">
        <ProjectLink href={agentHandoffHref({ actionId: action.id })}>Work on this</ProjectLink>
      </Button>
    </>
  );
}

function ActionFacts({ action }: Readonly<{ action: ActionDetail }>) {
  const facts: { label: string; value: React.ReactNode }[] = [
    { label: 'Status', value: <ActionStatusBadge status={action.status} /> },
    {
      label: 'Priority',
      value: action.priority_score === null ? 'Not scored yet' : action.priority_score.toFixed(1),
    },
    {
      label: 'Evidence',
      value: `${action.families.length} ${action.families.length === 1 ? 'system' : 'systems'}`,
    },
    { label: 'Target', value: targetKindLabel(action.target_kind) ?? 'Target' },
  ];
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

      <dl className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {facts.map((fact) => (
          <div key={fact.label} className="flex items-center gap-2">
            <dt className={textRole('label')}>{fact.label}</dt>
            <dd className={textRole('body')}>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {action.evidence_cleared_at ? (
        <Alert tone="info">No current evidence targets this Action. Its chats are kept.</Alert>
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
          <InlineEmpty>No current finding targets this Action.</InlineEmpty>
        ) : (
          <ul className={ledgerClasses()}>
            {action.members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-start gap-3 py-3">
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className={textRole('itemTitle')}>{member.title}</span>
                  <span className={textRole('caption')}>{member.remediation}</span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => onOpenEvidence(member.id)}>
                  View evidence
                </Button>
              </li>
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
        <ul className="grid list-disc gap-1 ps-5">
          {items.map((item) => (
            <li key={item} className={textRole('body')}>
              {item}
            </li>
          ))}
        </ul>
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
        <InlineEmpty>No chats have worked on this Action yet.</InlineEmpty>
      ) : null}
      {rows.length > 0 ? (
        <ul className="grid gap-2">
          {rows.map((chat) => (
            <li key={chat.id} className={panelClasses({ pad: 'compact' }, 'grid gap-0.5')}>
              <TextLink
                href={`/agent/chats/${chat.id}`}
                text="itemTitle"
                className="justify-self-start"
              >
                {chat.title}
              </TextLink>
              {chat.output_kind && chat.output_phase ? (
                <span className={textRole('caption')}>
                  {kindLabel(chat.output_kind)} · {OUTPUT_PHASE_LABEL[chat.output_phase]}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {chats.hasNextPage ? (
        <Button
          variant="secondary"
          size="sm"
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

function ActionEvidence({ action }: Readonly<{ action: ActionDetail }>) {
  const families = Object.entries(action.diagnosis.families ?? {}).filter(([family]) =>
    familyLabel(family),
  );
  const supporting = families.filter(([, state]) => state === 'observed');
  const other = families.filter(([, state]) => state !== 'observed');
  const sources = (rows: typeof families) => (
    <dl className="grid gap-3">
      {rows.map(([family, state]) => (
        <div key={family} className="flex flex-wrap items-center justify-between gap-2">
          <dt className={textRole(state === 'observed' ? 'itemTitle' : 'body')}>
            {familyLabel(family)}
          </dt>
          <dd className={textRole('caption')}>{FAMILY_STATE_LABEL[state]}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Evidence</CardTitle>
      </CardHeader>
      <CardContent>
        <Stack>
          {sources(supporting)}
          {other.length > 0 ? (
            <Disclosure title={`Other sources (${other.length})`}>{sources(other)}</Disclosure>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import {
  isDeclarable,
  MarkImplementedButton,
  ContextualLinkDeclarationRoute,
} from '@/components/agent/action-declaration';
import { AffectedPages } from '@/components/agent/action-affected-pages';
import { ContentGapWhy, contentGapMembers } from '@/components/agent/content-gap-evidence';
import { DeclarationStatus } from '@/components/agent/declaration-status';
import { ActionEvidence, DeveloperTicketButton } from '@/components/agent/developer-ticket';
import { useAgentCatalog } from '@/components/agent/use-agent-catalog';
import { ActionPriorityBadge, ActionStatusBadge } from '@/components/agent/action-status-badge';
import { DetailScreen, type PageBack } from '@/components/layout/page-shell';
import { ProjectLink } from '@/components/ui/project-link';
import { EvidenceDrawer } from '@/components/opportunities/evidence-drawer';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FloatingBar } from '@/components/ui/floating-bar';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { FactList, type Fact } from '@/components/ui/facts';
import { Icon } from '@/components/ui/icon';
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
import { actionHandoffHref } from '@/lib/agent/handoff';
import {
  approachLabel,
  familyLabel,
  measurementLegLabel,
  targetKindLabel,
} from '@/lib/agent/vocabulary';
import { actionsMutations, actionsQueries, type ActionDetail } from '@/lib/api/actions';
import { agentQueries } from '@/lib/api/agent';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { readableUrl, shortUrlTitle } from '@/lib/format';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useWorkspaceCapability } from '@/lib/project/project-context';

const ACTIONS = '/agent/actions';
const BACK: PageBack = { href: ACTIONS, label: 'Back to Actions' };

/**
 * One Action (AS7): a single centered column at the thread width, named in
 * the one-line header by a short title (a URL's host and last segment), read
 * top to bottom (overview with Prepare developer ticket, details, dated
 * evidence, why, what to do, how it is measured, the findings and the chats),
 * with its three actions in a bar floating at the
 * bottom: Dismiss, Mark implemented, and Work with the agent.
 */
export function ActionDetailScreen() {
  const { actionId = '' } = useParams();
  const { workspaceId, projectId } = useProjectScope();
  const query = useQuery({
    ...actionsQueries.detail(workspaceId, actionId),
    enabled: Boolean(actionId),
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
  if (!query.data)
    return (
      <DetailScreen back={BACK}>
        <QueryState kind="loading" />
      </DetailScreen>
    );
  if (query.data.project_id !== projectId)
    return (
      <DetailScreen back={BACK}>
        <Callout tone="negative">
          This Action belongs to another project. Choose an Action from the current project.
        </Callout>
      </DetailScreen>
    );
  // Keyed so a mutation's state (and its Retry) never outlives its Action.
  return <ActionDetailView key={query.data.id} action={query.data} workspaceId={workspaceId} />;
}

function ActionDetailView({
  action,
  workspaceId,
}: Readonly<{ action: ActionDetail; workspaceId: string }>) {
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  // Set once this page declares the Action, so its new status takes focus.
  const [declared, setDeclared] = useState(false);
  // Owned here, not by the bar, so a failure notice renders in the column.
  const update = useMutation(actionsMutations.updateStatus(workspaceId));
  const gaps = contentGapMembers(action);
  return (
    <DetailScreen
      column
      title={shortUrlTitle(action.target_label)}
      back={{ ...BACK, projectId: action.project_id }}
    >
      <Breadcrumb label={readableUrl(action.target_label)} />
      {update.isError ? (
        <MutationNotice
          notice={mutationNoticeForError(update.error, {
            action: 'update this Action',
          })}
          onRetry={() => update.variables && update.mutate(update.variables)}
        />
      ) : null}
      <Overview action={action} />
      <Details action={action} />
      <AffectedPages action={action} />
      <ActionEvidence action={action} />
      {action.declaration ? (
        <Section title="Implementation" id="action-implementation">
          <DeclarationStatus
            declaration={action.declaration}
            workspaceId={workspaceId}
            focusOnMount={declared}
          />
        </Section>
      ) : null}
      {gaps.length > 0 ? <ContentGapWhy members={gaps} /> : null}
      <WhatToDo action={action} />
      <TextList
        title="Measure with"
        id="action-measure"
        items={(action.diagnosis.measure_with ?? []).map(measurementLegLabel).filter(isText)}
      />
      <TextList title="Avoid" id="action-avoid" items={action.diagnosis.donts ?? []} />
      <Findings action={action} onOpenEvidence={setEvidenceId} />
      <LinkedChats action={action} workspaceId={workspaceId} />
      <ActionBar
        action={action}
        workspaceId={workspaceId}
        dismissing={update.isPending}
        onStatus={(status) => update.mutate({ actionId: action.id, status })}
        onDeclared={() => setDeclared(true)}
      />
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

/**
 * Where the Action sits: Actions, then this Action by its full target (the
 * header names it short), kept to one row like every long URL in the app,
 * with the whole target in its tooltip.
 */
function Breadcrumb({ label }: Readonly<{ label: string }>) {
  return (
    <nav aria-label="Breadcrumb">
      <Inline as="ol" gap="tight">
        <Inline as="li" gap="tight" className="shrink-0">
          <TextLink href={ACTIONS} text="caption">
            Actions
          </TextLink>
          <Icon icon={ChevronRight} className="text-ink-muted" />
        </Inline>
        <li className="min-w-0">
          <span aria-current="page" title={label} className={textRole('caption', 'block truncate')}>
            {label}
          </span>
        </li>
      </Inline>
    </nav>
  );
}

/** A headed section of the column; its heading names it for assistive technology. */
function Section({
  title,
  id,
  actions,
  children,
}: Readonly<{ title: string; id: string; actions?: ReactNode; children: ReactNode }>) {
  return (
    <Stack as="section" aria-labelledby={id}>
      <EditorialSectionHeader title={title} headingId={id} actions={actions} />
      {children}
    </Stack>
  );
}

/** Each distinct instruction of the Action's findings, in priority order. */
function steps(action: ActionDetail): string[] {
  return [...new Set(action.members.map((member) => member.remediation).filter(isText))];
}

/**
 * What Copy as prompt puts on the clipboard: the message the Agent chat opens
 * with, then the Action's steps, for a reader working in another assistant.
 */
function actionPrompt(action: ActionDetail): string {
  const todo = steps(action);
  if (todo.length === 0) return action.handoff.message;
  const lines = todo.map((step, index) => `${index + 1}. ${step}`);
  return [action.handoff.message, '', 'What to do:', ...lines].join('\n');
}

/** What happened: the findings the diagnosis names, and the work it asks for. */
function Overview({ action }: Readonly<{ action: ActionDetail }>) {
  const happened = [...new Set(action.members.map((member) => member.title))];
  return (
    <Section
      title="Overview"
      id="action-overview"
      actions={
        <Inline gap="compact" className="flex-wrap">
          <DeveloperTicketButton action={action} />
          <CopyButton value={actionPrompt(action)}>Copy as prompt</CopyButton>
        </Inline>
      }
    >
      <p className={textRole('body', 'text-ink')}>{action.handoff.message}</p>
      {happened.length > 0 ? (
        <Stack as="ul" gap="tight" className="list-inside list-disc">
          {happened.map((item) => (
            <li key={item} className={textRole('body', 'text-ink')}>
              {item}
            </li>
          ))}
        </Stack>
      ) : (
        <QueryState kind="empty" inline message="No current finding targets this Action." />
      )}
      {action.evidence_cleared_at ? (
        <Callout tone="info">No current evidence targets this Action. Its chats are kept.</Callout>
      ) : null}
    </Section>
  );
}

/** The Action's facts, one ruled row each. */
function Details({ action }: Readonly<{ action: ActionDetail }>) {
  const approach = approachLabel(action.diagnosis.approach ?? action.approach);
  const sources = action.families.map(familyLabel).filter(isText);
  const target = targetKindLabel(action.target_kind) ?? 'Target';
  const facts: Fact[] = [
    { label: 'Status', value: <ActionStatusBadge status={action.status} /> },
    { label: 'Priority', value: <ActionPriorityBadge band={action.priority_band} /> },
  ];
  if (approach) facts.push({ label: 'Action type', value: approach });
  facts.push({
    label: 'Target',
    value: action.target_url ? (
      <Inline gap="compact" className="flex-wrap">
        <span>{target}</span>
        <TextLink variant="external" href={action.target_url} text="body">
          Open the page
        </TextLink>
      </Inline>
    ) : (
      target
    ),
  });
  if (sources.length) facts.push({ label: 'Source', value: sources.join(', ') });
  return (
    <Card aria-labelledby="action-details">
      <CardHeader>
        <CardTitle id="action-details">Details</CardTitle>
      </CardHeader>
      <CardContent>
        <FactList layout="ruled" facts={facts} />
      </CardContent>
    </Card>
  );
}

function WhatToDo({ action }: Readonly<{ action: ActionDetail }>) {
  const todo = steps(action);
  if (todo.length === 0) return null;
  return (
    <Section title="What to do" id="action-todo">
      <Stack as="ol" gap="tight" className="list-inside list-decimal">
        {todo.map((step) => (
          <li key={step} className={textRole('body', 'text-ink')}>
            {step}
          </li>
        ))}
      </Stack>
    </Section>
  );
}

function TextList({
  title,
  id,
  items,
}: Readonly<{ title: string; id: string; items: readonly string[] }>) {
  if (items.length === 0) return null;
  return (
    <Section title={title} id={id}>
      <Stack as="ul" gap="tight" className="list-inside list-disc">
        {items.map((item) => (
          <li key={item} className={textRole('body', 'text-ink')}>
            {item}
          </li>
        ))}
      </Stack>
    </Section>
  );
}

/** The live findings the Action groups, each with its evidence. */
function Findings({
  action,
  onOpenEvidence,
}: Readonly<{ action: ActionDetail; onOpenEvidence: (id: string) => void }>) {
  if (action.members.length === 0) return null;
  return (
    <Section title="Findings" id="action-findings">
      <Card>
        <CardContent>
          <ul className={ledgerClasses()}>
            {action.members.map((member) => (
              <Inline
                as="li"
                key={member.id}
                gap="compact"
                className={ledgerItemClasses('flex-wrap items-start')}
              >
                <span className={textRole('itemTitle', 'min-w-0 flex-1')}>{member.title}</span>
                <Button variant="ghost" onClick={() => onOpenEvidence(member.id)}>
                  View evidence
                </Button>
              </Inline>
            ))}
          </ul>
        </CardContent>
      </Card>
    </Section>
  );
}

const isText = (value: string | null): value is string => Boolean(value);

/**
 * The page's three actions, floating at the bottom of the column while it
 * scrolls and resting after its last section: Dismiss (Reopen once
 * dismissed), Mark implemented while the Action can be declared, and Work
 * with the agent, the page's primary action. A declared Action keeps only
 * the Agent. An Agent output is declared from its chat, which names the
 * exact revision shipped; here Mark implemented declares work done outside
 * CiteLadder.
 */
function ActionBar({
  action,
  workspaceId,
  dismissing,
  onStatus,
  onDeclared,
}: Readonly<{
  action: ActionDetail;
  workspaceId: string;
  dismissing: boolean;
  onStatus: (status: 'open' | 'dismissed') => void;
  onDeclared: () => void;
}>) {
  const mayWrite = useWorkspaceCapability('write');
  const dismissed = action.status === 'dismissed';
  const undeclared = mayWrite && !action.declaration;
  const linkRoute = action.members.some((member) => member.rule_id === 'site_contextual_links');
  let declare: ReactNode = null;
  if (undeclared && isDeclarable(action))
    declare = linkRoute ? (
      <ContextualLinkDeclarationRoute />
    ) : (
      <MarkImplementedButton
        workspaceId={workspaceId}
        action={action}
        revision={null}
        variant="secondary"
        onDeclared={onDeclared}
      />
    );
  return (
    <FloatingBar label="Work on this Action">
      {undeclared ? (
        <Button
          variant="secondary"
          disabled={dismissing}
          onClick={() => onStatus(dismissed ? 'open' : 'dismissed')}
        >
          {dismissed ? 'Reopen' : 'Dismiss'}
        </Button>
      ) : null}
      {declare}
      <Button asChild variant="primary">
        <ProjectLink href={actionHandoffHref(action)}>Work with the agent</ProjectLink>
      </Button>
    </FloatingBar>
  );
}

function LinkedChats({
  action,
  workspaceId,
}: Readonly<{ action: ActionDetail; workspaceId: string }>) {
  const { kindLabel } = useAgentCatalog();
  const chats = useInfiniteQuery(
    agentQueries.chats({ workspaceId, projectId: action.project_id }, { actionId: action.id }),
  );
  const rows = chats.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Section title="Chats" id="action-chats">
      {chats.isError ? (
        <ReadError {...readErrorProps(chats)} fallback="Linked chats could not be loaded." />
      ) : null}
      {chats.isSuccess && rows.length === 0 ? (
        <QueryState kind="empty" inline message="No chats have worked on this Action yet." />
      ) : null}
      {rows.length > 0 ? (
        // One list in one card: a card per chat stacked boxes for a single row
        // of text each.
        <Card>
          <CardContent>
            <ul className={ledgerClasses()}>
              {rows.map((chat) => (
                <Stack as="li" gap="tight" key={chat.id} className={ledgerItemClasses()}>
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
            </ul>
          </CardContent>
        </Card>
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
    </Section>
  );
}

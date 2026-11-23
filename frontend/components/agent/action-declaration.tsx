import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { DeclarationStatus } from '@/components/agent/declaration-status';
import { ProjectLink } from '@/components/ui/project-link';
import { ActionButton } from '@/components/ui/actions';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Inline, Stack } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';
import { ListChecks } from '@/lib/icons';
import { newIdempotencyKey } from '@/lib/agent/idempotency';
import { contentGapCheckPreview, measurementLegLabel } from '@/lib/agent/vocabulary';
import { actionsMutations, actionsQueries, type ActionDetail } from '@/lib/api/actions';
import { agentMutations, type AgentOutput } from '@/lib/api/agent';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import {
  declarationDays,
  declaredInstant,
  isDeclarableDay,
  localDay,
} from '@/lib/opportunities/declaration-date';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { Notice, readErrorProps } from '@/components/ui/notice';

type Declarable = Pick<
  ActionDetail,
  'id' | 'project_id' | 'members' | 'member_measurement' | 'declarable_since'
>;

type MarkImplementedProps = Readonly<{
  workspaceId: string;
  action: Declarable;
  revision: { id: string; number: number } | null;
  disabled?: boolean;
  recommendationIds?: string[];
  onDeclared?: () => void;
  proposed?: Proposed;
}>;

export function MarkImplementedButton(props: MarkImplementedProps) {
  const { start, dialog } = useMarkImplemented(props);
  return (
    <>
      <ActionButton action="markImplemented" disabled={props.disabled} onClick={start} />
      {dialog}
    </>
  );
}

export function useMarkImplemented({
  workspaceId,
  action,
  revision,
  recommendationIds,
  onDeclared,
  proposed,
}: MarkImplementedProps) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(() => newAttempt(proposed));
  const declare = useMutation(actionsMutations.declare(workspaceId));
  const range = declarationDays(action.declarable_since, attempt.openedAt);
  const valid = isDeclarableDay(attempt.day, range);
  const submit = () =>
    declare.mutate(
      {
        actionId: action.id,
        projectId: action.project_id,
        idempotencyKey: attempt.idempotencyKey,
        input: {
          output_revision_id: revision?.id ?? null,
          declared_implemented_at: declaredInstant(attempt.day, attempt.openedAt),
          deployment_reference: attempt.reference.trim() || null,
          ...(recommendationIds ? { recommendation_ids: recommendationIds } : {}),
        },
      },
      {
        onSuccess: () => {
          setOpen(false);
          onDeclared?.();
        },
      },
    );
  const start = () => {
    declare.reset();
    setAttempt(newAttempt(proposed));
    setOpen(true);
  };
  const dialog = (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Mark implemented"
      description={revision ? `Revision ${revision.number}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            pending={declare.isPending}
            pendingLabel="Declaring…"
            disabled={!valid}
            onClick={submit}
          >
            Declare implemented
          </Button>
        </>
      }
    >
      <Stack gap="workspace">
        <Field
          label="When did it go live?"
          hint={`From ${range.min}. Earlier readings are not counted.`}
          error={valid ? undefined : `Choose a day from ${range.min} to ${range.max}.`}
        >
          {(field) => (
            <DateField
              {...field}
              ariaLabel="Go-live date"
              value={attempt.day}
              min={range.min}
              max={range.max}
              disabled={declare.isPending}
              onChange={(day) => {
                declare.reset();
                setAttempt((current) => ({
                  ...current,
                  day,
                  idempotencyKey: newIdempotencyKey(),
                }));
              }}
            />
          )}
        </Field>
        <Field label="What shipped it?" hint="Optional">
          {(field) => (
            <Input
              {...field}
              value={attempt.reference}
              maxLength={DEPLOYMENT_REFERENCE_MAX}
              disabled={declare.isPending}
              onChange={(event) => {
                const reference = event.target.value;
                declare.reset();
                setAttempt((current) => ({
                  ...current,
                  reference,
                  idempotencyKey: newIdempotencyKey(),
                }));
              }}
            />
          )}
        </Field>
        <MeasurementPreview action={action} />
        {recommendationIds ? (
          <p className={textRole('body', 'text-ink-2')}>
            Measures only these {recommendationIds.length} links and the page&apos;s other findings.
            Declared once.
          </p>
        ) : null}
        {declare.isError ? (
          <Notice
            kind="mutation"
            notice={mutationNoticeForError(declare.error, {
              action: 'declare this Action implemented',
            })}
            onRetry={submit}
          />
        ) : null}
      </Stack>
    </Dialog>
  );
  return { start, dialog };
}

export function MarkActionImplemented({
  workspaceId,
  actionId,
  ...props
}: Readonly<
  Omit<Parameters<typeof MarkImplementedButton>[0], 'action'> & {
    actionId: string;
  }
>) {
  const action = useQuery(actionsQueries.detail(workspaceId, actionId));
  if (action.isError)
    return (
      <Notice
        kind="read"
        {...readErrorProps(action)}
        title="Couldn't load the Action"
        fallback="The Action could not be loaded to declare it."
      />
    );
  if (!action.data) return null;
  return <MarkImplementedButton workspaceId={workspaceId} action={action.data} {...props} />;
}

function MeasurementPreview({ action }: Readonly<{ action: Declarable }>) {
  if (action.members.length === 0) return null;
  return (
    <Stack gap="compact">
      <p className={textRole('body', 'text-ink-2')}>What CiteLadder will check</p>
      <Stack as="ul" gap="compact">
        {action.members.map((member) => {
          const leg = action.member_measurement[member.id] ?? null;
          return (
            <Stack as="li" gap="tight" key={member.id}>
              <span className={textRole('body')}>{member.title}</span>
              {leg && member.content_gap_evidence ? (
                <span className={textRole('caption', 'break-words')}>
                  {contentGapCheckPreview(member.content_gap_evidence)}
                </span>
              ) : null}
              <span className={textRole('caption')}>
                {leg
                  ? `Measured by ${measurementLegLabel(leg)?.toLowerCase() ?? 'the next reading'}.`
                  : 'No automatic check: no reading isolates this change.'}
              </span>
            </Stack>
          );
        })}
      </Stack>
      <p className={textRole('caption')}>An Action can be declared once.</p>
    </Stack>
  );
}

export function isDeclarable(action: { status: string; declarable_member_count: number }): boolean {
  return (
    (action.status === 'open' || action.status === 'in_progress') &&
    action.declarable_member_count > 0
  );
}

const DEPLOYMENT_REFERENCE_MAX = 500;

type Proposed = { day: string | null; reference: string | null };

function newAttempt(proposed?: Proposed) {
  const openedAt = new Date();
  return {
    idempotencyKey: newIdempotencyKey(),
    openedAt,
    day: proposed?.day ?? localDay(openedAt),
    reference: proposed?.reference ?? '',
  };
}

export function OutputDeclaration({
  workspaceId,
  chatId,
  output,
  runActive,
  canEdit,
}: Readonly<{
  workspaceId: string;
  chatId: string;
  output: AgentOutput;
  runActive: boolean;
  canEdit: boolean;
}>) {
  const revision = output.latest_revision;
  if (!revision) return null;
  if (!output.action_id)
    return <p className={textRole('caption')}>Name a page or topic to declare it implemented.</p>;
  if (output.named_target)
    return (
      <TargetChoice
        workspaceId={workspaceId}
        chatId={chatId}
        outputId={output.id}
        named={output.named_target}
        disabled={runActive || !canEdit}
      />
    );
  return (
    <AttachedDeclaration
      workspaceId={workspaceId}
      actionId={output.action_id}
      revision={revision}
      runActive={runActive}
    />
  );
}

type NamedTarget = NonNullable<AgentOutput['named_target']>;

function targetName(named: NamedTarget) {
  if (named.kind === 'planned_page') return named.target;
  try {
    const url = new URL(named.target);
    return `${url.pathname}${url.search}`;
  } catch {
    return named.target;
  }
}

function TargetChoice({
  workspaceId,
  chatId,
  outputId,
  named,
  disabled,
}: Readonly<{
  workspaceId: string;
  chatId: string;
  outputId: string;
  named: NamedTarget;
  disabled: boolean;
}>) {
  const choose = useMutation(agentMutations.chooseOutputTarget(workspaceId));
  const name = targetName(named);
  const submit = (decision: 'link' | 'keep') => choose.mutate({ chatId, outputId, decision });
  const pending = (decision: 'link' | 'keep') =>
    choose.isPending && choose.variables?.decision === decision;
  return (
    <Stack gap="tight">
      <p className={textRole('caption', 'break-words')}>
        This document names {name}, not the page of this chat&apos;s Action.
      </p>
      <Inline className="flex-wrap">
        <Button
          variant="secondary"
          disabled={disabled || pending('keep')}
          pending={pending('link')}
          pendingLabel="Linking…"
          onClick={() => submit('link')}
        >
          Link to {name}
        </Button>
        <Button
          variant="secondary"
          disabled={disabled || pending('link')}
          pending={pending('keep')}
          pendingLabel="Keeping…"
          onClick={() => submit('keep')}
        >
          Keep with this Action
        </Button>
      </Inline>
      {choose.isError ? (
        <Notice
          kind="mutation"
          notice={mutationNoticeForError(choose.error, {
            action: 'choose where this document belongs',
          })}
        />
      ) : null}
    </Stack>
  );
}

function AttachedDeclaration({
  workspaceId,
  actionId,
  revision,
  runActive,
}: Readonly<{
  workspaceId: string;
  actionId: string;
  revision: { id: string; number: number };
  runActive: boolean;
}>) {
  const mayWrite = useWorkspaceCapability('write');
  const [declared, setDeclared] = useState(false);
  const action = useQuery(actionsQueries.detail(workspaceId, actionId));
  if (action.isError)
    return (
      <Notice
        kind="read"
        {...readErrorProps(action)}
        title="Couldn't load the implementation state"
        fallback="The Action's implementation state could not be loaded."
      />
    );
  if (!action.data) return null;
  const declaration = action.data.declaration;
  if (declaration) {
    return (
      <DeclarationStatus
        declaration={declaration}
        shownRevision={revision}
        workspaceId={workspaceId}
        focusOnMount={declared}
      />
    );
  }
  if (!isDeclarable(action.data) || !mayWrite) return null;
  if (action.data.members.some((member) => member.rule_id === 'site_contextual_links')) {
    return <ContextualLinkDeclarationRoute />;
  }
  return (
    <div>
      <MarkImplementedButton
        workspaceId={workspaceId}
        action={action.data}
        revision={{ id: revision.id, number: revision.number }}
        disabled={runActive}
        onDeclared={() => setDeclared(true)}
      />
    </div>
  );
}

const SELECT_IMPLEMENTED_LINKS = {
  label: 'Select implemented links',
  href: '/site?tab=internal-links',
  icon: ListChecks,
} as const;

export function ContextualLinkDeclarationRoute({ className }: Readonly<{ className?: string }>) {
  return (
    <Button asChild variant="secondary" className={className}>
      <ProjectLink href={SELECT_IMPLEMENTED_LINKS.href}>
        <Icon icon={SELECT_IMPLEMENTED_LINKS.icon} />
        {SELECT_IMPLEMENTED_LINKS.label}
      </ProjectLink>
    </Button>
  );
}

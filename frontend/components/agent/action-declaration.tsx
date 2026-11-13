import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

import { DeclarationStatus } from '@/components/agent/declaration-status';
import { ProjectLink } from '@/components/ui/project-link';
import { Button, type ButtonVariant } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { DateField } from '@/components/ui/date-field';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Inline, Stack } from '@/components/ui/layout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { ReadError } from '@/components/ui/read-error';
import { textRole } from '@/components/ui/typography';
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

type Declarable = Pick<
  ActionDetail,
  'id' | 'project_id' | 'members' | 'member_measurement' | 'declarable_since'
>;

/**
 * "Mark implemented": the user's explicit declaration. The server freezes the
 * targets and expected checks; the user names only the revision they shipped
 * (or none, for work done outside CiteLadder) and the day it went live.
 */
export function MarkImplementedButton({
  workspaceId,
  action,
  revision,
  disabled = false,
  recommendationIds,
  selectionDescription,
  onDeclared,
  variant = 'primary',
}: Readonly<{
  workspaceId: string;
  action: Declarable;
  /** The output revision shipped; null declares work done outside CiteLadder. */
  revision: { id: string; number: number } | null;
  disabled?: boolean;
  /** Secondary where another action is the view's primary (the Action page). */
  variant?: Extract<ButtonVariant, 'primary' | 'secondary'>;
  recommendationIds?: string[];
  selectionDescription?: string;
  onDeclared?: () => void;
}>) {
  const [open, setOpen] = useState(false);
  // One key per dialog opening and chosen day, so a retry after an ambiguous
  // failure replays the identical declaration instead of sending a request the
  // server would refuse as a reused key with changed input.
  const [attempt, setAttempt] = useState(newAttempt);
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
  return (
    <>
      <Button
        variant={variant}
        disabled={disabled}
        onClick={() => {
          declare.reset();
          setAttempt(newAttempt());
          setOpen(true);
        }}
      >
        <Icon icon={CheckCircle2} />
        Mark implemented
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Mark implemented"
        description={
          selectionDescription ??
          (revision
            ? `Declare that revision ${revision.number} of this output is live on your site.`
            : 'Declare that this work is live, done outside CiteLadder.')
        }
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
            hint={`Any day from ${range.min} to today. Readings before this day are not counted.`}
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
          <Field
            label="What shipped it?"
            hint="Optional: the release, pull request or commit. The deployment is recorded under your account."
          >
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
            <p className={textRole('body')}>
              Only these {recommendationIds.length} selected links will be measured, together with
              the page&apos;s other findings. Include every link you want to declare now; this page
              Action can be declared once.
            </p>
          ) : null}
          {declare.isError ? (
            <MutationNotice
              notice={mutationNoticeForError(declare.error, {
                action: 'declare this Action implemented',
              })}
              onRetry={submit}
            />
          ) : null}
        </Stack>
      </Dialog>
    </>
  );
}

/** `MarkImplementedButton` for a surface that holds only the Action's id. */
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
      <ReadError
        error={action.error}
        fallback="The Action could not be loaded to declare it."
        onRetry={() => void action.refetch()}
        pending={action.isFetching}
      />
    );
  if (!action.data) return null;
  return <MarkImplementedButton workspaceId={workspaceId} action={action.data} {...props} />;
}

/** What each current finding will be measured by, before the user commits. */
function MeasurementPreview({ action }: Readonly<{ action: Declarable }>) {
  if (action.members.length === 0) return null;
  return (
    <Stack gap="compact">
      <p className={textRole('label')}>What CiteLadder will check</p>
      <Stack as="ul" gap="compact">
        {action.members.map((member) => {
          const leg = action.member_measurement[member.id] ?? null;
          return (
            <Stack as="li" gap="tight" key={member.id}>
              <span className={textRole('itemTitle')}>{member.title}</span>
              {leg && member.content_gap_evidence ? (
                <span className={textRole('caption', 'break-words')}>
                  {contentGapCheckPreview(member.content_gap_evidence)}
                </span>
              ) : null}
              <span className={textRole('caption')}>
                {leg
                  ? `Measured by ${measurementLegLabel(leg)?.toLowerCase() ?? 'the next reading'}.`
                  : 'Not measured automatically: no reading isolates this change.'}
              </span>
            </Stack>
          );
        })}
      </Stack>
      <p className={textRole('caption')}>
        Nothing runs on its own, and an Action can be declared once.
      </p>
    </Stack>
  );
}

/**
 * Whether an Action can be declared now: still open, with a finding to
 * declare. A recrawl that resolved every finding leaves the last set, which
 * the server freezes; with none there is nothing to declare, and it refuses.
 */
export function isDeclarable(action: { status: string; declarable_member_count: number }): boolean {
  return (
    (action.status === 'open' || action.status === 'in_progress') &&
    action.declarable_member_count > 0
  );
}

/** The declaration request's bound on what shipped it. */
const DEPLOYMENT_REFERENCE_MAX = 500;

function newAttempt() {
  const openedAt = new Date();
  return { idempotencyKey: newIdempotencyKey(), openedAt, day: localDay(openedAt), reference: '' };
}

/**
 * The output pane's implementation state. Declaring anchors the Action to the
 * revision on screen; an output with no target has no Action to declare. A
 * document naming another page than its Action asks where it belongs first,
 * so a declaration never anchors it to the wrong Action.
 */
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
    return (
      <p className={textRole('caption')}>
        Name the page or topic this output is for to declare it implemented.
      </p>
    );
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

/** A page by its path ("/pricing"), a planned page by its topic. */
function targetName(named: NamedTarget) {
  if (named.kind === 'planned_page') return named.target;
  try {
    const url = new URL(named.target);
    return `${url.pathname}${url.search}`;
  } catch {
    return named.target;
  }
}

/** Where a document naming another page than its Action belongs: there, or with the Action. */
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
          variant="primary"
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
        <MutationNotice
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
      <ReadError
        error={action.error}
        fallback="The Action's implementation state could not be loaded."
        onRetry={() => void action.refetch()}
        pending={action.isFetching}
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

export function ContextualLinkDeclarationRoute() {
  return (
    <Button asChild variant="secondary">
      <ProjectLink href="/site?tab=internal-links">Select implemented links</ProjectLink>
    </Button>
  );
}

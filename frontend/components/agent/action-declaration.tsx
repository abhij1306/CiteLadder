'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

import { DeclarationStatus } from '@/components/agent/declaration-status';
import { ProjectLink } from '@/components/layout/scoped-link';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { ReadError } from '@/components/ui/read-error';
import { textRole } from '@/components/ui/typography';
import { newIdempotencyKey } from '@/lib/agent/idempotency';
import { measurementLegLabel } from '@/lib/agent/vocabulary';
import { actionsMutations, actionsQueries, type ActionDetail } from '@/lib/api/actions';
import type { AgentOutput } from '@/lib/api/agent';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { queryKeys } from '@/lib/api/query-keys';
import {
  declarationDays,
  declaredInstant,
  isDeclarableDay,
  localDay,
} from '@/lib/opportunities/declaration-date';
import { useWorkspaceCapability } from '@/lib/project/project-context';

type Declarable = Pick<ActionDetail, 'id' | 'members' | 'member_measurement' | 'declarable_since'>;

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
}: Readonly<{
  workspaceId: string;
  action: Declarable;
  /** The output revision shipped; null declares work done outside CiteLadder. */
  revision: { id: string; number: number } | null;
  disabled?: boolean;
  recommendationIds?: string[];
  selectionDescription?: string;
  onDeclared?: () => void;
}>) {
  const [open, setOpen] = useState(false);
  // One key per dialog opening and chosen day, so a retry after an ambiguous
  // failure replays the identical declaration instead of sending a request the
  // server would refuse as a reused key with changed input.
  const [attempt, setAttempt] = useState(newAttempt);
  const queryClient = useQueryClient();
  const declare = useMutation({
    ...actionsMutations.declare(workspaceId),
    onSuccess: () => {
      setOpen(false);
      onDeclared?.();
      void queryClient.invalidateQueries({ queryKey: queryKeys.actions.all });
      if (recommendationIds)
        void queryClient.invalidateQueries({
          queryKey: ['site-health', 'internal-links', workspaceId],
        });
    },
  });
  const range = declarationDays(action.declarable_since, attempt.openedAt);
  const valid = isDeclarableDay(attempt.day, range);
  const submit = () =>
    declare.mutate({
      actionId: action.id,
      idempotencyKey: attempt.idempotencyKey,
      input: {
        output_revision_id: revision?.id ?? null,
        declared_implemented_at: declaredInstant(attempt.day, attempt.openedAt),
        ...(recommendationIds ? { recommendation_ids: recommendationIds } : {}),
      },
    });
  return (
    <>
      <Button
        disabled={disabled}
        onClick={() => {
          declare.reset();
          setAttempt(newAttempt());
          setOpen(true);
        }}
      >
        <CheckCircle2 className="size-3.5" aria-hidden />
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
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              pending={declare.isPending}
              pendingLabel="Declaring…"
              disabled={!valid}
              onClick={submit}
            >
              Declare implemented
            </Button>
          </div>
        }
      >
        <div className="grid gap-4">
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
        </div>
      </Dialog>
    </>
  );
}

/** `MarkImplementedButton` for a surface that holds only the Action's id. */
export function MarkActionImplemented({
  workspaceId,
  actionId,
  ...props
}: Readonly<Omit<Parameters<typeof MarkImplementedButton>[0], 'action'> & { actionId: string }>) {
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
    <div className="grid gap-2">
      <p className={textRole('label')}>What CiteLadder will check</p>
      <ul className="grid gap-2">
        {action.members.map((member) => {
          const leg = action.member_measurement[member.id] ?? null;
          return (
            <li key={member.id} className="grid gap-0.5">
              <span className={textRole('itemTitle')}>{member.title}</span>
              <span className={textRole('caption')}>
                {leg
                  ? `Measured by ${measurementLegLabel(leg)?.toLowerCase() ?? 'the next reading'}.`
                  : 'Not measured automatically: no reading isolates this change.'}
              </span>
            </li>
          );
        })}
      </ul>
      <p className={textRole('caption')}>
        Nothing runs on its own, and an Action can be declared once.
      </p>
    </div>
  );
}

/**
 * Whether an Action can be declared now: still open, with a current finding.
 * Without one there is nothing to declare, and the server refuses.
 */
export function isDeclarable(action: { status: string; member_count: number }): boolean {
  return (action.status === 'open' || action.status === 'in_progress') && action.member_count > 0;
}

function newAttempt() {
  const openedAt = new Date();
  return { idempotencyKey: newIdempotencyKey(), openedAt, day: localDay(openedAt) };
}

/**
 * The output pane's implementation state. Declaring anchors the Action to the
 * revision on screen; an outline is approved and drafted first, and an output
 * with no target has no Action to declare.
 */
export function OutputDeclaration({
  workspaceId,
  output,
  runActive,
}: Readonly<{ workspaceId: string; output: AgentOutput; runActive: boolean }>) {
  const revision = output.latest_revision;
  if (output.phase === 'outline' || !revision) return null;
  if (!output.action_id)
    return (
      <p className={textRole('caption')}>
        Name the page or topic this output is for to declare it implemented.
      </p>
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

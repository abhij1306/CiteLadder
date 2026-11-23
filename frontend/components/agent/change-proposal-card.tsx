import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';

import { Button } from '@/components/ui/button';
import { DraftSheet } from '@/components/ui/draft-sheet';
import { FactList, type Fact } from '@/components/ui/facts';
import { Notice } from '@/components/ui/notice';
import { ProjectLink } from '@/components/ui/project-link';
import { textRole } from '@/components/ui/typography';
import { agentMutations, type AgentMessage } from '@/lib/api/agent';
import { httpErrorStatus } from '@/lib/api/errors';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import { useWorkspaceCapability } from '@/lib/project/project-context';

type ChangeProposal = Extract<AgentMessage['proposals'][number], { kind: 'change' }>;

function facts(proposal: ChangeProposal): Fact[] {
  const rows = proposal.rows.map((row, index) => ({
    key: `row:${index}`,
    label: row.label,
    value: row.value,
  }));
  return proposal.spend
    ? [...rows, { key: 'spend', label: 'Spends', value: proposal.spend }]
    : rows;
}

function OpensLink({ opens }: Readonly<{ opens: ChangeProposal['opens'] }>) {
  if (!opens) return null;
  return (
    <Button asChild variant="secondary">
      <ProjectLink href={opens.path}>{opens.label}</ProjectLink>
    </Button>
  );
}

function Refusal({
  error,
  refusal,
}: Readonly<{ error: Error | null; refusal: ChangeProposal['refusal'] }>) {
  if (error)
    return (
      <Notice
        kind="mutation"
        notice={mutationNoticeForError(error, { action: 'make this change' })}
      />
    );
  if (!refusal) return null;
  return <p className={textRole('caption')}>The last confirm was refused: {refusal}</p>;
}

export function ChangeProposalCard({
  workspaceId,
  chatId,
  messageId,
  proposal,
}: Readonly<{
  workspaceId: string;
  chatId: string;
  messageId: string;
  proposal: ChangeProposal;
}>) {
  const mayWrite = useWorkspaceCapability('write');
  const decide = useMutation(agentMutations.decideProposal(workspaceId));
  const gone = decide.isError && httpErrorStatus(decide.error) === 404;
  const outcome = gone ? 'unavailable' : proposal.outcome;
  const shown = <FactList facts={facts(proposal)} layout="columns" />;
  const sheet = useRef<HTMLElement>(null);
  const hold = (node: HTMLElement | null) => {
    sheet.current = node;
  };
  const submit = (decision: 'confirm' | 'dismiss') =>
    decide.mutate(
      { chatId, messageId, index: proposal.index, decision },
      { onSuccess: () => sheet.current?.focus() },
    );
  const pending = (decision: 'confirm' | 'dismiss') =>
    decide.isPending && decide.variables?.decision === decision;
  switch (outcome) {
    case 'executed':
      return (
        <DraftSheet
          ref={hold}
          tabIndex={-1}
          title={proposal.title}
          state="accepted"
          marker="Done"
          actions={<OpensLink opens={proposal.opens} />}
        >
          {shown}
        </DraftSheet>
      );
    case 'dismissed':
      return <DraftSheet ref={hold} tabIndex={-1} title={proposal.title} state="declined" />;
    case 'unavailable':
      return (
        <DraftSheet
          ref={hold}
          tabIndex={-1}
          title={proposal.title}
          state="declined"
          marker="No longer available"
        />
      );
    case 'open':
      return (
        <DraftSheet
          ref={hold}
          tabIndex={-1}
          title={proposal.title}
          state="draft"
          marker="Proposed change"
          actions={
            mayWrite ? (
              <>
                <Button
                  variant="primary"
                  disabled={decide.isPending}
                  pending={pending('confirm')}
                  pendingLabel="Confirming…"
                  onClick={() => submit('confirm')}
                >
                  Confirm
                </Button>
                <Button
                  variant="secondary"
                  disabled={decide.isPending}
                  pending={pending('dismiss')}
                  pendingLabel="Dismissing…"
                  onClick={() => submit('dismiss')}
                >
                  Dismiss
                </Button>
              </>
            ) : null
          }
        >
          {shown}
          {mayWrite ? null : <p className={textRole('caption')}>Editors only.</p>}
          <Refusal error={decide.error} refusal={proposal.refusal} />
        </DraftSheet>
      );
    default: {
      const unknown: never = outcome;
      return unknown;
    }
  }
}

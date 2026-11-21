import { useQuery } from '@tanstack/react-query';

import {
  ContextualLinkDeclarationRoute,
  isDeclarable,
  MarkImplementedButton,
} from '@/components/agent/action-declaration';
import { ActionButton } from '@/components/ui/actions';
import { DraftSheet } from '@/components/ui/draft-sheet';
import { Stack } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';
import type { AgentChatDetail, AgentMessage } from '@/lib/api/agent';
import { actionsQueries, type ActionDetail } from '@/lib/api/actions';
import { useWorkspaceCapability } from '@/lib/project/project-context';
import { Notice, readErrorProps } from '@/components/ui/notice';

type Proposal = AgentMessage['proposals'][number];
type ChatAction = AgentChatDetail['actions'][number];

export function ProposalCards({
  workspaceId,
  proposals,
  actions,
}: Readonly<{
  workspaceId: string;
  proposals: readonly Proposal[];
  actions: readonly ChatAction[];
}>) {
  if (proposals.length === 0) return null;
  return (
    <Stack gap="compact">
      {proposals.map((proposal) => {
        switch (proposal.kind) {
          case 'declaration': {
            const action = actions.find(({ id }) => id === proposal.action_id);
            return action ? (
              <DeclarationProposal
                key={proposal.action_id}
                workspaceId={workspaceId}
                proposal={proposal}
                action={action}
              />
            ) : null;
          }
          default: {
            const _exhaustive: never = proposal.kind;
            return _exhaustive;
          }
        }
      })}
    </Stack>
  );
}

const PENDING: ReadonlySet<ChatAction['status']> = new Set(['open', 'in_progress']);
const DECLARED: ReadonlySet<ChatAction['status']> = new Set(['done']);

function DeclarationProposal({
  workspaceId,
  proposal,
  action,
}: Readonly<{ workspaceId: string; proposal: Proposal; action: ChatAction }>) {
  const mayWrite = useWorkspaceCapability('write');
  const detail = useQuery(actionsQueries.detail(workspaceId, action.id));
  const label = action.target_label;
  const open = <ActionButton action="openAction" href={`/actions/${action.id}`} />;
  const declared = detail.data ? detail.data.declaration !== null : DECLARED.has(action.status);
  if (declared)
    return <DraftSheet title={`${label} is marked implemented`} state="accepted" actions={open} />;
  const declarable =
    mayWrite && (detail.data ? isDeclarable(detail.data) : PENDING.has(action.status));
  return (
    <DraftSheet
      title={`Mark ${label} implemented?`}
      state="draft"
      actions={
        <>
          {open}
          {declarable && detail.data ? (
            <DeclareButton workspaceId={workspaceId} proposal={proposal} action={detail.data} />
          ) : null}
        </>
      }
    >
      {detail.isError ? (
        <Notice
          kind="read"
          {...readErrorProps(detail)}
          title="Couldn't load the proposed Action"
          fallback="The proposed Action could not be loaded."
        />
      ) : (
        <p className={textRole('caption')}>
          {declarable ? proposalDetail(proposal) : unavailable(mayWrite)}
        </p>
      )}
    </DraftSheet>
  );
}

function DeclareButton({
  workspaceId,
  proposal,
  action,
}: Readonly<{ workspaceId: string; proposal: Proposal; action: ActionDetail }>) {
  if (action.members.some(({ rule_id }) => rule_id === 'site_contextual_links'))
    return <ContextualLinkDeclarationRoute />;
  return (
    <MarkImplementedButton
      workspaceId={workspaceId}
      action={action}
      revision={proposal.revision}
      proposed={{ day: proposal.go_live_day, reference: proposal.deployment_reference }}
    />
  );
}

function proposalDetail(proposal: Proposal) {
  const what = proposal.revision
    ? `Revision ${proposal.revision.number} of the document`
    : 'Work done outside CiteLadder';
  const live = proposal.go_live_day ? `, live since ${proposal.go_live_day}` : '';
  return `${what}${live}`;
}

function unavailable(mayWrite: boolean) {
  return mayWrite ? 'This Action can no longer be declared.' : 'Editors only.';
}

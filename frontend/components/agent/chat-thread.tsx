import type { ReactNode } from 'react';

import { AgentFailureNotice } from '@/components/agent/agent-failure-notice';
import { Composer } from '@/components/agent/composer';
import { Conversation } from '@/components/agent/conversation';
import { useSkillChoice } from '@/components/agent/skill-picker';
import { useCancelRun, useFollowUp, type FollowUp } from '@/components/agent/use-chat-turns';
import { AgentThread } from '@/components/ui/chat-dock';
import { latestOutput } from '@/lib/agent/documents';
import { agentHandoffHref } from '@/lib/agent/handoff';
import { isPageReading, isRunActive } from '@/lib/agent/run-state';
import { useAgentAccess } from '@/lib/agent/use-agent-access';
import type { AgentChatDetail, AgentOutput } from '@/lib/api/agent';
import { Notice } from '@/components/ui/notice';

export function useChatThread(workspaceId: string, detail: AgentChatDetail) {
  const chatId = detail.chat.id;
  const access = useAgentAccess();
  const runActive = isRunActive(detail.latest_run) || isPageReading(detail.page_fetch);
  const turn = useFollowUp(workspaceId, detail);
  const cancel = useCancelRun(workspaceId);
  // Capture the run: a closure does not keep the narrowing of `detail.latest_run`.
  const activeRun = isRunActive(detail.latest_run) ? detail.latest_run : null;
  const stop = activeRun ? () => cancel.mutate({ chatId, runId: activeRun.id }) : undefined;
  return { workspaceId, access, runActive, turn, stop, stopping: cancel.isPending };
}
export type ChatThread = ReturnType<typeof useChatThread>;

export function ChatConversation({
  thread,
  detail,
  renderOutput,
}: Readonly<{
  thread: ChatThread;
  detail: AgentChatDetail;
  renderOutput?: (output: AgentOutput) => ReactNode;
}>) {
  const { turn, access, runActive } = thread;
  return (
    <>
      <Conversation
        workspaceId={thread.workspaceId}
        detail={detail}
        renderOutput={renderOutput}
        onRefine={turn.suggest}
        onRecover={turn.recover}
        onRetry={turn.resend}
        hasDraft={Boolean(
          turn.draft.trim() || turn.commands.mentions.length || turn.commands.pastes.items.length,
        )}
        pendingMessage={turn.pendingMessage}
        canSend={access.canSend && !turn.pending && !runActive}
      />
      {!access.canSend || turn.failure ? (
        <AgentThread>
          {access.canSend ? null : <Notice tone="info">{access.message}</Notice>}
          <FollowUpFailure turn={turn} actionId={detail.chat.action_id} />
        </AgentThread>
      ) : null}
    </>
  );
}

export function ReplyComposer({
  id,
  thread,
  detail,
  placeholder,
}: Readonly<{ id: string; thread: ChatThread; detail: AgentChatDetail; placeholder: string }>) {
  const { turn, access, runActive } = thread;
  const skill = useSkillChoice({
    value: turn.skillId,
    onChange: turn.setSkillId,
    hasDocument: detail.outputs.length > 0,
    inheritedSkillId:
      detail.pinned_skill_id ?? (detail.chat.action_id ? null : latestOutput(detail)?.skill_id),
    hasAction: Boolean(detail.chat.action_id),
  });
  return (
    <Composer
      id={id}
      label="Reply to the agent"
      value={turn.draft}
      onChange={turn.setDraft}
      onSubmit={() => turn.send(turn.draft)}
      pending={turn.pending}
      disabled={!access.canSend}
      submissionDisabled={runActive}
      onStop={thread.stop}
      stopping={thread.stopping}
      onRetry={
        turn.failure &&
        turn.failure.recovery !== 'new-chat' &&
        turn.draft.trim() === turn.failedMessage
          ? turn.retrySubmission
          : undefined
      }
      placeholder={placeholder}
      commands={turn.commands}
      skill={skill}
    />
  );
}

function FollowUpFailure({
  turn,
  actionId,
}: Readonly<{ turn: FollowUp; actionId: string | null }>) {
  if (!turn.failure) return null;
  return (
    <AgentFailureNotice
      failure={turn.failure}
      newChatHref={agentHandoffHref({ actionId, prompt: turn.lastMessage })}
    />
  );
}

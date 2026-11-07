'use client';

import type { ReactNode } from 'react';

import { Composer } from '@/components/agent/composer';
import { Conversation } from '@/components/agent/conversation';
import { SkillPicker } from '@/components/agent/skill-picker';
import { useCancelRun, useFollowUp, type FollowUp } from '@/components/agent/use-chat-turns';
import { ProjectLink } from '@/components/ui/project-link';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { latestOutput } from '@/lib/agent/documents';
import { agentHandoffHref } from '@/lib/agent/handoff';
import { isRunActive } from '@/lib/agent/run-state';
import { useAgentAccess } from '@/lib/agent/use-agent-access';
import type { AgentChatDetail, AgentOutput } from '@/lib/api/agent';

/**
 * One chat's conversation and reply composer, shared by the full Agent screen
 * and the Dashboard panel so both behave the same: the message appears at
 * once, the reply streams, Stop replaces Send while a turn runs, and the last
 * turn can be retried, regenerated or edited.
 */
export function useChatThread(workspaceId: string, detail: AgentChatDetail) {
  const chatId = detail.chat.id;
  const access = useAgentAccess();
  const runActive = isRunActive(detail.latest_run);
  const turn = useFollowUp(workspaceId, detail);
  const cancel = useCancelRun(workspaceId);
  // Capture the run: a closure does not keep the narrowing of `detail.latest_run`.
  const activeRun = runActive ? detail.latest_run : null;
  const stop = activeRun ? () => cancel.mutate({ chatId, runId: activeRun.id }) : undefined;
  return { access, runActive, turn, stop, stopping: cancel.isPending };
}
type ChatThread = ReturnType<typeof useChatThread>;

export function ChatConversation({
  thread,
  detail,
  renderOutput,
}: Readonly<{
  thread: ChatThread;
  detail: AgentChatDetail;
  renderOutput: (output: AgentOutput) => ReactNode;
}>) {
  const { turn, access, runActive } = thread;
  return (
    <>
      <Conversation
        detail={detail}
        renderOutput={renderOutput}
        onRefine={turn.suggest}
        onRecover={turn.recover}
        onRetry={turn.resend}
        hasDraft={Boolean(turn.draft.trim() || turn.commands.mentions.length)}
        pendingMessage={turn.pendingMessage}
        canSend={access.canSend && !turn.pending && !runActive}
      />
      {access.canSend ? null : <Callout tone="info">{access.message}</Callout>}
      <FollowUpFailure turn={turn} actionId={detail.chat.action_id} canSend={access.canSend} />
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
      placeholder={placeholder}
      commands={turn.commands}
      tools={
        <SkillPicker
          {...turn.commands.skillPicker}
          value={turn.skillId}
          onChange={turn.setSkillId}
          hasDocument={detail.outputs.length > 0}
          inheritedSkillId={
            detail.pinned_skill_id ??
            (!detail.chat.action_id ? latestOutput(detail)?.skill_id : null)
          }
          hasAction={Boolean(detail.chat.action_id)}
          disabled={!access.canSend || runActive}
        />
      }
    />
  );
}

/**
 * Back to the newest message: a `ComposerDock`'s `floating` control, shown
 * only while the reader has scrolled away from the end of the thread.
 */
export function JumpToLatest({ onJump }: Readonly<{ onJump: () => void }>) {
  return (
    <Button variant="secondary" onClick={onJump}>
      Jump to latest
    </Button>
  );
}

function FollowUpFailure({
  turn,
  actionId,
  canSend,
}: Readonly<{ turn: FollowUp; actionId: string | null; canSend: boolean }>) {
  if (!turn.failure) return null;
  return (
    <MutationNotice
      notice={turn.failure}
      recovery={
        turn.failure.startNewChat ? (
          <ProjectLink
            href={agentHandoffHref({ actionId, prompt: turn.lastMessage })}
            className="underline"
          >
            Start a new chat
          </ProjectLink>
        ) : (
          <Button
            variant="secondary"
            onClick={turn.retrySubmission}
            disabled={turn.pending || !canSend}
          >
            Retry send
          </Button>
        )
      }
    />
  );
}

'use client';

import type { ReactNode } from 'react';

import { Composer } from '@/components/agent/composer';
import { Conversation } from '@/components/agent/conversation';
import { SkillPicker } from '@/components/agent/skill-picker';
import { useCancelRun, useFollowUp, type FollowUp } from '@/components/agent/use-chat-turns';
import { ProjectLink } from '@/components/layout/scoped-link';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { agentHandoffHref } from '@/lib/agent/handoff';
import { isRunActive } from '@/lib/agent/run-state';
import { useAgentAccess } from '@/lib/agent/use-agent-access';
import type { AgentChatDetail } from '@/lib/api/agent';

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
  const cancel = useCancelRun(workspaceId, chatId);
  // Capture the run: a closure does not keep the narrowing of `detail.latest_run`.
  const activeRun = runActive ? detail.latest_run : null;
  const stop = activeRun ? () => cancel.mutate({ chatId, runId: activeRun.id }) : undefined;
  return { access, runActive, turn, stop, stopping: cancel.isPending };
}
type ChatThread = ReturnType<typeof useChatThread>;

export function ChatConversation({
  thread,
  detail,
  output,
}: Readonly<{ thread: ChatThread; detail: AgentChatDetail; output: ReactNode }>) {
  const { turn, access, runActive } = thread;
  return (
    <>
      <Conversation
        detail={detail}
        output={output}
        onRefine={turn.suggest}
        onRecover={turn.recover}
        onRetry={turn.resend}
        hasDraft={Boolean(turn.draft.trim() || turn.commands.mentions.length)}
        pendingMessage={turn.pendingMessage}
        canSend={access.canSend && !turn.pending && !runActive}
      />
      {access.canSend ? null : <Alert tone="info">{access.message}</Alert>}
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
      rows={2}
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
          outputKind={detail.output?.kind}
          inheritedSkillId={
            detail.pinned_skill_id ?? (!detail.chat.action_id ? detail.output?.skill_id : null)
          }
          hasAction={Boolean(detail.chat.action_id)}
          disabled={!access.canSend || runActive}
        />
      }
    />
  );
}

/**
 * Floats above the sticky composer, out of flow, so showing it never moves the
 * input or changes the page height while a reply streams.
 */
export function JumpToLatest({ show, onJump }: Readonly<{ show: boolean; onJump: () => void }>) {
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-full flex justify-center pb-2">
      <Button variant="secondary" className="pointer-events-auto" onClick={onJump}>
        Jump to latest
      </Button>
    </div>
  );
}

function FollowUpFailure({
  turn,
  actionId,
  canSend,
}: Readonly<{ turn: FollowUp; actionId: string | null; canSend: boolean }>) {
  if (!turn.failure) return null;
  return (
    <Alert tone="danger">
      {turn.failure.message}{' '}
      {turn.failure.startNewChat ? (
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
      )}
    </Alert>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { AgentFailureNotice } from '@/components/agent/agent-failure-notice';
import { ChatConversation, ReplyComposer, useChatThread } from '@/components/agent/chat-thread';
import { Composer } from '@/components/agent/composer';
import { useModelPicker } from '@/components/agent/model-picker';
import { useSkillChoice } from '@/components/agent/skill-picker';
import { useComposerCommands } from '@/components/agent/use-composer-commands';
import { useFollowLatest } from '@/components/agent/use-follow-latest';
import { useChatDetail, useCreateChat } from '@/components/agent/use-chat-turns';
import { isAgentPath } from '@/lib/navigation/app-routes';
import { ProjectLink } from '@/components/ui/project-link';
import { Button } from '@/components/ui/button';
import { DockedThread } from '@/components/ui/chat-dock';
import { Drawer } from '@/components/ui/drawer';
import { Icon } from '@/components/ui/icon';
import { ICONS } from '@/lib/icons';
import { Inline } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';
import { contextChips, withoutContext, type AgentHandoff } from '@/lib/agent/handoff';
import { useAgentPanel } from '@/lib/agent/panel-context';
import { useAgentAccess } from '@/lib/agent/use-agent-access';
import type { AgentChatDetail } from '@/lib/api/agent';
import { useProjectHref } from '@/lib/navigation/project-destination';
import { useProjectContext } from '@/lib/project/project-context';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { DraftSheet } from '@/components/ui/draft-sheet';
import { revisionDraft } from '@/components/agent/revision-draft';
import { StateBlock } from '@/components/ui/state-block';

const EMPTY_SEED: AgentHandoff = { context: {} };

export function AgentPanel() {
  const panel = useAgentPanel();
  const pathname = useLocation().pathname ?? '';
  const { activeProjectId, activeWorkspaceId } = useProjectContext();
  const onDashboard = !isAgentPath(pathname);
  const setOpen = panel?.setOpen;
  useEffect(() => {
    if (!onDashboard) setOpen?.(false);
  }, [onDashboard, setOpen]);
  if (!panel || !activeProjectId || !activeWorkspaceId) return null;
  const open = panel.open && onDashboard;
  const chatId = panel.chat?.projectId === activeProjectId ? panel.chat.chatId : null;
  const close = () => panel.setOpen(false);
  return (
    <Drawer
      open={open}
      onOpenChange={panel.setOpen}
      title="Agent"
      closeLabel="Close agent"
      body="dock"
    >
      {chatId ? (
        <PanelChat
          key={`${activeWorkspaceId}:${chatId}`}
          workspaceId={activeWorkspaceId}
          chatId={chatId}
          projectId={activeProjectId}
          onLeave={close}
          toolbar={
            <Inline className="flex-wrap justify-end">
              <Button variant="quiet" onClick={() => panel.setChat(null)}>
                <Icon icon={ICONS.newChat} />
                New chat
              </Button>
              <Button asChild variant="secondary">
                <ProjectLink href={`/agent/chats/${chatId}`} onClick={close}>
                  Open in Agent
                </ProjectLink>
              </Button>
            </Inline>
          }
        />
      ) : (
        <PanelStart
          key={`${activeProjectId}:${panel.openCount}`}
          workspaceId={activeWorkspaceId}
          projectId={activeProjectId}
          seed={panel.seed ?? EMPTY_SEED}
          onStarted={(id) => panel.setChat({ projectId: activeProjectId, chatId: id })}
        />
      )}
    </Drawer>
  );
}

function PanelStart({
  workspaceId,
  projectId,
  seed,
  onStarted,
}: Readonly<{
  workspaceId: string;
  projectId: string;
  seed: AgentHandoff;
  onStarted: (chatId: string) => void;
}>) {
  const [message, setMessage] = useState(seed.prompt ?? '');
  const [context, setContext] = useState(seed.context);
  const [skillId, setSkillId] = useState<string | null | undefined>(seed.skillId ?? undefined);
  const commands = useComposerCommands({ workspaceId, projectId });
  const access = useAgentAccess();
  const create = useCreateChat(workspaceId, projectId, onStarted);
  const model = useModelPicker();
  const skill = useSkillChoice({
    value: skillId,
    onChange: setSkillId,
    hasAction: Boolean(seed.actionId),
  });
  return (
    <DockedThread
      dock={
        <Composer
          id="agent-panel-message"
          label="Message the agent"
          value={message}
          onChange={setMessage}
          onSubmit={() =>
            commands.prepare({ message, edit: setMessage }, (prepared) =>
              create.start({
                ...prepared,
                choice: model.request,
                skillId,
                actionId: seed.actionId,
                context,
              }),
            )
          }
          pending={create.pending || commands.resolving}
          disabled={!access.canSend}
          placeholder="Ask a question"
          chips={contextChips(context)}
          commands={commands}
          onRemoveChip={(chip) => setContext((current) => withoutContext(current, chip.key))}
          skill={skill}
          model={model.picker}
        />
      }
    >
      <p className={textRole('heading')}>Ask about this screen</p>
      {access.canSend ? null : <Notice tone="info">{access.message}</Notice>}
      {create.failure ? <AgentFailureNotice failure={create.failure} /> : null}
    </DockedThread>
  );
}

function PanelChat({
  workspaceId,
  chatId,
  projectId,
  onLeave,
  toolbar,
}: Readonly<{
  workspaceId: string;
  chatId: string;
  projectId: string;
  onLeave: () => void;
  toolbar: ReactNode;
}>) {
  const query = useChatDetail(workspaceId, chatId);
  if (query.isError && !query.data)
    return (
      <DockedThread>
        <Notice
          kind="read"
          {...readErrorProps(query)}
          title="Couldn't load this chat"
          fallback="This chat could not be loaded."
        />
      </DockedThread>
    );
  if (!query.data)
    return (
      <DockedThread>
        <StateBlock kind="loading" label="Loading chat…" shape={{ kind: 'thread' }} />
      </DockedThread>
    );
  if (query.data.chat.project_id !== projectId)
    return (
      <DockedThread>
        <Notice tone="negative">This chat belongs to another project.</Notice>
      </DockedThread>
    );
  return (
    <PanelConversation
      workspaceId={workspaceId}
      detail={query.data}
      onLeave={onLeave}
      toolbar={toolbar}
    />
  );
}

function PanelConversation({
  workspaceId,
  detail,
  onLeave,
  toolbar,
}: Readonly<{
  workspaceId: string;
  detail: AgentChatDetail;
  onLeave: () => void;
  toolbar: ReactNode;
}>) {
  const chatId = detail.chat.id;
  const navigate = useNavigate();
  const projectHref = useProjectHref();
  const thread = useChatThread(workspaceId, detail);
  const openOutput = () => {
    onLeave();
    navigate(projectHref(`/agent/chats/${chatId}`));
  };
  const { scrollRef, showJump, jumpToLatest } = useFollowLatest();
  return (
    <DockedThread
      label="Agent conversation"
      scrollRef={scrollRef}
      onJumpToLatest={showJump ? jumpToLatest : null}
      dock={
        <ReplyComposer
          id="agent-panel-reply"
          thread={thread}
          detail={detail}
          placeholder="Ask a follow-up"
        />
      }
    >
      {toolbar}
      <ChatConversation
        thread={thread}
        detail={detail}
        renderOutput={(output) => (
          <DraftSheet
            as="div"
            {...revisionDraft(output.latest_revision)}
            title={output.latest_revision.title}
            actions={
              <Button variant="secondary" onClick={openOutput}>
                Open output
              </Button>
            }
          >
            <span className={textRole('caption')}>Document {output.number}</span>
          </DraftSheet>
        )}
      />
    </DockedThread>
  );
}

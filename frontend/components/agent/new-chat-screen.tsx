import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AgentFailureNotice } from '@/components/agent/agent-failure-notice';
import { BriefingCard } from '@/components/agent/briefing-card';
import { Composer } from '@/components/agent/composer';
import { useSkillChoice } from '@/components/agent/skill-picker';
import { useModelPicker } from '@/components/agent/model-picker';
import { useAgentCatalog } from '@/components/agent/use-agent-catalog';
import { useCreateChat } from '@/components/agent/use-chat-turns';
import { useComposerCommands } from '@/components/agent/use-composer-commands';
import { useHandoffScope } from '@/components/agent/handoff-scope';
import { ThreadPage } from '@/components/templates/thread-page';
import { Stack } from '@/components/ui/layout';
import { textRole } from '@/components/ui/typography';
import { useAgentAccess } from '@/lib/agent/use-agent-access';
import { actionTitle } from '@/lib/agent/action-title';
import { contextChips, parseAgentHandoff, withoutContext } from '@/lib/agent/handoff';
import { approachLabel, targetKindLabel } from '@/lib/agent/vocabulary';
import { actionsQueries, type Action } from '@/lib/api/actions';
import { useProjectHref } from '@/lib/navigation/project-destination';
import { useUrlSearch } from '@/lib/navigation/url-params';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { Notice, readErrorProps } from '@/components/ui/notice';

export function NewChatScreen() {
  const { workspaceId, projectId } = useProjectScope();
  const searchParams = useUrlSearch();
  const handoffKey = searchParams.toString();
  return (
    <NewChat
      key={`${projectId}:${handoffKey}`}
      workspaceId={workspaceId}
      projectId={projectId}
      searchParams={searchParams}
    />
  );
}

function NewChat({
  workspaceId,
  projectId,
  searchParams,
}: Readonly<{
  workspaceId: string;
  projectId: string;
  searchParams: URLSearchParams;
}>) {
  const handoff = useMemo(() => parseAgentHandoff(searchParams), [searchParams]);
  const [typed, setTyped] = useState(handoff.prompt);
  const [context, setContext] = useState(handoff.context);
  const [skillId, setSkillId] = useState<string | null | undefined>(handoff.skillId ?? undefined);
  const [pinnedId, setPinnedId] = useState(handoff.workflowId);
  const catalog = useAgentCatalog();
  const pinned = catalog.workflow(pinnedId);
  const access = useAgentAccess();
  const navigate = useNavigate();
  const projectHref = useProjectHref();
  const create = useCreateChat(workspaceId, projectId, (chatId) =>
    navigate(projectHref(`/agent/chats/${chatId}`)),
  );
  const failure = create.failure;
  const commands = useComposerCommands({ workspaceId, projectId });
  const model = useModelPicker();
  const { actionId, action, message, attachment, unavailable } = useAttachedAction(
    workspaceId,
    handoff.actionId,
    typed,
    setTyped,
  );
  const handoffScope = useHandoffScope({
    scope: { workspaceId, projectId },
    context,
    action,
    attached: Boolean(actionId),
  });
  const sent = handoffScope.context;
  const skill = useSkillChoice({
    value: pinnedId ? undefined : skillId,
    onChange: (next) => {
      if (next !== undefined) setPinnedId(undefined);
      setSkillId(next);
    },
    hasAction: Boolean(actionId),
    pinned: pinnedId
      ? { label: pinned?.label ?? '…', onRemove: () => setPinnedId(undefined) }
      : undefined,
  });
  const start = () =>
    commands.prepare(
      { message, edit: (change) => setTyped((current) => change(current ?? message)) },
      (prepared) =>
        create.start({
          ...prepared,
          choice: model.request,
          skillId: pinnedId ? undefined : skillId,
          workflowId: pinnedId,
          actionId,
          context: sent,
        }),
    );
  const pending = create.pending || commands.resolving;

  return (
    <ThreadPage>
      <Stack gap="section" className="max-w-thread mx-auto my-auto w-full">
        <h2 className={textRole('title', 'text-center')}>What can I help with?</h2>
        {unavailable ? (
          <Notice tone="negative">
            This Action is unavailable. The chat will start without it.
          </Notice>
        ) : null}
        {access.canSend ? null : <Notice tone="info">{access.message}</Notice>}
        {failure ? <AgentFailureNotice failure={failure} /> : null}
        {catalog.read.status === 'error' ? (
          <Notice
            kind="read"
            {...readErrorProps(catalog.read)}
            title="Couldn't load skills"
            fallback="The request failed or timed out."
          />
        ) : null}
        <Stack gap="tight">
          <Composer
            id="new-chat-message"
            label="Message the agent"
            value={message}
            onChange={setTyped}
            onSubmit={start}
            pending={pending}
            disabled={!access.canSend}
            placeholder="Ask a question or describe the work"
            attachment={attachment}
            skill={skill}
            model={model.picker}
            scope={handoffScope.facts}
            chips={contextChips(sent, handoffScope.labels)}
            commands={commands}
            onRemoveChip={(chip) => setContext((current) => withoutContext(current, chip.key))}
          />
          {actionId ? null : (
            <p className={textRole('caption')}>Type / to pick a skill or @ to mention an Action.</p>
          )}
        </Stack>
        {actionId ? null : (
          <BriefingCard
            workspaceId={workspaceId}
            projectId={projectId}
            onStart={(input) => create.start({ ...input, choice: model.request })}
            pending={pending}
            disabled={!access.canSend}
          />
        )}
      </Stack>
    </ThreadPage>
  );
}

function useAttachedAction(
  workspaceId: string,
  handoffActionId: string | undefined,
  typed: string | undefined,
  setMessage: (message: string) => void,
) {
  const [attachedId, setAttachedId] = useState(handoffActionId);
  const attached = useQuery({
    ...actionsQueries.detail(workspaceId, handoffActionId ?? ''),
    enabled: Boolean(handoffActionId),
  });
  const actionId = attached.isError ? undefined : attachedId;
  const message = typed ?? (attachedId ? attached.data?.handoff.message : undefined) ?? '';
  const attachment =
    actionId && attached.data
      ? {
          label: attachmentLabel(attached.data),
          onRemove: () => {
            setMessage(message);
            setAttachedId(undefined);
          },
        }
      : undefined;
  return {
    actionId,
    action: actionId ? attached.data : undefined,
    message,
    attachment,
    unavailable: attached.isError,
  };
}

function attachmentLabel(action: Action): string {
  const title = `Action: ${actionTitle(action)}`;
  const kind = approachLabel(action.approach) ? null : targetKindLabel(action.target_kind);
  return kind ? `${title} · ${kind}` : title;
}

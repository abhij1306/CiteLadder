import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useMemo, useState, type ComponentProps } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { ActionPriorityBadge } from '@/components/agent/action-status-badge';
import { BriefingCard } from '@/components/agent/briefing-card';
import { Composer } from '@/components/agent/composer';
import { SkillPicker } from '@/components/agent/skill-picker';
import { useAgentCatalog } from '@/components/agent/use-agent-catalog';
import { useCreateChat } from '@/components/agent/use-chat-turns';
import { useComposerCommands } from '@/components/agent/use-composer-commands';
import { WorkflowGallery, WorkflowStart } from '@/components/agent/workflow-gallery';
import { ListScreen } from '@/components/layout/page-shell';
import { ProjectLink } from '@/components/ui/project-link';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Disclosure } from '@/components/ui/disclosure';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { MutationNotice } from '@/components/ui/mutation-notice';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { cardClasses } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import {
  EditorialSectionHeader,
  ledgerClasses,
  ledgerItemClasses,
} from '@/components/ui/workspace';
import { useAgentAccess } from '@/lib/agent/use-agent-access';
import {
  actionHandoffHref,
  contextChips,
  parseAgentHandoff,
  withoutContext,
} from '@/lib/agent/handoff';
import { approachLabel, targetKindLabel } from '@/lib/agent/vocabulary';
import { actionsQueries, type Action } from '@/lib/api/actions';
import type { AgentWorkflow } from '@/lib/api/agent';
import { AGENT_TOP_ACTIONS } from '@/lib/config/agent';
import { readableUrl, shortUrlTitle } from '@/lib/format';
import { useProjectHref } from '@/lib/navigation/project-destination';
import { useProjectScope } from '@/lib/project/active-project-scope';

/**
 * New chat: ask a question, start a defined workflow, or pick up an Action.
 * An evidence-screen handoff arrives as typed references in the URL and is
 * shown as removable context before the first message is sent. A chat opened
 * on an Action is about that Action alone: it is one removable line in the
 * composer above its written message, and the other starting points
 * (recommended Actions, workflows, the briefing) wait until it is removed.
 */
export function NewChatScreen() {
  const { workspaceId, projectId } = useProjectScope();
  const [searchParams] = useSearchParams();
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
  // Undefined until typed: the composer shows the URL's prompt or, for an
  // Action handoff, the Action's own message once it loads. The message is
  // read, never carried in the URL, so history and logs keep only ids.
  const [typed, setTyped] = useState(handoff.prompt);
  const [context, setContext] = useState(handoff.context);
  const [skillId, setSkillId] = useState<string | null | undefined>(handoff.skillId ?? undefined);
  // A next step arrives with its workflow pinned; a gallery pick opens its form.
  const [pinnedId, setPinnedId] = useState(handoff.workflowId);
  const [picked, setPicked] = useState<AgentWorkflow | null>(null);
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
  const { actionId, message, attachment, unavailable } = useAttachedAction(
    workspaceId,
    handoff.actionId,
    typed,
    setTyped,
  );
  // A workflow is sent by id; the server validates it and pins its skill.
  const start = (text: string, workflowId: string | undefined) =>
    create.start({
      message: text,
      skillId: workflowId ? undefined : skillId,
      workflowId,
      actionId,
      context,
      mentions: commands.mentions.map((mention) => mention.id),
    });

  return (
    <ListScreen
      // Fill the viewport below the shell chrome: only the content scrolls and
      // the window never moves. Kept identical in chat- and new-chat-screen.
      fill
      narrow
    >
      <Stack gap="section" className="my-auto">
        <h2 className={textRole('sectionTitle', 'text-center')}>What can I help with?</h2>
        {unavailable ? (
          <Callout tone="negative">
            This Action is unavailable. The chat will start without it.
          </Callout>
        ) : null}
        {access.canSend ? null : <Callout tone="info">{access.message}</Callout>}
        {failure ? <MutationNotice notice={failure} /> : null}
        {/* Without the catalog there are no workflows or skills to offer, and
            saying nothing read as a plan that has none. */}
        {catalog.read.status === 'error' ? (
          <ReadError
            {...readErrorProps(catalog.read)}
            title="Couldn't load skills and workflows"
            fallback="The request failed or timed out."
          />
        ) : null}
        <Stack gap="tight">
          <Composer
            id="new-chat-message"
            label="Message the agent"
            value={message}
            onChange={setTyped}
            onSubmit={() => start(message, pinnedId)}
            pending={create.pending}
            disabled={!access.canSend}
            placeholder="Ask a question or describe the work"
            attachment={attachment}
            chips={contextChips(context)}
            commands={commands}
            onRemoveChip={(chip) => setContext((current) => withoutContext(current, chip.key))}
            tools={
              pinnedId ? (
                <PinnedWorkflow label={pinned?.label} onRemove={() => setPinnedId(undefined)} />
              ) : (
                <SkillPicker
                  {...commands.skillPicker}
                  value={skillId}
                  onChange={setSkillId}
                  hasAction={Boolean(actionId)}
                  disabled={!access.canSend}
                />
              )
            }
          />
          {/* Instructions live in a caption, not the placeholder, so they stay
              readable once the user starts typing. A chat about one Action
              starts from its message instead. */}
          {actionId ? null : (
            <p className={textRole('caption')}>Type / to pick a skill or @ to mention an Action.</p>
          )}
        </Stack>
        {/* With an Action attached the screen is about that one Action: the
            other starting points return once it is removed. */}
        {actionId ? null : (
          <StartingPoints
            workspaceId={workspaceId}
            projectId={projectId}
            picked={picked}
            onPick={setPicked}
            onStart={start}
            onBriefing={create.start}
            pending={create.pending}
            disabled={!access.canSend}
          />
        )}
      </Stack>
    </ListScreen>
  );
}

/**
 * The Action the chat is about, until the reader removes it, and the message
 * the composer shows: what was typed, else the Action's own message. An Action
 * that failed to load is dropped, as its notice promises, rather than failing
 * the whole chat.
 */
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
          // The message stays as written; only the Action leaves.
          onRemove: () => {
            setMessage(message);
            setAttachedId(undefined);
          },
        }
      : undefined;
  return { actionId, message, attachment, unavailable: attached.isError };
}

/** Where a chat with no Action starts: recommended Actions, workflows, a briefing. */
function StartingPoints({
  workspaceId,
  projectId,
  picked,
  onPick,
  onStart,
  onBriefing,
  pending,
  disabled,
}: Readonly<{
  workspaceId: string;
  projectId: string;
  picked: AgentWorkflow | null;
  onPick: (workflow: AgentWorkflow | null) => void;
  onStart: (text: string, workflowId: string) => void;
  onBriefing: ComponentProps<typeof BriefingCard>['onStart'];
  pending: boolean;
  disabled: boolean;
}>) {
  return (
    <>
      <TopActions workspaceId={workspaceId} projectId={projectId} />
      <Workflows
        picked={picked}
        onPick={onPick}
        onStart={onStart}
        pending={pending}
        disabled={disabled}
      />
      <Disclosure title="Get a briefing on what to work on">
        <BriefingCard
          workspaceId={workspaceId}
          projectId={projectId}
          onStart={onBriefing}
          pending={pending}
          disabled={disabled}
        />
      </Disclosure>
    </>
  );
}

/** The workflow gallery, or the picked workflow's form in its place. */
function Workflows({
  picked,
  onPick,
  onStart,
  pending,
  disabled,
}: Readonly<{
  picked: AgentWorkflow | null;
  onPick: (workflow: AgentWorkflow | null) => void;
  onStart: (text: string, workflowId: string) => void;
  pending: boolean;
  disabled: boolean;
}>) {
  if (!picked) return <WorkflowGallery onPick={onPick} disabled={disabled || pending} />;
  return (
    <WorkflowStart
      workflow={picked}
      onStart={(text) => onStart(text, picked.id)}
      onBack={() => onPick(null)}
      pending={pending}
      disabled={disabled}
    />
  );
}

/** The workflow a next step pinned; removing it returns to the skill picker. */
function PinnedWorkflow({
  label,
  onRemove,
}: Readonly<{ label: string | undefined; onRemove: () => void }>) {
  return (
    <Button
      variant="secondary"
      aria-label={`Remove workflow ${label ?? ''}`.trim()}
      onClick={onRemove}
    >
      {label ?? 'Workflow'}
      <Icon icon={X} />
    </Button>
  );
}

/**
 * The attached Action as one line in the composer: "Action:", its short
 * title, then its type (the approach, else the kind of target).
 */
function attachmentLabel(action: Action): string {
  const type = approachLabel(action.approach) ?? targetKindLabel(action.target_kind);
  const title = `Action: ${shortUrlTitle(action.target_label)}`;
  return type ? `${title} · ${type}` : title;
}

/**
 * The project's top open Actions, open above the workflows as the first
 * starting points (owner, 2026-11-10). While they load, placeholder rows hold
 * the list's height so the workflows below never jump.
 */
function TopActions({
  workspaceId,
  projectId,
}: Readonly<{ workspaceId: string; projectId: string }>) {
  const query = useQuery(actionsQueries.list({ workspaceId, projectId }));
  const top = query.data?.items.slice(0, AGENT_TOP_ACTIONS) ?? [];
  // An error, or a project with no open Actions, leaves nothing to start from.
  if (query.isError || (query.isSuccess && top.length === 0)) return null;
  return (
    <Stack as="section" aria-labelledby="top-actions">
      <EditorialSectionHeader
        title="Recommended Actions"
        headingId="top-actions"
        actions={
          <Button asChild variant="ghost">
            <ProjectLink href="/agent/actions">All Actions</ProjectLink>
          </Button>
        }
      />
      <div className={cardClasses()}>
        {query.isPending ? (
          <Skeleton variant="row" rows={AGENT_TOP_ACTIONS} label="Loading Actions" />
        ) : (
          <ul className={ledgerClasses()}>
            {top.map((action) => (
              <TopActionRow key={action.id} action={action} />
            ))}
          </ul>
        )}
      </div>
    </Stack>
  );
}

/**
 * One recommended Action. Its title starts a chat on it with the Action's
 * message already written; the approach and priority band say what the work is.
 */
function TopActionRow({ action }: Readonly<{ action: Action }>) {
  const target = readableUrl(action.target_label);
  return (
    <Inline as="li" gap="compact" className={ledgerItemClasses()}>
      <Stack gap="tight" className="min-w-0 flex-1">
        <TextLink
          href={actionHandoffHref(action)}
          text="itemTitle"
          className="truncate"
          aria-label={`Work on ${target}`}
        >
          {target}
        </TextLink>
        <span className={textRole('caption')}>
          {[targetKindLabel(action.target_kind), approachLabel(action.approach)]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </Stack>
      <ActionPriorityBadge band={action.priority_band} />
    </Inline>
  );
}

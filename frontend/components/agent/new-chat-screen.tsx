'use client';

import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { ActionStatusBadge } from '@/components/agent/action-status-badge';
import { BriefingCard } from '@/components/agent/briefing-card';
import { Composer } from '@/components/agent/composer';
import { SkillPicker } from '@/components/agent/skill-picker';
import { useAgentCatalog } from '@/components/agent/use-agent-catalog';
import { useCreateChat } from '@/components/agent/use-chat-turns';
import { useComposerCommands } from '@/components/agent/use-composer-commands';
import { WorkflowGallery, WorkflowStart } from '@/components/agent/workflow-gallery';
import { PageShell } from '@/components/layout/page-shell';
import { ProjectRequiredState } from '@/components/layout/project-required-state';
import { ProjectLink } from '@/components/layout/scoped-link';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { Stack } from '@/components/ui/layout';
import { panelClasses } from '@/components/ui/panel';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { EditorialSectionHeader } from '@/components/ui/workspace';
import { useAgentAccess } from '@/lib/agent/use-agent-access';
import {
  agentHandoffHref,
  contextChips,
  parseAgentHandoff,
  withoutContext,
} from '@/lib/agent/handoff';
import { approachLabel, targetKindLabel } from '@/lib/agent/vocabulary';
import { actionsQueries, type Action } from '@/lib/api/actions';
import type { AgentWorkflow } from '@/lib/api/agent';
import { AGENT_TOP_ACTIONS } from '@/lib/config/agent';
import { useProjectHref } from '@/lib/navigation/project-destination';
import { useProjectContext } from '@/lib/project/project-context';

/**
 * New chat: ask a question, start a defined workflow, or pick up an Action.
 * An evidence-screen handoff arrives as typed references in the URL and is
 * shown as removable context before the first message is sent.
 */
export function NewChatScreen() {
  const { activeProjectId, activeWorkspaceId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const handoffKey = searchParams.toString();
  return activeProjectId && activeWorkspaceId ? (
    <NewChat
      key={`${activeProjectId}:${handoffKey}`}
      workspaceId={activeWorkspaceId}
      projectId={activeProjectId}
      searchParams={searchParams}
    />
  ) : (
    <PageShell measure="workflow">
      <ProjectRequiredState />
    </PageShell>
  );
}

function NewChat({
  workspaceId,
  projectId,
  searchParams,
}: Readonly<{ workspaceId: string; projectId: string; searchParams: URLSearchParams }>) {
  const handoff = useMemo(() => parseAgentHandoff(searchParams), [searchParams]);
  const [message, setMessage] = useState(handoff.prompt ?? '');
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
  // Shares AttachedAction's cache entry. An Action that failed to load is
  // dropped, as that notice promises, rather than failing the whole chat.
  const attached = useQuery({
    ...actionsQueries.detail(workspaceId, handoff.actionId ?? ''),
    enabled: Boolean(handoff.actionId),
  });

  const actionId = attached.isError ? undefined : handoff.actionId;
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
    <PageShell
      measure="workflow"
      // Fill the viewport below the shell chrome so the composer sits at the
      // bottom of a short thread. `--route-chrome-height` (globals.css) owns the
      // chrome above the route at each breakpoint; the gutter is the shell's
      // padding under the route. Kept identical in chat- and new-chat-screen.
      className="flex min-h-[calc(100dvh-var(--route-chrome-height)-var(--content-gutter))] flex-col"
    >
      <Stack gap="section" className="my-auto">
        <h2 className={textRole('sectionTitle', 'text-center')}>What can I help with?</h2>
        {handoff.actionId ? (
          <AttachedAction workspaceId={workspaceId} actionId={handoff.actionId} />
        ) : null}
        {access.canSend ? null : <Alert tone="info">{access.message}</Alert>}
        {failure ? <Alert tone="danger">{failure.message}</Alert> : null}
        <Composer
          id="new-chat-message"
          label="Message the agent"
          value={message}
          onChange={setMessage}
          onSubmit={() => start(message, pinnedId)}
          pending={create.pending}
          disabled={!access.canSend}
          placeholder="Ask a question or describe the work you need. / picks a skill, @ mentions an Action."
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
        {picked ? (
          <WorkflowStart
            workflow={picked}
            onStart={(text) => start(text, picked.id)}
            onBack={() => setPicked(null)}
            pending={create.pending}
            disabled={!access.canSend}
          />
        ) : (
          <WorkflowGallery onPick={setPicked} disabled={!access.canSend || create.pending} />
        )}
        {handoff.actionId ? null : (
          <Disclosure title="Work on an Action">
            <Stack gap="section">
              <BriefingCard
                workspaceId={workspaceId}
                projectId={projectId}
                onStart={create.start}
                pending={create.pending}
                disabled={!access.canSend}
              />
              <TopActions workspaceId={workspaceId} projectId={projectId} />
            </Stack>
          </Disclosure>
        )}
      </Stack>
    </PageShell>
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
      size="sm"
      aria-label={`Remove workflow ${label ?? ''}`.trim()}
      onClick={onRemove}
    >
      {label ?? 'Workflow'}
      <X aria-hidden className="size-3.5" />
    </Button>
  );
}

function AttachedAction({
  workspaceId,
  actionId,
}: Readonly<{ workspaceId: string; actionId: string }>) {
  const query = useQuery(actionsQueries.detail(workspaceId, actionId));
  if (query.isError)
    return <Alert tone="danger">This Action is unavailable. The chat will start without it.</Alert>;
  if (!query.data) return null;
  const action = query.data;
  return (
    <section aria-label="Working on" className={panelClasses({ pad: 'compact' }, 'grid gap-1')}>
      <span className={textRole('label')}>Working on</span>
      <div className="flex flex-wrap items-center gap-2">
        <TextLink href={`/agent/actions/${action.id}`} text="itemTitle">
          {action.target_label}
        </TextLink>
        <ActionStatusBadge status={action.status} />
      </div>
      <span className={textRole('caption')}>
        {[targetKindLabel(action.target_kind), approachLabel(action.approach)]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </section>
  );
}

function TopActions({
  workspaceId,
  projectId,
}: Readonly<{ workspaceId: string; projectId: string }>) {
  const query = useQuery(actionsQueries.list(workspaceId, projectId));
  const top = query.data?.items.slice(0, AGENT_TOP_ACTIONS) ?? [];
  if (top.length === 0) return null;
  return (
    <Stack as="section" aria-labelledby="top-actions">
      <EditorialSectionHeader
        title="Recommended Actions"
        headingId="top-actions"
        actions={
          <Button asChild variant="ghost" size="sm">
            <ProjectLink href="/agent/actions">All Actions</ProjectLink>
          </Button>
        }
      />
      <ul className="grid gap-2">
        {top.map((action) => (
          <TopActionRow key={action.id} action={action} />
        ))}
      </ul>
    </Stack>
  );
}

function TopActionRow({ action }: Readonly<{ action: Action }>) {
  return (
    <li className={panelClasses({ pad: 'compact' }, 'flex flex-wrap items-center gap-3')}>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <TextLink href={`/agent/actions/${action.id}`} text="itemTitle" className="truncate">
          {action.target_label}
        </TextLink>
        <span className={textRole('caption')}>
          {[approachLabel(action.approach), `${action.families.length} evidence systems`]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      <Button asChild variant="secondary" size="sm">
        <ProjectLink href={agentHandoffHref({ actionId: action.id })}>Work on this</ProjectLink>
      </Button>
    </li>
  );
}

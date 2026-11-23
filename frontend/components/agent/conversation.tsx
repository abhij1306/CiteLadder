import { Fragment, useEffect, useState, type ReactNode } from 'react';

import { ActionChip } from '@/components/agent/action-chip';
import { ActivityChain } from '@/components/agent/activity-chain';
import { EvidenceChips } from '@/components/agent/evidence-chips';
import { JUMP_LINK } from '@/components/agent/jump-link';
import { LiveActivity } from '@/components/agent/live-activity';
import { ProposalCards } from '@/components/agent/proposal-cards';
import { skillLabel } from '@/components/agent/skill-picker';
import { ThreadViews } from '@/components/agent/thread-views';
import { threadItems } from '@/components/agent/thread-items';
import { TurnFailure } from '@/components/agent/turn-failure';
import { turnParts } from '@/components/agent/turn-parts';
import { useAgentCatalog } from '@/components/agent/use-agent-catalog';
import { WebSources } from '@/components/agent/web-sources';
import { Button } from '@/components/ui/button';
import { AgentThread, AgentTurn, PastedTextChip, UserTurn } from '@/components/ui/chat-dock';
import { CopyButton } from '@/components/ui/copy-button';
import { Disclosure } from '@/components/ui/disclosure';
import { DisplayTime } from '@/components/ui/display-time';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { Pressable } from '@/components/ui/pressable';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { treeBranchClasses } from '@/components/ui/workspace';
import { Pencil, RotateCcw } from '@/lib/icons';
import { documentAnchor, latestOutput, outputPlacements } from '@/lib/agent/documents';
import { citedActions } from '@/lib/agent/evidence';
import { agentHandoffHref } from '@/lib/agent/handoff';
import { activityRows } from '@/lib/agent/activity';
import { isPageReading, isRunActive, runOutcome } from '@/lib/agent/run-state';
import type { AgentChatDetail, AgentMessage, AgentOutput } from '@/lib/api/agent';
import { useAgentLinkHosts } from '@/lib/agent/link-hosts';
import { ContentMarkdown, MarkdownText } from '@/lib/markdown/markdown';
import { cn } from '@/lib/utils';

import './conversation.css';

export function Conversation({
  workspaceId,
  detail,
  renderOutput,
  onRefine,
  onRecover,
  onRetry,
  hasDraft = false,
  canSend,
  pendingMessage = null,
}: Readonly<{
  workspaceId: string;
  detail: AgentChatDetail;
  renderOutput?: (output: AgentOutput) => ReactNode;
  onRefine: (instruction: string) => void;
  onRecover: (message: AgentMessage) => void;
  onRetry: (message: AgentMessage) => void;
  hasDraft?: boolean;
  canSend: boolean;
  pendingMessage?: string | null;
}>) {
  const { skills } = useAgentCatalog();
  const output = latestOutput(detail);
  const { byMessage, unplaced } = outputPlacements(detail);
  const items = threadItems(detail, new Set(byMessage.keys()));
  const deferred = useDeferredAtOpen(detail.chat.id, items.map(itemKey));
  const older = (key: string, holdsDocument = false) =>
    deferred.has(key) && !holdsDocument ? 'render-when-visible' : undefined;
  const documents = (outputs: readonly AgentOutput[] | undefined) =>
    renderOutput
      ? outputs?.map((placed) => (
          <div key={placed.id} id={documentAnchor(placed.id)} className="min-w-0">
            {renderOutput(placed)}
          </div>
        ))
      : null;
  return (
    <AgentThread>
      <ReplyAnnouncement key={detail.chat.id} detail={detail} />
      <ContextUsed context={detail.context} />
      {renderOutput ? <DocumentList outputs={detail.outputs} /> : null}
      <Stack as="ol" gap="workspace" aria-label="Messages" className="grid-cols-1">
        {items.map((item) =>
          item.kind === 'message' ? (
            <Stack
              as="li"
              gap="workspace"
              key={item.message.id}
              className={cn(
                TURN,
                older(item.message.id, Boolean(renderOutput) && byMessage.has(item.message.id)),
              )}
            >
              <MessageBubble
                message={item.message}
                skill={skillLabel(skills, item.message.skill_id)}
                actions={detail.actions}
                after={
                  <>
                    <ProposalCards
                      workspaceId={workspaceId}
                      chatId={detail.chat.id}
                      messageId={item.message.id}
                      proposals={item.message.proposals}
                      actions={detail.actions}
                    />
                    <ThreadViews
                      scope={{ workspaceId, projectId: detail.chat.project_id }}
                      views={item.message.views}
                    />
                    {documents(byMessage.get(item.message.id))}
                  </>
                }
              />
            </Stack>
          ) : (
            <Stack
              as="li"
              gap="workspace"
              key={item.request?.id ?? item.failures[0].id}
              className={cn(TURN, older(itemKey(item)))}
            >
              {item.request ? (
                <MessageBubble message={item.request} skill={null} actions={detail.actions} />
              ) : null}
              <TurnFailure failures={item.failures} outcome={item.outcome} />
            </Stack>
          ),
        )}
      </Stack>
      {documents(unplaced)}
      {pendingMessage ? <PendingMessage text={pendingMessage} /> : null}
      <LiveActivity detail={detail} />
      <TurnActions
        detail={detail}
        canSend={canSend}
        onRetry={onRetry}
        onEdit={onRecover}
        hasDraft={hasDraft}
      />
      {output && canSend && hasFreshDeliverable(detail, output) ? (
        <FollowUps
          kind={output.kind}
          title={output.latest_revision.title}
          actionId={detail.chat.action_id}
          outputId={output.id}
          revisionId={output.latest_revision.id}
          onRefine={onRefine}
        />
      ) : null}
    </AgentThread>
  );
}
const TURN = 'min-w-0 grid-cols-1';

type ThreadItem = ReturnType<typeof threadItems>[number];
const itemKey = (item: ThreadItem) =>
  item.kind === 'message' ? item.message.id : (item.request?.id ?? item.failures[0].id);

function useDeferredAtOpen(chatId: string, keys: readonly string[]): ReadonlySet<string> {
  const atOpen = () => ({ chatId, keys: new Set(keys.slice(0, -4)) });
  const [opened, setOpened] = useState(atOpen);
  if (opened.chatId === chatId) return opened.keys;
  const next = atOpen();
  setOpened(next);
  return next.keys;
}

function ReplyAnnouncement({ detail }: Readonly<{ detail: AgentChatDetail }>) {
  const reply = [...detail.messages].reverse().find((message) => message.role === 'agent');
  const [openedWith] = useState(reply?.id);
  const [announced, setAnnounced] = useState<string | undefined>();
  const busy = isRunActive(detail.latest_run) || isPageReading(detail.page_fetch);
  const fresh = reply && !busy && reply.id !== openedWith && reply.id !== announced ? reply : null;
  const freshId = fresh?.id;
  useEffect(() => {
    if (!freshId) return;
    const timer = setTimeout(() => setAnnounced(freshId), REPLY_ANNOUNCEMENT_MS);
    return () => clearTimeout(timer);
  }, [freshId]);
  return (
    <div aria-live="polite" aria-busy={busy} className="sr-only">
      {fresh ? <MarkdownText markdown={fresh.content} /> : null}
    </div>
  );
}
const REPLY_ANNOUNCEMENT_MS = 5000;

function hasFreshDeliverable(detail: AgentChatDetail, output: AgentOutput): boolean {
  const revision = output.latest_revision;
  const reply = detail.messages.at(-1);
  return (
    revision.author === 'agent' &&
    reply?.role === 'agent' &&
    (output.message_id
      ? output.message_id === reply.id
      : Date.parse(revision.created_at) >= Date.parse(reply.created_at)) &&
    detail.latest_run?.status === 'succeeded'
  );
}

function DocumentList({ outputs }: Readonly<{ outputs: readonly AgentOutput[] }>) {
  if (outputs.length < 2) return null;
  return (
    <Stack as="nav" gap="tight" aria-label="Documents">
      <span className={textRole('body', 'text-ink-2')}>Documents</span>
      <Stack as="ol" gap="tight" className={treeBranchClasses()}>
        {outputs.map((output) => (
          <li key={output.id}>
            <Pressable
              className={textRole('caption', `${JUMP_LINK} w-auto`)}
              onClick={() =>
                document
                  .getElementById(documentAnchor(output.id))
                  ?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
              }
            >
              Document {output.number}: {output.latest_revision.title}
            </Pressable>
          </li>
        ))}
      </Stack>
    </Stack>
  );
}

function TurnActions({
  detail,
  canSend,
  onRetry,
  onEdit,
  hasDraft,
}: Readonly<{
  detail: AgentChatDetail;
  canSend: boolean;
  onRetry: (message: AgentMessage) => void;
  onEdit: (message: AgentMessage) => void;
  hasDraft: boolean;
}>) {
  const request = [...detail.messages].reverse().find((message) => message.role === 'user');
  const kind = runOutcome(detail.latest_run).kind;
  if (!canSend || !request) return null;
  const ended = ['failed', 'cancelled', 'stopped_at_limit'].includes(kind);
  if (!ended && kind !== 'succeeded') return null;
  return (
    <Inline className="flex-wrap">
      <Button variant="secondary" onClick={() => onRetry(request)}>
        <Icon icon={RotateCcw} />
        {ended ? 'Try again' : 'Regenerate'}
      </Button>
      <Button variant="quiet" onClick={() => onEdit(request)}>
        <Icon icon={Pencil} />
        {hasDraft ? 'Replace draft with last request' : 'Edit last request'}
      </Button>
    </Inline>
  );
}

function PendingMessage({ text }: Readonly<{ text: string }>) {
  return (
    <UserTurn
      text={text}
      footer={
        <output aria-live="polite" className={textRole('caption')}>
          Sending…
        </output>
      }
    />
  );
}

function MessageBubble({
  message,
  skill,
  actions,
  after,
}: Readonly<{
  message: AgentMessage;
  skill: string | null;
  actions: AgentChatDetail['actions'];
  after?: ReactNode;
}>) {
  const knownHosts = useAgentLinkHosts(message.web_sources);
  if (message.role === 'user')
    return (
      <UserTurn
        text={message.content}
        footer={
          <>
            {message.attachments.length > 0 ? (
              <Inline as="ul" aria-label="Attachments" className="flex-wrap">
                {message.attachments.map((attachment, index) => (
                  <PastedTextChip
                    key={index} // NOSONAR
                    text={attachment.text}
                    name={attachment.kind === 'file' ? attachment.name : undefined}
                  />
                ))}
              </Inline>
            ) : null}
            {message.mentions.length > 0 ? (
              <Inline as="ul" aria-label="Mentioned Actions" className="flex-wrap">
                {message.mentions.map((mention) => {
                  const action = actions.find((item) => item.id === mention.id);
                  return (
                    <li key={mention.id} className="min-w-0">
                      {action ? (
                        <ActionChip action={action} prefix="@" />
                      ) : (
                        <span className={textRole('caption', 'block truncate')}>
                          @{mention.label}
                        </span>
                      )}
                    </li>
                  );
                })}
              </Inline>
            ) : null}
          </>
        }
      />
    );
  const chips = citedActions(message.evidence_refs, actions).map((action) => ({
    text: action.target_label,
    node: <ActionChip action={action} />,
  }));
  return (
    <AgentTurn
      time={<DisplayTime value={message.created_at} />}
      meta={skill ? `Skill: ${skill}` : undefined}
    >
      {turnParts(message).map((part) => {
        switch (part.kind) {
          case 'steps':
            return <ActivityChain key="steps" rows={activityRows(part.steps)} />;
          case 'text':
            return (
              <ContentMarkdown
                key="text"
                markdown={part.markdown}
                density="compact"
                knownHosts={knownHosts}
                chips={chips}
              />
            );
          case 'evidence':
            return (
              <Inline key="evidence" className="flex-wrap">
                <EvidenceChips refs={part.refs} />
                <CopyButton value={message.content} variant="quiet">
                  Copy reply
                </CopyButton>
              </Inline>
            );
          case 'sources':
            return <WebSources key="sources" sources={part.sources} />;
          case 'outputs':
            return after ? <Fragment key="outputs">{after}</Fragment> : null;
          default: {
            const unknown: never = part;
            return unknown;
          }
        }
      })}
    </AgentTurn>
  );
}

function ContextUsed({ context }: Readonly<{ context: AgentChatDetail['context'] }>) {
  const prompt = context.prompt ?? {};
  const included = promptItems(prompt, 'included_sections');
  const omissions = [...(context.limitations ?? []), ...promptItems(prompt, 'omissions')];
  const labels: Record<string, string> = {
    brand: 'Reviewed business context',
    target_page: 'Target page',
    related_site: 'Related pages',
    opportunity: 'Recommendation',
    demand: 'Demand evidence',
    site_health: 'Page diagnosis',
    search_intelligence: 'Selected Keyword research rows',
    issue_group: 'Selected issue group',
    site_facts: 'Selected crawl robots policy',
    upstream_revision: 'Selected document revision',
  };
  if (!Object.keys(context).length) return null;
  return (
    <Disclosure title="Context used">
      <Stack gap="compact">
        <p className={textRole('caption')}>
          {included.some((section) => labels[String(section)])
            ? included.flatMap((section) => labels[String(section)] ?? []).join(' · ')
            : 'Business context and the chat so far.'}
        </p>
        {context.instructions ? (
          <p className={textRole('caption')}>
            Project instructions · revision {context.instructions.revision}
          </p>
        ) : null}
        {context.action ? (
          <p className={textRole('caption')}>Action: {context.action.label}</p>
        ) : null}
        {omissions.length > 0 ? (
          <p className={textRole('caption')}>Some older context was left out to fit this turn.</p>
        ) : null}
      </Stack>
    </Disclosure>
  );
}
function promptItems(prompt: NonNullable<AgentChatDetail['context']['prompt']>, key: string) {
  const value = prompt[key];
  return Array.isArray(value) ? value : [];
}
function FollowUps({
  kind,
  title,
  actionId,
  outputId,
  revisionId,
  onRefine,
}: Readonly<{
  kind: string;
  title: string;
  actionId: string | null;
  outputId: string;
  revisionId: string;
  onRefine: (instruction: string) => void;
}>) {
  const catalog = useAgentCatalog();
  const presentation = catalog.outputKind(kind);
  const next = (presentation?.next ?? []).flatMap((step) => {
    const workflow = catalog.workflow(step.workflow_id);
    return workflow ? [{ workflow, prompt: `${step.prompt} "${title}".` }] : [];
  });
  if (!presentation) return null;
  return (
    <Stack gap="compact">
      <Inline as="fieldset" aria-label="Suggested follow-ups" className="flex-wrap">
        <legend className={textRole('caption')}>Add a suggestion to your message:</legend>
        {presentation.refinements.map((instruction) => (
          <Button key={instruction} variant="secondary" onClick={() => onRefine(instruction)}>
            {instruction}
          </Button>
        ))}
      </Inline>
      {next.length > 0 ? (
        <Inline as="nav" aria-label="Next steps" className="flex-wrap">
          <span className={textRole('caption')}>Next, in a new chat:</span>
          {next.map(({ workflow, prompt }) => (
            <TextLink
              key={workflow.id}
              href={agentHandoffHref({
                actionId,
                prompt,
                workflowId: workflow.id,
                outputRevision: { outputId, revisionId },
              })}
            >
              {workflow.label}
            </TextLink>
          ))}
        </Inline>
      ) : null}
    </Stack>
  );
}

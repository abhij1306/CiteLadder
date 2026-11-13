import { Pencil, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';

import { EvidenceChips } from '@/components/agent/evidence-chips';
import { LiveActivity } from '@/components/agent/live-activity';
import { MessageTime } from '@/components/agent/message-time';
import { skillLabel, useSkillCatalog } from '@/components/agent/skill-picker';
import { threadItems } from '@/components/agent/thread-items';
import { TurnFailure } from '@/components/agent/turn-failure';
import { useAgentCatalog } from '@/components/agent/use-agent-catalog';
import { WebSources } from '@/components/agent/web-sources';
import { ProjectLink } from '@/components/ui/project-link';
import { Button } from '@/components/ui/button';
import { cardClasses } from '@/components/ui/card';
import { AgentThread, AgentTurn, UserTurn } from '@/components/ui/chat-dock';
import { CopyButton } from '@/components/ui/copy-button';
import { Disclosure } from '@/components/ui/disclosure';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { Pressable } from '@/components/ui/pressable';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { treeBranchClasses } from '@/components/ui/workspace';
import { documentAnchor, latestOutput, outputPlacements } from '@/lib/agent/documents';
import { agentHandoffHref } from '@/lib/agent/handoff';
import { runStepLabel, toolCallLabel } from '@/lib/agent/vocabulary';
import { runOutcome } from '@/lib/agent/run-state';
import type { AgentChatDetail, AgentMessage, AgentOutput } from '@/lib/api/agent';
import { useAgentLinkHosts } from '@/lib/agent/link-hosts';
import { ContentMarkdown } from '@/lib/markdown/markdown';
import { cn } from '@/lib/utils';

/**
 * Messages and the chat's documents in conversational order (each document
 * after the reply that last wrote it), followed by current activity and
 * recovery. Follow-ups never jump ahead of earlier work.
 */
export function Conversation({
  detail,
  renderOutput,
  onRefine,
  onRecover,
  onRetry,
  hasDraft = false,
  canSend,
  pendingMessage = null,
}: Readonly<{
  detail: AgentChatDetail;
  /** How one document is shown in the thread; omitted, documents are not shown. */
  renderOutput?: (output: AgentOutput) => ReactNode;
  onRefine: (instruction: string) => void;
  /** Puts a request back in the composer to edit. */
  onRecover: (message: AgentMessage) => void;
  /** Sends a request again as a new turn. */
  onRetry: (message: AgentMessage) => void;
  hasDraft?: boolean;
  canSend: boolean;
  /** A message whose send is in flight, shown before the server accepts it. */
  pendingMessage?: string | null;
}>) {
  const skills = useSkillCatalog();
  const output = latestOutput(detail);
  const { byMessage, unplaced } = outputPlacements(detail);
  const documents = (outputs: readonly AgentOutput[] | undefined) =>
    renderOutput
      ? outputs?.map((placed) => (
          <div
            key={placed.id}
            id={documentAnchor(placed.id)}
            className={cn(cardClasses(), 'min-w-0')}
          >
            {renderOutput(placed)}
          </div>
        ))
      : null;
  return (
    <AgentThread>
      <ContextUsed context={detail.context} />
      {renderOutput ? <DocumentList outputs={detail.outputs} /> : null}
      <Stack as="ol" gap="workspace" aria-label="Messages">
        {threadItems(detail, new Set(byMessage.keys())).map((item) =>
          item.kind === 'message' ? (
            <Stack as="li" gap="workspace" key={item.message.id}>
              <MessageBubble
                message={item.message}
                skill={skillLabel(skills, item.message.skill_id)}
              />
              {documents(byMessage.get(item.message.id))}
            </Stack>
          ) : (
            <Stack as="li" gap="workspace" key={item.request?.id ?? item.failures[0].id}>
              {item.request ? <MessageBubble message={item.request} skill={null} /> : null}
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

/** The latest reply wrote this document and the turn finished. */
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

/** With more than one document, a list that jumps to each in the thread. */
function DocumentList({ outputs }: Readonly<{ outputs: readonly AgentOutput[] }>) {
  if (outputs.length < 2) return null;
  return (
    <Stack as="nav" gap="tight" aria-label="Documents">
      <span className={textRole('label')}>Documents</span>
      <Stack as="ol" gap="tight" className={treeBranchClasses()}>
        {outputs.map((output) => (
          <li key={output.id}>
            <Pressable
              className={textRole('caption', 'hover:text-accent-ink w-auto')}
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

/**
 * What the reader can do with the latest turn: try a failed or stopped request
 * again or edit it first, or regenerate a finished reply. Each sends a new
 * turn; nothing earlier in the chat is rewritten.
 */
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
      <Button variant="ghost" onClick={() => onEdit(request)}>
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
}: Readonly<{ message: AgentMessage; skill: string | null }>) {
  const knownHosts = useAgentLinkHosts(message.web_sources);
  if (message.role === 'user')
    return (
      <UserTurn
        text={message.content}
        footer={
          message.mentions.length > 0 ? (
            <Inline as="ul" aria-label="Mentioned Actions" className="flex-wrap">
              {message.mentions.map((mention) => (
                <li key={mention.id}>
                  <TextLink href={`/agent/actions/${mention.id}`} text="caption">
                    @{mention.label}
                  </TextLink>
                </li>
              ))}
            </Inline>
          ) : null
        }
      />
    );
  return (
    <AgentTurn
      time={<MessageTime value={message.created_at} />}
      meta={skill ? `Skill: ${skill}` : undefined}
    >
      <ContentMarkdown markdown={message.content} density="compact" knownHosts={knownHosts} />
      <Inline className="flex-wrap">
        <EvidenceChips refs={message.evidence_refs} />
        <CopyButton value={message.content} variant="ghost">
          Copy reply
        </CopyButton>
      </Inline>
      <WebSources sources={message.web_sources} />
      {message.steps.length > 0 ? (
        <Disclosure title={runSummary(message.steps)}>
          <Stack as="ul" gap="tight" className={treeBranchClasses()}>
            {message.steps.map((step, index) => (
              <li key={`${step.kind}-${index}`} className={textRole('caption')}>
                {stepLabel(step)}
              </li>
            ))}
          </Stack>
        </Disclosure>
      ) : null}
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
    search_intelligence: 'Selected Keyword Research rows',
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
          <p className={textRole('caption')}>
            Some older messages or context were left out to fit this turn.
          </p>
        ) : null}
      </Stack>
    </Disclosure>
  );
}
function promptItems(prompt: NonNullable<AgentChatDetail['context']['prompt']>, key: string) {
  const value = prompt[key];
  return Array.isArray(value) ? value : [];
}
/**
 * After a deliverable: refinements revise it in this chat; next steps start a
 * new chat with the workflow that takes the work forward, carrying the exact
 * revision as its brief. Both come from the server catalog for the kind.
 */
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
            <Button key={workflow.id} asChild variant="ghost">
              <ProjectLink
                href={agentHandoffHref({
                  actionId,
                  prompt,
                  workflowId: workflow.id,
                  outputRevision: { outputId, revisionId },
                })}
              >
                {workflow.label}
              </ProjectLink>
            </Button>
          ))}
        </Inline>
      ) : null}
    </Stack>
  );
}

type MessageStep = AgentMessage['steps'][number];

function runSummary(steps: readonly MessageStep[]): string {
  const count = (kind: string) => steps.filter((step) => step.kind === kind).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const calls = count('model'),
    reads = count('tool'),
    searches = count('search');
  return [
    'Run complete',
    plural(calls, 'model call', 'model calls'),
    reads > 0 ? plural(reads, 'data read', 'data reads') : null,
    searches > 0 ? plural(searches, 'web search', 'web searches') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function stepLabel(step: MessageStep): string {
  if (step.kind === 'skill') return toolCallLabel({ tool: 'load_skill', status: 'completed' });
  if (step.kind === 'document')
    return toolCallLabel({ tool: 'save_document', status: 'completed' });
  if (step.kind === 'suggestion')
    return toolCallLabel({ tool: 'suggest_edits', status: 'completed' });
  if (step.kind === 'search')
    return step.query ? `Searched the web: ${step.query}` : 'Searched the web';
  if (step.kind === 'tool')
    return runStepLabel({
      tool: step.tool ?? 'read_data',
      status: step.status ?? 'unknown',
    });
  return step.ordinal ? `Model call ${step.ordinal}` : 'Worked on the reply';
}

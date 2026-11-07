'use client';

import { Pencil, RotateCcw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { EvidenceChips } from '@/components/agent/evidence-chips';
import { skillLabel, useSkillCatalog } from '@/components/agent/skill-picker';
import { LiveReply } from '@/components/agent/live-reply';
import { useAgentCatalog } from '@/components/agent/use-agent-catalog';
import { WebSources } from '@/components/agent/web-sources';
import { ProjectLink } from '@/components/ui/project-link';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { cardClasses } from '@/components/ui/card';
import { AgentThread, AgentTurn, UserTurn } from '@/components/ui/chat-dock';
import { CopyButton } from '@/components/ui/copy-button';
import { Disclosure } from '@/components/ui/disclosure';
import { DisplayTime } from '@/components/ui/display-time';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { Pressable } from '@/components/ui/pressable';
import { Spinner } from '@/components/ui/spinner';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { treeBranchClasses } from '@/components/ui/workspace';
import { documentAnchor, latestOutput, outputPlacements } from '@/lib/agent/documents';
import { agentHandoffHref } from '@/lib/agent/handoff';
import { runErrorCopy, runStepLabel, toolCallLabel } from '@/lib/agent/vocabulary';
import { runOutcome } from '@/lib/agent/run-state';
import { useLiveTurn, type LiveTurn } from '@/lib/agent/live-turns';
import type { AgentChatDetail, AgentMessage, AgentOutput, AgentRun } from '@/lib/api/agent';
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
        {detail.messages.map((message) => (
          <Stack as="li" gap="workspace" key={message.id}>
            <MessageBubble message={message} skill={skillLabel(skills, message.skill_id)} />
            {documents(byMessage.get(message.id))}
          </Stack>
        ))}
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

/**
 * The running turn's live events. Subscribed here, not in the conversation, so
 * each streamed delta re-renders only this activity, never the earlier messages.
 */
function LiveActivity({ detail }: Readonly<{ detail: AgentChatDetail }>) {
  const outcome = runOutcome(detail.latest_run);
  const live = useLiveTurn(outcome.kind === 'running' ? outcome.run.id : null);
  return (
    <>
      <LiveReply live={live} />
      <RunState detail={detail} live={live} />
    </>
  );
}

function MessageBubble({
  message,
  skill,
}: Readonly<{ message: AgentMessage; skill: string | null }>) {
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
      time={<DisplayTime value={message.created_at} />}
      meta={skill ? `Skill: ${skill}` : undefined}
    >
      <ContentMarkdown markdown={message.content} density="compact" />
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
  if (step.kind === 'search')
    return step.query ? `Searched the web: ${step.query}` : 'Searched the web';
  if (step.kind === 'tool')
    return runStepLabel({
      tool: step.tool ?? 'read_data',
      status: step.status ?? 'unknown',
    });
  return step.ordinal ? `Model call ${step.ordinal}` : 'Worked on the reply';
}

function RunState({
  detail,
  live,
}: Readonly<{ detail: AgentChatDetail; live: LiveTurn | undefined }>) {
  const outcome = runOutcome(detail.latest_run);
  const answered = detail.messages.at(-1)?.role === 'agent';
  switch (outcome.kind) {
    case 'running':
      return <RunningState run={outcome.run} queued={outcome.queued} live={live} />;
    // Every ended turn now answers with its own reply; older ones may not have.
    case 'stopped_at_limit':
      return answered ? null : <Callout tone="warning">{runErrorCopy('stopped_at_limit')}</Callout>;
    case 'failed':
      return answered ? null : <Callout tone="negative">{runErrorCopy(outcome.code)}</Callout>;
    default:
      return null;
  }
}
function RunningState({
  run,
  queued,
  live,
}: Readonly<{ run: AgentRun; queued: boolean; live: LiveTurn | undefined }>) {
  const label =
    queued && !live?.step
      ? 'Waiting to start…'
      : (liveStepLabel(live) ?? activeStepLabel(run.progress, run.attempt_count));
  // The current model call's tool calls run at the same time.
  const current = live?.tools.filter((tool) => tool.ordinal === live.step) ?? [];
  return (
    <Stack gap="compact">
      <Inline as="span" gap="compact" className={textRole('caption')}>
        <Spinner className="text-ink-muted" />
        <output aria-live="polite" className="flex-1">
          {label}
          <Elapsed since={live?.startedAt ?? Date.parse(run.created_at)} />
        </output>
      </Inline>
      {current.length > 1 ? (
        <Stack as="ul" gap="tight" aria-label="Current reads" className={treeBranchClasses()}>
          {current.map((tool) => (
            <li key={tool.call_id} className={textRole('caption')}>
              {toolCallLabel(tool)}
            </li>
          ))}
        </Stack>
      ) : null}
      {run.progress.length > 0 ? <RunActivity progress={run.progress} /> : null}
    </Stack>
  );
}
/** What the newest model call is doing: its running reads, else deciding. */
function liveStepLabel(live: LiveTurn | undefined) {
  if (!live?.step) return null;
  const running = live.tools.filter(
    (tool) => tool.ordinal === live.step && tool.status === 'started',
  );
  if (running.length > 1) return `Running ${running.length} reads at once…`;
  if (running[0]) return toolCallLabel(running[0]);
  return runStepLabel({ status: 'working', tool: null });
}
function Elapsed({ since }: Readonly<{ since: number }>) {
  const now = useNow(1000);
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return seconds >= 3 ? <span className="text-ink-muted"> · {seconds}s</span> : null;
}
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
function activeStepLabel(progress: AgentRun['progress'], attemptCount: number | undefined) {
  const currentAttempt = attemptCount ?? progress.at(-1)?.run_attempt;
  const current = [...progress].reverse().find((step) => step.run_attempt === currentAttempt);
  return current ? runStepLabel(current) : 'The agent is working…';
}
function RunActivity({ progress }: Readonly<{ progress: AgentRun['progress'] }>) {
  return (
    <Disclosure title="View activity">
      <Stack as="ol" gap="tight" aria-label="Agent progress" className={treeBranchClasses()}>
        {progress.map((step) => (
          <li
            key={`${step.run_attempt}:${step.ordinal}:${step.call_id ?? 'model'}`}
            className={textRole('caption')}
          >
            {runStepLabel(step)}
          </li>
        ))}
      </Stack>
    </Disclosure>
  );
}

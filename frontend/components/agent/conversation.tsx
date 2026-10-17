'use client';

import { Pencil, RotateCcw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { EvidenceChips } from '@/components/agent/evidence-chips';
import { skillLabel, useSkillCatalog } from '@/components/agent/skill-picker';
import { LiveReply } from '@/components/agent/live-reply';
import { useAgentCatalog } from '@/components/agent/use-agent-catalog';
import { ProjectLink } from '@/components/layout/scoped-link';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Disclosure } from '@/components/ui/disclosure';
import { panelClasses } from '@/components/ui/panel';
import { Spinner } from '@/components/ui/spinner';
import { TextLink } from '@/components/ui/text-link';
import { textRole } from '@/components/ui/typography';
import { agentHandoffHref } from '@/lib/agent/handoff';
import { runErrorCopy, runStepLabel, toolCallLabel } from '@/lib/agent/vocabulary';
import { runOutcome } from '@/lib/agent/run-state';
import { useLiveTurn, type LiveTurn } from '@/lib/agent/live-turns';
import type { AgentChatDetail, AgentMessage, AgentRun } from '@/lib/api/agent';
import { ContentMarkdown } from '@/lib/markdown/markdown';
import { cn } from '@/lib/utils';

/**
 * Messages and the saved output in conversational order, followed by current
 * activity and recovery. Follow-ups never jump ahead of earlier work.
 */
export function Conversation({
  detail,
  output: outputView,
  onRefine,
  onRecover,
  onRetry,
  hasDraft = false,
  canSend,
  pendingMessage = null,
}: Readonly<{
  detail: AgentChatDetail;
  output?: ReactNode;
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
  const output = detail.output;
  const outputMessageId = output?.message_id ?? revisionReplyMessage(detail);
  return (
    <div className="grid gap-4">
      <ContextUsed context={detail.context} />
      <ol aria-label="Messages" className="grid gap-4">
        {detail.messages.map((message) => (
          <li key={message.id} className="grid gap-4">
            <MessageBubble message={message} skill={skillLabel(skills, message.skill_id)} />
            {outputView && message.id === outputMessageId ? (
              <div className={panelClasses({}, 'min-w-0')}>{outputView}</div>
            ) : null}
          </li>
        ))}
      </ol>
      {outputView && !outputMessageId ? (
        <div className={panelClasses({}, 'min-w-0')}>{outputView}</div>
      ) : null}
      {pendingMessage ? <PendingMessage text={pendingMessage} /> : null}
      <LiveActivity detail={detail} />
      <TurnActions
        detail={detail}
        canSend={canSend}
        onRetry={onRetry}
        onEdit={onRecover}
        hasDraft={hasDraft}
      />
      {output?.latest_revision && canSend && hasFreshDeliverable(detail) ? (
        <FollowUps
          kind={output.kind}
          title={output.latest_revision.title}
          actionId={detail.chat.action_id}
          outputId={output.id}
          revisionId={output.latest_revision.id}
          onRefine={onRefine}
        />
      ) : null}
    </div>
  );
}

/** A revision without a recorded generating reply matches by its persisted time. */
function revisionReplyMessage(detail: AgentChatDetail) {
  const revision = detail.output?.latest_revision;
  if (!revision) return undefined;
  return [...detail.messages]
    .reverse()
    .find(
      (message) =>
        message.role === 'agent' &&
        Date.parse(message.created_at) <= Date.parse(revision.created_at),
    )?.id;
}

function hasFreshDeliverable(detail: AgentChatDetail): boolean {
  const revision = detail.output?.latest_revision;
  const reply = detail.messages.at(-1);
  return (
    revision?.author === 'agent' &&
    reply?.role === 'agent' &&
    (detail.output?.message_id
      ? detail.output.message_id === reply.id
      : Date.parse(revision.created_at) >= Date.parse(reply.created_at)) &&
    detail.latest_run?.status === 'succeeded'
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
  if (!canSend || !request || request.event?.kind === 'outline_approved') return null;
  const ended = ['failed', 'cancelled', 'stopped_at_limit'].includes(kind);
  if (!ended && kind !== 'succeeded') return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" onClick={() => onRetry(request)}>
        <RotateCcw aria-hidden className="size-4" />
        {ended ? 'Try again' : 'Regenerate'}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => onEdit(request)}>
        <Pencil aria-hidden className="size-4" />
        {hasDraft ? 'Replace draft with last request' : 'Edit last request'}
      </Button>
    </div>
  );
}

function PendingMessage({ text }: Readonly<{ text: string }>) {
  return (
    <div className="flex justify-end">
      <div className={panelClasses({ tone: 'well', pad: 'compact' }, 'grid max-w-[85%] gap-1')}>
        <p className={textRole('body', 'whitespace-pre-wrap')}>{text}</p>
        <output aria-live="polite" className={textRole('caption')}>
          Sending…
        </output>
      </div>
    </div>
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
  if (message.event?.kind === 'outline_approved')
    return (
      <article
        aria-label="Outline approval"
        className={panelClasses({ tone: 'well', pad: 'compact' }, 'grid gap-1')}
      >
        <span className={textRole('label')}>Outline approved</span>
        <p className={textRole('caption')}>Draft requested from the approved revision.</p>
      </article>
    );
  if (message.role === 'user')
    return (
      <div className="flex justify-end">
        <div className={panelClasses({ tone: 'well', pad: 'compact' }, 'grid max-w-[85%] gap-2')}>
          <p className={textRole('body', 'whitespace-pre-wrap')}>{message.content}</p>
          {message.mentions.length > 0 ? (
            <ul aria-label="Mentioned Actions" className="flex flex-wrap gap-2">
              {message.mentions.map((mention) => (
                <li key={mention.id}>
                  <TextLink href={`/agent/actions/${mention.id}`} text="caption">
                    @{mention.label}
                  </TextLink>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    );
  const calls = message.steps.filter((step) => step.kind === 'model').length;
  const tools = message.steps.filter((step) => step.kind === 'tool').length;
  const readsLabel = tools === 1 ? 'read' : 'reads';
  return (
    <article aria-label="Agent reply" className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={textRole('label')}>Agent</span>
        {skill ? <span className={textRole('caption')}>Skill: {skill}</span> : null}
      </div>
      <ContentMarkdown markdown={message.content} density="compact" />
      <div className="flex flex-wrap items-center gap-2">
        <EvidenceChips refs={message.evidence_refs} />
        <CopyButton value={message.content} size="sm" variant="ghost">
          Copy reply
        </CopyButton>
      </div>
      {message.steps.length > 0 ? (
        <details className="group">
          <summary className={textRole('caption', 'cursor-pointer')}>
            Run complete · {calls} model {calls === 1 ? 'call' : 'calls'}
            {tools > 0 ? ` · ${tools} data ${readsLabel}` : ''}
          </summary>
          <ul className="grid gap-1 ps-4 pt-2">
            {message.steps.map((step, index) => (
              <li key={`${step.kind}-${index}`} className={textRole('caption')}>
                {stepLabel(step)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
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
    search_intelligence: 'Selected Search Intelligence rows',
    issue_group: 'Selected issue group',
    site_facts: 'Selected crawl robots policy',
    upstream_revision: 'Selected document revision',
  };
  if (!Object.keys(context).length) return null;
  return (
    <Disclosure title="Context used">
      <div className="grid gap-2">
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
      </div>
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
    <div className="grid gap-3">
      <fieldset aria-label="Suggested follow-ups" className="flex flex-wrap gap-2">
        <legend className={textRole('caption')}>Add a suggestion to your message:</legend>
        {presentation.refinements.map((instruction) => (
          <Button
            key={instruction}
            variant="secondary"
            size="sm"
            onClick={() => onRefine(instruction)}
          >
            {instruction}
          </Button>
        ))}
      </fieldset>
      {next.length > 0 ? (
        <nav aria-label="Next steps" className="flex flex-wrap items-center gap-2">
          <span className={textRole('caption')}>Next, in a new chat:</span>
          {next.map(({ workflow, prompt }) => (
            <Button key={workflow.id} asChild variant="ghost" size="sm">
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
        </nav>
      ) : null}
    </div>
  );
}

function stepLabel(step: AgentMessage['steps'][number]): string {
  if (step.kind === 'skill') return toolCallLabel({ tool: 'load_skill', status: 'completed' });
  if (step.kind === 'document')
    return toolCallLabel({ tool: 'save_document', status: 'completed' });
  if (step.kind === 'tool')
    return runStepLabel({ tool: step.tool ?? 'read_data', status: step.status ?? 'unknown' });
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
      return answered ? null : <Alert tone="warning">{runErrorCopy('stopped_at_limit')}</Alert>;
    case 'failed':
      return answered ? null : <Alert tone="danger">{runErrorCopy(outcome.code)}</Alert>;
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
    <div className="grid gap-2">
      <span className={cn('flex items-center gap-3', textRole('caption'))}>
        <Spinner className="text-muted" />
        <output aria-live="polite" className="flex-1">
          {label}
          <Elapsed since={live?.startedAt ?? Date.parse(run.created_at)} />
        </output>
      </span>
      {current.length > 1 ? (
        <ul aria-label="Current reads" className="grid gap-1 ps-8">
          {current.map((tool) => (
            <li key={tool.call_id} className={textRole('caption')}>
              {toolCallLabel(tool)}
            </li>
          ))}
        </ul>
      ) : null}
      {run.progress.length > 0 ? <RunActivity progress={run.progress} /> : null}
    </div>
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
  return seconds >= 3 ? <span className="text-muted"> · {seconds}s</span> : null;
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
    <details>
      <summary className={textRole('caption', 'cursor-pointer')}>View activity</summary>
      <ol aria-label="Agent progress" className="grid gap-1 ps-4 pt-2">
        {progress.map((step) => (
          <li
            key={`${step.run_attempt}:${step.ordinal}:${step.call_id ?? 'model'}`}
            className={textRole('caption')}
          >
            {runStepLabel(step)}
          </li>
        ))}
      </ol>
    </details>
  );
}

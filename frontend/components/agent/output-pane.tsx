'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Pencil } from 'lucide-react';
import { useState } from 'react';

import { OutputDeclaration } from '@/components/agent/action-declaration';
import { useAgentCatalog } from '@/components/agent/use-agent-catalog';
import { OutputCanvas } from '@/components/agent/output-canvas';
import { EvidenceChips } from '@/components/agent/evidence-chips';
import { OutputEditor, type OutputDraft } from '@/components/agent/output-editor';
import { OutputHistory } from '@/components/agent/output-history';
import {
  PromptProposalAction,
  promptPortfolioReport,
} from '@/components/agent/prompt-proposal-action';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { textRole } from '@/components/ui/typography';
import { agentWriteFailure } from '@/lib/agent/errors';
import { downloadOutputMarkdown, outputMarkdown } from '@/lib/agent/export';
import { newIdempotencyKey } from '@/lib/agent/idempotency';
import { OUTPUT_PHASE_LABEL } from '@/lib/agent/vocabulary';
import { agentMutations, type AgentOutput, type AgentRevision } from '@/lib/api/agent';
import { queryKeys } from '@/lib/api/query-keys';
import { ContentMarkdown } from '@/lib/markdown/markdown';

type PaneTab = 'output' | 'sources' | 'history';

/**
 * The chat's deliverable, shown inline in the thread. Edits, restores and outline approval are refused by
 * the server while a turn is queued or running, so the pane disables them
 * then rather than offering a control that will fail.
 */
export function OutputPane({
  workspaceId,
  chatId,
  output,
  runActive,
  canEdit,
  canSend,
  onRevise,
}: Readonly<{
  workspaceId: string;
  chatId: string;
  output: AgentOutput;
  runActive: boolean;
  canEdit: boolean;
  canSend: boolean;
  /** Sends a follow-up turn asking the agent to revise part of the output. */
  onRevise: (message: string) => void;
}>) {
  const { kindLabel } = useAgentCatalog();
  const revision = output.latest_revision;
  const [tab, setTab] = useState<PaneTab>('output');
  // Held here, not in the editor, so switching tabs cannot discard it.
  const [draft, setDraft] = useState<OutputDraft | null>(null);
  const editing = draft !== null;
  if (!revision) return null;
  const locked = runActive || !canEdit;
  const document =
    output.kind === 'prompt_portfolio' ? (
      <ContentMarkdown markdown={promptPortfolioReport(revision.body)} density="compact" />
    ) : (
      <OutputCanvas
        workspaceId={workspaceId}
        chatId={chatId}
        revision={revision}
        locked={locked}
        canSend={canSend}
        onRevise={onRevise}
      />
    );
  return (
    <section aria-labelledby="output-title" className="grid min-w-0 content-start gap-3">
      <header className="grid gap-2">
        <h2 id="output-title" className={textRole('sectionTitle', 'min-w-0')}>
          {revision.title}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{kindLabel(output.kind)}</Badge>
          <Badge>{OUTPUT_PHASE_LABEL[output.phase]}</Badge>
          <span className={textRole('caption')}>Revision {revision.number}</span>
          {output.target_label ? (
            <span className={textRole('caption', 'truncate')}>{output.target_label}</span>
          ) : null}
        </div>
        {editing ? null : (
          <OutputActions
            revision={revision}
            locked={locked}
            onEdit={() => {
              setTab('output');
              setDraft({ baseRevisionId: revision.id, title: revision.title, body: revision.body });
            }}
          />
        )}
        <OutlineApproval
          workspaceId={workspaceId}
          chatId={chatId}
          kind={output.kind}
          revision={revision}
          runActive={runActive}
          canSend={canSend}
        />
        {editing ? null : (
          <OutputDeclaration workspaceId={workspaceId} output={output} runActive={runActive} />
        )}
        {editing ? null : (
          <PortfolioSubmission
            workspaceId={workspaceId}
            kind={output.kind}
            revision={revision}
            disabled={locked || !canSend}
          />
        )}
      </header>
      <Tabs
        value={tab}
        onValueChange={setTab}
        ariaLabel="Output views"
        items={[
          { value: 'output', label: OUTPUT_PHASE_LABEL[output.phase] },
          { value: 'sources', label: 'Sources' },
          { value: 'history', label: 'History' },
        ]}
      >
        <TabPanel value="output" className="min-w-0 pt-3">
          {draft ? (
            <OutputEditor
              workspaceId={workspaceId}
              chatId={chatId}
              revision={revision}
              draft={draft}
              onChange={setDraft}
              onDone={() => setDraft(null)}
            />
          ) : (
            document
          )}
        </TabPanel>
        <TabPanel value="sources" className="pt-3">
          {revision.source_refs.length === 0 ? (
            <p className={textRole('body')}>This revision cites no CiteLadder records.</p>
          ) : (
            <EvidenceChips refs={revision.source_refs} label="Sources" />
          )}
        </TabPanel>
        <TabPanel value="history" className="pt-3">
          {tab === 'history' ? (
            <OutputHistory
              workspaceId={workspaceId}
              chatId={chatId}
              latestRevisionId={revision.id}
              canRestore={!locked}
            />
          ) : null}
        </TabPanel>
      </Tabs>
    </section>
  );
}

/** A written question portfolio (not its coverage plan) can go to Prompts review. */
function PortfolioSubmission({
  workspaceId,
  kind,
  revision,
  disabled,
}: Readonly<{
  workspaceId: string;
  kind: AgentOutput['kind'];
  revision: AgentRevision;
  disabled: boolean;
}>) {
  if (kind !== 'prompt_portfolio' || revision.phase === 'outline') return null;
  return (
    <PromptProposalAction
      workspaceId={workspaceId}
      revisionId={revision.id}
      body={revision.body}
      disabled={disabled}
    />
  );
}

function OutputActions({
  revision,
  locked,
  onEdit,
}: Readonly<{ revision: AgentRevision; locked: boolean; onEdit: () => void }>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" disabled={locked} onClick={onEdit}>
        <Pencil className="size-3.5" aria-hidden />
        Edit
      </Button>
      <CopyButton
        value={outputMarkdown(revision.title, revision.body)}
        size="sm"
        variant="secondary"
      >
        Copy
      </CopyButton>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => downloadOutputMarkdown(revision.title, revision.body)}
      >
        <Download className="size-3.5" aria-hidden />
        Export Markdown
      </Button>
    </div>
  );
}

const OUTLINE_APPROVAL: Partial<Record<string, { help: string; action: string }>> = {
  content: {
    help: 'Review the outline, edit it if needed, then approve it to write the draft.',
    action: 'Use outline & write',
  },
  prompt_portfolio: {
    help: 'Review the coverage plan: edit the decisions, topics and answers to any questions, then approve it to write the buyer questions.',
    action: 'Approve plan & write questions',
  },
};

/** The explicit approval that lets the full deliverable be written. */
function OutlineApproval({
  workspaceId,
  chatId,
  kind,
  revision,
  runActive,
  canSend,
}: Readonly<{
  workspaceId: string;
  chatId: string;
  kind: AgentOutput['kind'];
  revision: AgentRevision;
  runActive: boolean;
  canSend: boolean;
}>) {
  const queryClient = useQueryClient();
  const approve = useMutation({
    ...agentMutations.approveOutline(workspaceId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.agent.chat(chatId) }),
  });
  if (revision.phase !== 'outline' || revision.approved_at) return null;
  const copy = OUTLINE_APPROVAL[kind] ?? OUTLINE_APPROVAL.content!;
  return (
    <div className="grid gap-2">
      <p className={textRole('body')}>{copy.help}</p>
      {approve.isError ? (
        <Alert tone="danger">{agentWriteFailure(approve.error).message}</Alert>
      ) : null}
      <Button
        className="justify-self-start"
        disabled={!canSend || runActive || approve.isPending}
        onClick={() =>
          approve.mutate({ chatId, revisionId: revision.id, idempotencyKey: newIdempotencyKey() })
        }
      >
        {copy.action}
      </Button>
    </div>
  );
}

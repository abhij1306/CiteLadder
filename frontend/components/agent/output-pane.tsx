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
import { ProjectLink } from '@/components/layout/scoped-link';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Icon } from '@/components/ui/icon';
import { Inline, Stack } from '@/components/ui/layout';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { textRole } from '@/components/ui/typography';
import { agentWriteFailure } from '@/lib/agent/errors';
import { downloadOutputMarkdown, outputMarkdown } from '@/lib/agent/export';
import { newIdempotencyKey } from '@/lib/agent/idempotency';
import { OUTPUT_PHASE_LABEL } from '@/lib/agent/vocabulary';
import { agentMutations, type AgentOutput, type AgentRevision } from '@/lib/api/agent';
import { queryKeys } from '@/lib/api/query-keys';
import { PROMPTS_GENERATE_HREF } from '@/lib/prompts/routes';

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
  const document = (
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
    <Stack
      as="section"
      gap="compact"
      aria-labelledby="output-title"
      className="min-w-0 content-start"
    >
      <Stack as="header" gap="tight">
        <h2 id="output-title" className={textRole('sectionTitle', 'min-w-0')}>
          {revision.title}
        </h2>
        <Inline className="flex-wrap">
          <Badge>{kindLabel(output.kind)}</Badge>
          <Badge>{OUTPUT_PHASE_LABEL[output.phase]}</Badge>
          <span className={textRole('caption')}>Revision {revision.number}</span>
          {output.target_label ? (
            <span className={textRole('caption', 'truncate')}>{output.target_label}</span>
          ) : null}
        </Inline>
        {editing ? null : (
          <OutputActions
            revision={revision}
            locked={locked}
            onEdit={() => {
              setTab('output');
              setDraft({
                baseRevisionId: revision.id,
                title: revision.title,
                body: revision.body,
              });
            }}
          />
        )}
        <OutlineApproval
          workspaceId={workspaceId}
          chatId={chatId}
          revision={revision}
          runActive={runActive}
          canSend={canSend}
        />
        {editing ? null : (
          <OutputDeclaration workspaceId={workspaceId} output={output} runActive={runActive} />
        )}
        {editing ? null : <PromptBuilderHandoff kind={output.kind} />}
      </Stack>
      <Tabs
        value={tab}
        onValueChange={setTab}
        ariaLabel="Output views"
        spaced
        items={[
          { value: 'output', label: OUTPUT_PHASE_LABEL[output.phase] },
          { value: 'sources', label: 'Sources' },
          { value: 'history', label: 'History' },
        ]}
      >
        <TabPanel value="output" className="min-w-0">
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
        <TabPanel value="sources">
          {revision.source_refs.length === 0 ? (
            <p className={textRole('body')}>This revision cites no CiteLadder records.</p>
          ) : (
            <EvidenceChips refs={revision.source_refs} label="Sources" />
          )}
        </TabPanel>
        <TabPanel value="history">
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
    </Stack>
  );
}

/**
 * A prompt plan is applied in the Prompt Builder, where a person confirms
 * topics and starts the run; the Agent writes no prompts itself.
 */
function PromptBuilderHandoff({ kind }: Readonly<{ kind: AgentOutput['kind'] }>) {
  if (kind !== 'prompt_plan') return null;
  return (
    <Button asChild className="justify-self-start">
      <ProjectLink href={PROMPTS_GENERATE_HREF}>Open Prompt Builder</ProjectLink>
    </Button>
  );
}

function OutputActions({
  revision,
  locked,
  onEdit,
}: Readonly<{ revision: AgentRevision; locked: boolean; onEdit: () => void }>) {
  return (
    <Inline className="flex-wrap">
      <Button variant="secondary" disabled={locked} onClick={onEdit}>
        <Icon icon={Pencil} />
        Edit
      </Button>
      <CopyButton value={outputMarkdown(revision.title, revision.body)} variant="secondary">
        Copy
      </CopyButton>
      <Button
        variant="secondary"
        onClick={() => downloadOutputMarkdown(revision.title, revision.body)}
      >
        <Icon icon={Download} />
        Export Markdown
      </Button>
    </Inline>
  );
}

/** Only long-form content is outline-first. */
const OUTLINE_APPROVAL = {
  help: 'Review the outline, edit it if needed, then approve it to write the draft.',
  action: 'Use outline & write',
};

/** The explicit approval that lets the full deliverable be written. */
function OutlineApproval({
  workspaceId,
  chatId,
  revision,
  runActive,
  canSend,
}: Readonly<{
  workspaceId: string;
  chatId: string;
  revision: AgentRevision;
  runActive: boolean;
  canSend: boolean;
}>) {
  const queryClient = useQueryClient();
  const approve = useMutation({
    ...agentMutations.approveOutline(workspaceId),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: queryKeys.agent.chat(chatId),
      }),
  });
  if (revision.phase !== 'outline' || revision.approved_at) return null;
  return (
    <Stack gap="compact">
      <p className={textRole('body')}>{OUTLINE_APPROVAL.help}</p>
      {approve.isError ? (
        <Alert tone="danger">{agentWriteFailure(approve.error).message}</Alert>
      ) : null}
      <Button
        className="justify-self-start"
        disabled={!canSend || runActive || approve.isPending}
        onClick={() =>
          approve.mutate({
            chatId,
            revisionId: revision.id,
            idempotencyKey: newIdempotencyKey(),
          })
        }
      >
        {OUTLINE_APPROVAL.action}
      </Button>
    </Stack>
  );
}

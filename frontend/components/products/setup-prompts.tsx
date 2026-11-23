import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { Tag } from '@/components/ui/tag';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { Textarea } from '@/components/ui/textarea';
import { Stack } from '@/components/ui/layout';
import { LedgerItem, LedgerList } from '@/components/ui/ledger-list';
import { MessageSquare } from '@/lib/icons';
import { commerceMutations } from '@/lib/api/commerce';
import { mutationNoticeForError } from '@/lib/api/mutation-notice';
import type { CommerceTarget } from '@citeladder/contracts/commerce-suite';
import { LaunchDialog } from '@/components/runs/launch-dialog';
import { ProjectLink } from '@/components/ui/project-link';
import { useRunEvents } from '@/lib/runs/use-run-events';
import { CategoryMatrixSheet } from './category-matrix-sheet';
import { sameTarget } from '@/lib/products/targets';
import { useGenerateBuyerPrompts } from '@/lib/products/use-generate-buyer-prompts';

import type { CommerceQueries } from './commerce-queries';
import { useActiveWorkspaceId, useWorkspaceCapability } from '@/lib/project/project-context';
import { Notice, readErrorProps } from '@/components/ui/notice';
import { StateBlock } from '@/components/ui/state-block';
import {
  Section,
  SectionContent,
  SectionDescription,
  SectionHeader,
  SectionTitle,
} from '@/components/ui/section';

const HERO_COUNT = 3;

function forTarget(
  rows: NonNullable<CommerceQueries['buyerPrompts']['data']>,
  target: CommerceTarget,
) {
  return rows.filter((row) => sameTarget(row.target, target));
}

export function SetupPrompts({
  projectId,
  target,
  targetLabel,
  query,
  level = 2,
}: Readonly<{
  projectId: string;
  target: CommerceTarget;
  targetLabel: string;
  query: CommerceQueries['buyerPrompts'];
  level?: 2 | 3;
}>) {
  const workspaceId = useActiveWorkspaceId();
  const [text, setText] = useState('');
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchedAuditId, setLaunchedAuditId] = useState<string | null>(null);
  const [shortfall, setShortfall] = useState<number | null>(null);
  const [matrixOpen, setMatrixOpen] = useState(false);
  useRunEvents(launchedAuditId, projectId, Boolean(launchedAuditId));
  const scope = { workspaceId, projectId };
  const { generate: generateFor, mutation: generate } = useGenerateBuyerPrompts(scope);
  const generatePrompts = () =>
    generateFor({ targets: [target], count: HERO_COUNT, hero: true }, (created) =>
      setShortfall(created.length < HERO_COUNT ? created.length : null),
    );
  const manual = useMutation(commerceMutations.addBuyerPrompt(scope));
  const addPrompt = () => manual.mutate({ target, text }, { onSuccess: () => setText('') });
  const decide = useMutation(commerceMutations.decideBuyerPrompt(scope));
  const rows = query.data ? forTarget(query.data, target) : [];
  const approvedIds = rows.reduce<string[]>((ids, row) => {
    if (row.enabled) ids.push(row.id);
    return ids;
  }, []);
  const canRun = useWorkspaceCapability('run');
  const canWrite = useWorkspaceCapability('write');
  const busy = [generate.isPending, manual.isPending, decide.isPending].some(Boolean);
  const failed = [manual.isError, decide.isError].some(Boolean);
  return (
    <Section>
      <SectionHeader
        actions={
          <SetupPromptActions
            kind={target.kind}
            busy={busy}
            loaded={Boolean(query.data)}
            generating={generate.isPending}
            approved={approvedIds.length}
            canRun={canRun}
            onMatrix={() => setMatrixOpen(true)}
            onGenerate={generatePrompts}
            onLaunch={() => setLaunchOpen(true)}
          />
        }
      >
        <SectionTitle level={level}>Prompts that measure it</SectionTitle>
        {approvedIds.length ? null : (
          <SectionDescription>Approve a prompt to launch.</SectionDescription>
        )}
      </SectionHeader>
      <SectionContent>
        <Stack>
          {generate.isError ? (
            <Notice
              kind="mutation"
              notice={mutationNoticeForError(generate.error, { action: 'generate the prompts' })}
            />
          ) : null}
          {failed ? (
            <Notice tone="negative">The buyer-prompt update failed. Please try again.</Notice>
          ) : null}
          {shortfall !== null ? (
            <Notice tone="info">
              {shortfall} of {HERO_COUNT} generated prompts were usable. Generate again for more.
            </Notice>
          ) : null}
          {launchedAuditId ? (
            <Notice tone="info">
              Audit launched. The metrics update when it finishes.{' '}
              <ProjectLink href={`/runs/${launchedAuditId}`}>View the run</ProjectLink>
            </Notice>
          ) : null}
          {target.kind === 'category' ? (
            <CategoryMatrixSheet
              projectId={projectId}
              categoryId={target.id}
              categoryLabel={targetLabel}
              rows={rows}
              open={matrixOpen}
              onOpenChange={setMatrixOpen}
            />
          ) : null}
          {canRun ? (
            <LaunchDialog
              open={launchOpen}
              onOpenChange={setLaunchOpen}
              projectId={projectId}
              fixedPromptIds={approvedIds}
              promptSelectionLabel={`${approvedIds.length} approved prompts for ${targetLabel}`}
              auditScope="commerce"
              onLaunched={(audit) => setLaunchedAuditId(audit.id)}
            />
          ) : null}
          <PromptRows
            query={query}
            rows={rows}
            pending={busy}
            onToggle={canWrite ? (id, approved) => decide.mutate({ id, approved }) : undefined}
          />
          {canWrite ? (
            <ManualPrompt text={text} onText={setText} busy={busy} onAdd={addPrompt} />
          ) : null}
        </Stack>
      </SectionContent>
    </Section>
  );
}

function SetupPromptActions({
  kind,
  busy,
  loaded,
  generating,
  approved,
  canRun,
  onMatrix,
  onGenerate,
  onLaunch,
}: Readonly<{
  kind: CommerceTarget['kind'];
  busy: boolean;
  loaded: boolean;
  generating: boolean;
  approved: number;
  canRun: boolean;
  onMatrix: () => void;
  onGenerate: () => void;
  onLaunch: () => void;
}>) {
  const matrix = (
    <Button variant="secondary" disabled={busy || !loaded} onClick={onMatrix}>
      Shopping prompts matrix
    </Button>
  );
  const generate = canRun ? (
    <Button variant="secondary" disabled={busy} onClick={onGenerate}>
      {generating ? 'Generating…' : `Generate ${HERO_COUNT} for this hero product`}
    </Button>
  ) : null;
  return (
    <>
      {kind === 'category' ? matrix : generate}
      {canRun ? (
        <Button variant="secondary" disabled={!approved || busy} onClick={onLaunch}>
          Review and launch
        </Button>
      ) : null}
    </>
  );
}

function ManualPrompt({
  text,
  onText,
  busy,
  onAdd,
}: Readonly<{ text: string; onText: (text: string) => void; busy: boolean; onAdd: () => void }>) {
  return (
    <Disclosure title="Add a prompt manually">
      <Textarea
        aria-label="Manual buyer prompt"
        value={text}
        onChange={(event) => onText(event.target.value)}
        placeholder="best instant read thermometer for grilling under $50"
      />
      <div>
        <Button variant="secondary" disabled={!text.trim() || busy} onClick={onAdd}>
          Add prompt
        </Button>
      </div>
    </Disclosure>
  );
}

function PromptRows({
  query,
  rows,
  pending,
  onToggle,
}: Readonly<{
  query: CommerceQueries['buyerPrompts'];
  rows: NonNullable<CommerceQueries['buyerPrompts']['data']>;
  pending: boolean;
  onToggle?: (id: string, approved: boolean) => void;
}>) {
  if (query.isError)
    return (
      <Notice
        kind="read"
        {...readErrorProps(query)}
        title="Couldn't load prompts"
        fallback="Buyer prompts could not be loaded."
      />
    );
  if (query.isPending)
    return <StateBlock kind="loading" label="Loading prompts" shape={{ kind: 'list' }} />;
  if (!rows.length) {
    return (
      <StateBlock
        kind="empty"
        icon={MessageSquare}
        heading="No prompts written for this product yet"
        headingLevel={3}
      />
    );
  }
  return (
    <LedgerList>
      {rows.map((row) => (
        <LedgerItem
          key={row.id}
          title={row.text}
          meta={
            onToggle ? (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => onToggle(row.id, !row.enabled)}
              >
                {row.enabled ? 'Disable' : 'Approve'}
              </Button>
            ) : (
              <Tag>{row.enabled ? 'Approved' : 'Not approved'}</Tag>
            )
          }
        />
      ))}
    </LedgerList>
  );
}

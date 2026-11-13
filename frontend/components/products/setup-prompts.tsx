import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/ui/callout';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { QueryState } from '@/components/ui/query-state';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Inline, Stack } from '@/components/ui/layout';
import { MutationNotice } from '@/components/ui/mutation-notice';
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
import { ledgerClasses, ledgerItemClasses } from '@/components/ui/workspace';
import { useActiveWorkspaceId, useWorkspaceCapability } from '@/lib/project/project-context';

// Per hero product; the API defaults the count, and a category generates its matrix.
const HERO_COUNT = 3;

function forTarget(
  rows: NonNullable<CommerceQueries['buyerPrompts']['data']>,
  target: CommerceTarget,
) {
  return rows.filter((row) => sameTarget(row.target, target));
}

/**
 * The buyer prompts that measure one catalog product (hero-product prompts)
 * or category (its shopping-prompt matrix), on its page's Setup: generate,
 * approve, add manually, and review and launch an audit.
 */
export function SetupPrompts({
  projectId,
  target,
  targetLabel,
  query,
}: Readonly<{
  projectId: string;
  target: CommerceTarget;
  targetLabel: string;
  query: CommerceQueries['buyerPrompts'];
}>) {
  const workspaceId = useActiveWorkspaceId();
  const [text, setText] = useState('');
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchedAuditId, setLaunchedAuditId] = useState<string | null>(null);
  const [shortfall, setShortfall] = useState<number | null>(null);
  const [matrixOpen, setMatrixOpen] = useState(false);
  // The audit stream refreshes the product metrics and Actions when the run finishes.
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
  // Generating and launching are runs; approving and adding are writes. A role
  // without either reads the prompts and their state only.
  const canRun = useWorkspaceCapability('run');
  const canWrite = useWorkspaceCapability('write');
  const busy = [generate.isPending, manual.isPending, decide.isPending].some(Boolean);
  const failed = [manual.isError, decide.isError].some(Boolean);
  return (
    <Card>
      <CardHeader
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
        <CardTitle>Prompts that measure it</CardTitle>
        <CardDescription>
          {approvedIds.length
            ? 'Generated prompts stay disabled until you approve them.'
            : `Approve at least one prompt to launch an audit for this ${target.kind}.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Stack>
          {generate.isError ? (
            <MutationNotice
              notice={mutationNoticeForError(generate.error, { action: 'generate the prompts' })}
            />
          ) : null}
          {failed ? (
            <Callout tone="negative">The buyer-prompt update failed. Please try again.</Callout>
          ) : null}
          {shortfall !== null ? (
            <Callout tone="info">
              {shortfall} of {HERO_COUNT} generated prompts were usable. Generate again for more.
            </Callout>
          ) : null}
          {launchedAuditId ? (
            <Callout tone="info">
              Audit launched. The metrics update when it finishes.{' '}
              <ProjectLink href={`/runs/${launchedAuditId}`}>View the run</ProjectLink>
            </Callout>
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
          {/* Manual entry is the fallback for an unconfigured model, so it is
            folded away rather than given equal billing beside Generate. */}
          {canWrite ? (
            <ManualPrompt text={text} onText={setText} busy={busy} onAdd={addPrompt} />
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

/**
 * The card's actions: a category's matrix (open to every role, since it reads),
 * or a hero product's Generate; then Review and launch. Generating and
 * launching are runs, offered only to a role that may run.
 */
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
  /** Whether the prompts have loaded; the matrix reads loaded prompts only. */
  loaded: boolean;
  generating: boolean;
  /** How many prompts are approved; launching needs one. */
  approved: number;
  canRun: boolean;
  onMatrix: () => void;
  onGenerate: () => void;
  onLaunch: () => void;
}>) {
  // The list below owns the loading and error states.
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
        <Button variant="primary" disabled={!approved || busy} onClick={onLaunch}>
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
        <Button variant="primary" disabled={!text.trim() || busy} onClick={onAdd}>
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
  /** Approves or disables a prompt; omitted for a role that may not, which reads the state. */
  onToggle?: (id: string, approved: boolean) => void;
}>) {
  if (query.isError)
    return <ReadError {...readErrorProps(query)} fallback="Buyer prompts could not be loaded." />;
  if (query.isPending) return <QueryState kind="loading" />;
  if (!rows.length) {
    return (
      <QueryState
        kind="empty"
        icon={MessageSquare}
        heading="No prompts yet"
        description={onToggle ? 'Generate a set, or add one manually.' : undefined}
        headingLevel={3}
      />
    );
  }
  return (
    <ul className={ledgerClasses()}>
      {rows.map((row) => (
        <Inline as="li" key={row.id} gap="compact" className={ledgerItemClasses('flex-wrap')}>
          <span className="text-ink-secondary min-w-0 flex-1">{row.text}</span>
          {onToggle ? (
            <Button
              variant={row.enabled ? 'secondary' : 'primary'}
              disabled={pending}
              onClick={() => onToggle(row.id, !row.enabled)}
            >
              {row.enabled ? 'Disable' : 'Approve'}
            </Button>
          ) : (
            <Badge>{row.enabled ? 'Approved' : 'Not approved'}</Badge>
          )}
        </Inline>
      ))}
    </ul>
  );
}

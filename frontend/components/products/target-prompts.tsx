'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { ReadError, readErrorProps } from '@/components/ui/read-error';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { commerceApi } from '@/lib/api/commerce';
import { queryKeys } from '@/lib/api/query-keys';
import type { CommerceTarget } from '@citeladder/contracts/commerce-suite';
import { LaunchDialog } from '@/components/runs/launch-dialog';
import { ProjectLink } from '@/components/layout/scoped-link';
import { useRunEvents } from '@/lib/runs/use-run-events';
import { sameTarget } from '@/lib/products/use-commerce-target';

import type { CommerceQueries } from './commerce-queries';
import { ledgerClasses } from '@/components/ui/workspace';
import { useActiveWorkspaceId } from '@/lib/project/project-context';

const GENERATED_COUNT = 5;

function forTarget(
  rows: NonNullable<CommerceQueries['buyerPrompts']['data']>,
  target: CommerceTarget,
) {
  return rows.filter((row) => sameTarget(row.target, target));
}

export function TargetPrompts({
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
  const client = useQueryClient();
  const workspaceId = useActiveWorkspaceId();
  const [text, setText] = useState('');
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchedAuditId, setLaunchedAuditId] = useState<string | null>(null);
  const [shortfall, setShortfall] = useState<number | null>(null);
  // The audit stream refreshes AI Shelf and Actions here when the run finishes.
  useRunEvents(launchedAuditId, projectId, Boolean(launchedAuditId));
  const refresh = () =>
    client.invalidateQueries({ queryKey: queryKeys.commerce.buyerPrompts(projectId) });
  const generate = useMutation({
    mutationFn: () =>
      commerceApi.generateBuyerPrompts(projectId, [target], GENERATED_COUNT, { workspaceId }),
    onSuccess: async (created) => {
      setShortfall(created.length < GENERATED_COUNT ? created.length : null);
      await refresh();
    },
  });
  const manual = useMutation({
    mutationFn: () => commerceApi.addBuyerPrompt(projectId, target, text, { workspaceId }),
    onSuccess: async () => {
      setText('');
      await refresh();
    },
  });
  const decide = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) =>
      commerceApi.decideBuyerPrompt(projectId, id, approved, { workspaceId }),
    onSuccess: refresh,
  });
  const rows = query.data ? forTarget(query.data, target) : [];
  const approvedIds = rows.reduce<string[]>((ids, row) => {
    if (row.enabled) ids.push(row.id);
    return ids;
  }, []);
  const busy = [generate.isPending, manual.isPending, decide.isPending].some(Boolean);
  const failed = [generate.isError, manual.isError, decide.isError].some(Boolean);
  return (
    <Card>
      <CardHeader
        actions={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => generate.mutate()}>
              {generate.isPending ? 'Generating…' : `Generate ${GENERATED_COUNT}`}
            </Button>
            <Button disabled={!approvedIds.length || busy} onClick={() => setLaunchOpen(true)}>
              Review and launch
            </Button>
          </>
        }
      >
        <CardTitle>Prompts that measure it</CardTitle>
        <CardDescription>
          {approvedIds.length
            ? 'Generated prompts stay disabled until you approve them.'
            : 'Approve at least one prompt to launch an audit for this target.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {failed ? (
          <Alert tone="danger">The buyer-prompt update failed. Please try again.</Alert>
        ) : null}
        {shortfall !== null ? (
          <Alert tone="info">
            {shortfall} of {GENERATED_COUNT} generated prompts were usable. Generate again for more.
          </Alert>
        ) : null}
        {launchedAuditId ? (
          <Alert tone="info">
            Audit launched. Shelf metrics update here when it finishes.{' '}
            <ProjectLink href={`/runs/${launchedAuditId}`}>View the run</ProjectLink>
          </Alert>
        ) : null}
        <LaunchDialog
          open={launchOpen}
          onOpenChange={setLaunchOpen}
          projectId={projectId}
          fixedPromptIds={approvedIds}
          promptSelectionLabel={`${approvedIds.length} approved prompts for ${targetLabel}`}
          auditScope="commerce"
          onLaunched={(audit) => setLaunchedAuditId(audit.id)}
        />
        <PromptRows
          query={query}
          rows={rows}
          pending={busy}
          onToggle={(id, approved) => decide.mutate({ id, approved })}
        />
        {/* Manual entry is the fallback for an unconfigured model, so it is
            folded away rather than given equal billing beside Generate. */}
        <Disclosure title="Add a prompt manually">
          <Textarea
            aria-label="Manual buyer prompt"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="best instant read thermometer for grilling under $50"
          />
          <div>
            <Button size="sm" disabled={!text.trim() || busy} onClick={() => manual.mutate()}>
              Add prompt
            </Button>
          </div>
        </Disclosure>
      </CardContent>
    </Card>
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
  onToggle: (id: string, approved: boolean) => void;
}>) {
  if (query.isError)
    return <ReadError {...readErrorProps(query)} fallback="Buyer prompts could not be loaded." />;
  if (query.isPending) return <Skeleton className="h-24 w-full" />;
  if (!rows.length) {
    // Left-hung and compactly padded, matching the shared empty-state shape.
    // Centring one sentence inside full card padding made an absent list look
    // like a large deliberate panel.
    return (
      <EmptyState
        variant="compact"
        icon={MessageSquare}
        heading="No prompts yet for this target"
        description="Generate a set, or add one manually."
        headingLevel={3}
      />
    );
  }
  return (
    <ul className={ledgerClasses()}>
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center gap-3 py-2">
          <span className="text-secondary min-w-0 flex-1">{row.text}</span>
          <Button
            size="sm"
            variant={row.enabled ? 'secondary' : 'primary'}
            disabled={pending}
            onClick={() => onToggle(row.id, !row.enabled)}
          >
            {row.enabled ? 'Disable' : 'Approve'}
          </Button>
        </li>
      ))}
    </ul>
  );
}

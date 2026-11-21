import type { AccuracyClaim, AccuracyClaimPage } from '@citeladder/contracts/fact-checking';
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { useState } from 'react';

import { VerdictChip } from '@/components/runs/evidence-claims';
import { VerdictDialog } from '@/components/perception/verdict-dialog';
import { Absence } from '@/components/ui/absence';
import { Button, buttonClasses } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Icon } from '@/components/ui/icon';
import type { DataTableColumn } from '@/components/ui/data-table-columns';
import { Inline } from '@/components/ui/layout';
import { ProjectLink } from '@/components/ui/project-link';
import { TableCell, TableRow } from '@/components/ui/table';
import { Tag } from '@/components/ui/tag';
import { Tooltip } from '@/components/ui/tooltip';
import { PenLine } from '@/lib/icons';
import { agentHandoffHref } from '@/lib/agent/handoff';
import { useEngineCatalog } from '@/lib/providers/engines';
import { claimAgentPrompt, VERDICT_LABELS } from '@/lib/visibility/accuracy';
import type { useFactViews } from '@/lib/visibility/use-accuracy';

type Views = ReturnType<typeof useFactViews>;
type Query = UseInfiniteQueryResult<InfiniteData<AccuracyClaimPage>>;

const COLUMNS = [
  { key: 'claim', label: 'Claim', kind: 'identity' },
  { key: 'engine', label: 'Engine', width: 'metric' },
  { key: 'fact', label: 'Checked against' },
  { key: 'verdict', label: 'Verdict', width: 'category' },
  { key: 'actions', label: 'Actions', kind: 'actions' },
] as const satisfies readonly DataTableColumn[];

export function ClaimsTable({ views }: Readonly<{ views: Pick<Views, 'claims' | 'override'> }>) {
  const { claims: query, override } = views;
  const [editing, setEditing] = useState<AccuracyClaim | null>(null);
  const claims = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      <DataTable
        label="All claims"
        columns={COLUMNS}
        rowCount={claims.length}
        state={tableState(query, claims)}
        footer={
          query.hasNextPage ? (
            <Button
              variant="secondary"
              pending={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              Show more claims
            </Button>
          ) : undefined
        }
      >
        {claims.map((claim) => (
          <ClaimRow
            key={`${claim.execution_id}:${claim.claim}:${claim.quote}`}
            claim={claim}
            onChange={() => {
              override.reset();
              setEditing(claim);
            }}
          />
        ))}
      </DataTable>
      {editing ? (
        <VerdictDialog claim={editing} override={override} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function tableState(query: Query, claims: readonly AccuracyClaim[]) {
  if (query.isPending) return { kind: 'loading', label: 'Loading claims' } as const;
  if (query.isError)
    return {
      kind: 'error',
      error: query.error,
      title: "Couldn't load the claims",
      fallback: 'The claims could not be loaded.',
      onRetry: () => void query.refetch(),
      pending: query.isFetching,
    } as const;
  if (!claims.length)
    return { kind: 'empty', inline: true, message: 'No claims in these answers.' } as const;
  return undefined;
}

function ClaimRow({ claim, onChange }: Readonly<{ claim: AccuracyClaim; onChange: () => void }>) {
  const { label: engineLabel } = useEngineCatalog();
  const engine = engineLabel(claim.logical_engine);
  const facts = claim.facts.map((fact) => fact.statement).join('; ');
  return (
    <TableRow>
      <TableCell>
        <span className="block min-w-0 truncate" title={claim.claim}>
          {claim.claim}
        </span>
      </TableCell>
      <TableCell>{engine}</TableCell>
      <TableCell>
        {facts ? (
          <span className="text-ink-2 block min-w-0 truncate" title={facts}>
            {facts}
          </span>
        ) : (
          <Absence label="No fact on this point" />
        )}
      </TableCell>
      <TableCell>
        <Inline gap="tight" className="flex-nowrap">
          <VerdictChip claim={claim} />
          {claim.edited ? (
            <Tooltip content={`Model said ${VERDICT_LABELS[claim.edited.model_verdict]}`}>
              <span className="inline-flex">
                <Tag>Edited</Tag>
              </span>
            </Tooltip>
          ) : null}
        </Inline>
      </TableCell>
      <TableCell>
        <Inline className="flex-nowrap justify-end">
          {claim.verdict_id ? (
            <Button variant="quiet" onClick={onChange}>
              <Icon icon={PenLine} />
              Change verdict
            </Button>
          ) : null}
          <ProjectLink
            href={agentHandoffHref({ prompt: claimAgentPrompt(claim, engine) })}
            className={buttonClasses('quiet')}
          >
            Ask Agent
          </ProjectLink>
        </Inline>
      </TableCell>
    </TableRow>
  );
}

'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { BrandLogo } from '@/components/ui/brand-logo';
import { Button } from '@/components/ui/button';
import {
  ExecutionEvidenceDrawer,
  type EvidenceSubject,
} from '@/components/runs/execution-evidence-drawer';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { Inline } from '@/components/ui/layout';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { textRole } from '@/components/ui/typography';
import { MissingValue } from '@/components/ui/unavailable-value';
import { TruncationNotice } from '@/components/visibility/evidence-states';
import { queryKeys } from '@/lib/api/query-keys';
import type { VisibilityEvidenceResponse, VisibilityExecutionEvidence } from '@/lib/api/types';
import { visibilityApi } from '@/lib/api/visibility';
import { engineLabel, productModelLabel } from '@/lib/providers/catalog';
import type { SourceFilters } from '@/components/visibility/source-rows';
import { count, hostOf, sinceLabel } from '@/lib/visibility/sources';
import { selectionHasNoRun, type SourceQueries } from '@/lib/visibility/use-source-analysis';
import { EVIDENCE_LIMIT } from '@/lib/visibility/use-visibility-dashboard';

/** A counted nought in a column of chips, kept apart from an absent one. */
function ObservedNone() {
  return <span className={textRole('caption', 'text-secondary tabular-nums')}>0</span>;
}

/** Chips a cell carries before it stops being a cell; the rest become "+N". */
const MAX_CHIPS = 3;

/**
 * The tracked answers that used this source, one row each.
 *
 * A TABLE, not an evidence feed. A reader on a domain's page is scanning for
 * which prompts reached it and how heavily — a question answered by rows they
 * can compare down a column. The full answer text, its mentions and its
 * citation list belong to the answer itself, which is one click away on Query
 * fanouts; reproducing them here made every row tall enough that comparing two
 * meant scrolling between them.
 *
 * Reads `/visibility/evidence` narrowed by domain or URL rather than adding a
 * third place that assembles an answer list.
 */
export function SourcePrompts({
  filters,
  queries,
  domain,
  url,
}: Readonly<{
  filters: SourceFilters;
  queries: SourceQueries;
  domain?: string | null;
  url?: string | null;
}>) {
  const params = {
    audit_id: queries.selectedRunIds ? undefined : (queries.activeRunId ?? undefined),
    audit_ids: queries.selectedRunIds,
    engine: filters.engine === 'all' ? undefined : filters.engine,
    cohort: filters.cohort,
    domain: domain ?? undefined,
    url: url ?? undefined,
  };
  const query = useQuery({
    queryKey: queryKeys.visibility.evidence(queries.projectId ?? '', params),
    queryFn: ({ signal }) =>
      visibilityApi.getVisibilityEvidence(queries.projectId!, params, {
        signal,
        workspaceId: queries.workspaceId,
      }),
    enabled: Boolean(queries.projectId && queries.activeRunId && (domain || url)),
  });

  // The answer opens over this screen rather than routing to the run that
  // produced it. A reader here is comparing which prompts reached this source;
  // being dropped on Query fanouts with the source selection gone meant the
  // only way back to the comparison was the browser's back button.
  const [opened, setOpened] = useState<EvidenceSubject | null>(null);

  return (
    <>
      <DataTable
        title="Prompts"
        columns={COLUMNS}
        state={promptsState(query, selectionHasNoRun(queries))}
        busy={{ active: query.isFetching, label: 'Updating prompts' }}
        // The endpoint returns a bounded newest-first window. Without this a
        // source cited by more answers than fit simply looked like it had fewer.
        footer={query.data?.truncated ? <TruncationNotice limit={EVIDENCE_LIMIT} /> : null}
      >
        {(query.data?.items ?? []).map((item) => (
          <PromptRow key={item.analysis_id} item={item} onOpenAnswer={setOpened} />
        ))}
      </DataTable>
      <ExecutionEvidenceDrawer
        execution={opened}
        open={opened !== null}
        onOpenChange={(next) => {
          if (!next) setOpened(null);
        }}
      />
    </>
  );
}

const COLUMNS: readonly DataTableColumn[] = [
  { key: 'prompt', label: 'Prompt' },
  { key: 'citations', label: 'Citations', width: 'figure', numeric: true },
  { key: 'mentioned', label: 'Mentioned', width: 'status', desktopOnly: true },
  { key: 'sources', label: 'Sources', width: 'status', desktopOnly: true },
  { key: 'created', label: 'Created', width: 'figure', numeric: true, desktopOnly: true },
  { key: 'open', label: 'Open', width: 'status', hideLabel: true },
];

function promptsState(
  query: UseQueryResult<VisibilityEvidenceResponse, unknown>,
  noRun: boolean,
): DataTableState | undefined {
  if (query.isError) {
    return {
      kind: 'error',
      error: query.error,
      fallback: 'Could not load the tracked answers.',
      onRetry: () => void query.refetch(),
      pending: query.isFetching,
    };
  }
  // No data yet is a read waiting on its run, never an empty finding.
  if (!query.data) {
    return noRun
      ? { kind: 'empty', headingLevel: 3, icon: MessageSquare, heading: 'No run selected' }
      : { kind: 'loading', label: 'Loading prompts…' };
  }
  if (query.data.items.length) return undefined;
  return {
    kind: 'empty',
    headingLevel: 3,
    icon: MessageSquare,
    heading: 'No tracked answers in this selection used this source',
  };
}

/**
 * One answer as a row: which engine produced it, what it said, what it cited.
 *
 * The engine's mark leads the row rather than sitting in a column of its own —
 * it is an identity, and a reader scanning for "what did Gemini say" finds a
 * logo faster than a word.
 */
function PromptRow({
  item,
  onOpenAnswer,
}: Readonly<{
  item: VisibilityExecutionEvidence;
  onOpenAnswer: (subject: EvidenceSubject) => void;
}>) {
  return (
    <TableRow>
      <TableCell>
        <Inline as="span" className="items-start">
          <BrandLogo name={engineLabel(item.logical_engine) || item.logical_engine} />
          <span className="grid min-w-0">
            <ClampText lines={1}>{item.prompt_text || 'Untitled prompt'}</ClampText>
            <ClampText lines={1} className={textRole('caption', 'text-secondary')}>
              {productModelLabel(item.logical_engine, item.transport_model) ||
                engineLabel(item.logical_engine) ||
                item.logical_engine}
            </ClampText>
          </span>
        </Inline>
      </TableCell>
      <TableCell numeric>{count(item.citations.length) ?? '0'}</TableCell>
      <TableCell desktopOnly>
        <MentionChips item={item} />
      </TableCell>
      <TableCell desktopOnly>
        <SourceChips item={item} />
      </TableCell>
      <TableCell numeric desktopOnly>
        {sinceLabel(item.completed_at) ?? <MissingValue />}
      </TableCell>
      <TableCell>
        {/* The row summarises the answer; this reaches the answer itself. It
            is the one thing the old evidence feed carried that a compact row
            cannot replace with a number. */}
        <Button
          variant="ghost"
          onClick={() =>
            onOpenAnswer({
              // The visibility row names the execution as `task_id`; the drawer
              // fetches the rest of the evidence from it, and the answer text
              // from the audit that owns it — a source row summarises an answer
              // without carrying one.
              id: item.task_id,
              audit_id: item.audit_id,
              prompt_text: item.prompt_text,
              prompt_index: item.prompt_index,
              logical_engine: item.logical_engine,
            })
          }
        >
          Open answer
        </Button>
      </TableCell>
    </TableRow>
  );
}

/**
 * The brands this answer named, as marks.
 *
 * An empty list is an OBSERVED zero, not an absent measurement: the answer was
 * read and it named nobody. `MissingValue` would report that as "not measured",
 * which is the opposite finding -- so the cell says nought and means it.
 */
function MentionChips({ item }: Readonly<{ item: VisibilityExecutionEvidence }>) {
  const named = [...new Map(item.mentions.map((one) => [one.name, one])).values()];
  if (!named.length) return <ObservedNone />;
  return (
    <ChipRow overflow={named.length - MAX_CHIPS}>
      {named.slice(0, MAX_CHIPS).map((mention) => (
        <Tooltip key={`${mention.kind}:${mention.name}`} content={mention.name}>
          <span className="inline-flex">
            <BrandLogo name={mention.name || 'Brand'} placement="mark" />
          </span>
        </Tooltip>
      ))}
    </ChipRow>
  );
}

/** The sites this answer drew on, as their favicons. An empty list is zero. */
function SourceChips({ item }: Readonly<{ item: VisibilityExecutionEvidence }>) {
  const hosts = [
    ...new Set(item.citations.map((citation) => hostOf(citation.url)).filter(Boolean)),
  ] as string[];
  if (!hosts.length) return <ObservedNone />;
  return (
    <ChipRow overflow={hosts.length - MAX_CHIPS}>
      {hosts.slice(0, MAX_CHIPS).map((host) => (
        <Tooltip key={host} content={host}>
          <span className="inline-flex">
            <BrandLogo name={host} websiteUrl={`https://${host}`} placement="mark" />
          </span>
        </Tooltip>
      ))}
    </ChipRow>
  );
}

function ChipRow({ children, overflow }: Readonly<{ children: ReactNode; overflow: number }>) {
  return (
    <Inline as="span" gap="tight">
      {children}
      {overflow > 0 ? (
        <span className={textRole('caption', 'text-secondary tabular-nums')}>+{overflow}</span>
      ) : null}
    </Inline>
  );
}

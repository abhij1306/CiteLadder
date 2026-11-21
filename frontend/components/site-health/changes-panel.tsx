import { useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { StatusMark, type StatusTone } from '@/components/ui/status-mark';
import { ActionButton } from '@/components/ui/actions';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { Inline, Stack } from '@/components/ui/layout';
import { TableCell, TableRow, UrlText } from '@/components/ui/table';
import { GitCompare } from '@/lib/icons';
import { readableUrl, sharedOrigin } from '@/lib/format';
import { TextLink } from '@/components/ui/text-link';
import { siteHealthQueries } from '@/lib/api/site-health-queries';
import type { ChangeObservation, ChangeSummary } from '@citeladder/contracts';
import { useCursorTableQuery } from '@/lib/table/use-cursor-table-query';
import { changeFieldLabel } from '@/lib/site-health/change-fields';
import { ChangeEvidenceDrawer } from './changes-panel-evidence';
import { readErrorProps } from '@/components/ui/notice';
import { READ_FAILED, StateBlock } from '@/components/ui/state-block';
import { FigureStrip } from '@/components/ui/figure-strip';

const CLASS_LABELS = {
  improvement: 'Improvement',
  'neutral-change': 'Neutral change',
  'potential-regression': 'Potential regression',
  'critical-regression': 'Critical regression',
} as const;

const CLASS_TONES: Readonly<Record<keyof typeof CLASS_LABELS, StatusTone>> = {
  improvement: 'positive',
  'neutral-change': 'neutral',
  'potential-regression': 'warning',
  'critical-regression': 'negative',
};

function comparedPair(data: ChangeSummary | undefined) {
  const crawlAId = data?.crawl_a_id ?? undefined;
  const crawlBId = data?.crawl_b_id ?? undefined;
  return {
    crawlAId,
    crawlBId,
    pairAvailable: data?.state === 'available' && Boolean(crawlAId && crawlBId),
  };
}

export function ChangesPanel({
  workspaceId,
  projectId,
}: Readonly<{ workspaceId: string; projectId: string }>) {
  const scope = { workspaceId, projectId };
  const summary = useQuery(siteHealthQueries.changesSummary(scope));
  const [selected, setSelected] = useState<ChangeObservation | undefined>(undefined);
  const { crawlAId, crawlBId, pairAvailable } = comparedPair(summary.data);
  const { page, table } = useCursorTableQuery({
    workspaceId,
    // Rows carry over only within the same compared pair: a row of another
    // pair would link to the wrong crawl's page.
    scopeId: [projectId, crawlAId ?? 'unselected-a', crawlBId ?? 'unselected-b'],
    scope: null,
    query: (request) => siteHealthQueries.changes(scope, { crawlAId, crawlBId, ...request }),
    noun: 'changes',
    loading: 'Loading persisted website changes…',
    subject: 'the website changes',
    empty: () => ({
      kind: 'empty',
      icon: GitCompare,
      headingLevel: 3,
      heading: 'No tracked fields changed between your last two crawls',
    }),
    enabled: pairAvailable,
  });
  const counts =
    summary.data?.state === 'available'
      ? (summary.data.summary.counts_by_class as Record<string, number> | undefined)
      : undefined;
  const summaryState = comparisonState(summary, pairAvailable);
  const origin = sharedOrigin(page?.items.map((row) => row.normalized_url) ?? []);
  return (
    <Stack gap="workspace" className="min-w-0" data-testid="website-changes">
      {summary.isPending ? (
        <StateBlock
          kind="loading"
          label="Loading the change counts…"
          shape={{ kind: 'figures', count: 4 }}
        />
      ) : null}
      {counts ? (
        <FigureStrip
          label="Tracked field changes since the previous crawl"
          segments={Object.entries(CLASS_LABELS).map(([key, label]) => ({
            key,
            label,
            value: counts[key] ?? 0,
          }))}
        />
      ) : null}
      <DataTable
        label="Website changes"
        columns={CHANGE_COLUMNS}
        {...table}
        state={summaryState ?? table.state}
        pager={summaryState ? undefined : table.pager}
      >
        {page?.items.map((row) => (
          <ChangeRow
            key={row.id}
            row={row}
            origin={origin}
            crawlBId={summary.data?.crawl_b_id ?? null}
            onOpen={() => setSelected(row)}
          />
        ))}
      </DataTable>
      <ChangeEvidenceDrawer
        row={selected}
        crawlAId={summary.data?.crawl_a_id ?? null}
        crawlBId={summary.data?.crawl_b_id ?? null}
        onClose={() => setSelected(undefined)}
      />
    </Stack>
  );
}

function ChangeRow({
  row,
  origin,
  crawlBId,
  onOpen,
}: Readonly<{
  row: ChangeObservation;
  origin: string | null;
  crawlBId: string | null;
  onOpen: () => void;
}>) {
  const field = changeFieldLabel(row.field);
  const url = readableUrl(row.normalized_url);
  return (
    <TableRow>
      <TableCell>
        <TextLink
          text="emphasis"
          underline="hover"
          className="flex min-w-0"
          href={`/site/crawls/${crawlBId}/pages/${row.site_url_id}`}
          aria-label={url}
        >
          <UrlText url={row.normalized_url} origin={origin} />
        </TextLink>
      </TableCell>
      <TableCell>{field}</TableCell>
      <TableCell>
        <Inline className="whitespace-nowrap">
          <StatusMark tone={CLASS_TONES[row.change_class]}>
            {CLASS_LABELS[row.change_class]}
          </StatusMark>
          {row.expected ? <span className="type-caption">Expected</span> : null}
        </Inline>
      </TableCell>
      <TableCell>
        <ActionButton
          action="viewEvidence"
          onClick={onOpen}
          aria-label={`View evidence: ${field} on ${url}`}
        />
      </TableCell>
    </TableRow>
  );
}

function comparisonState(
  summary: UseQueryResult<ChangeSummary>,
  pairAvailable: boolean,
): DataTableState | undefined {
  if (summary.isPending) return { kind: 'loading', label: 'Loading persisted website changes…' };
  if (summary.isError)
    return {
      kind: 'error',
      ...readErrorProps(summary),
      fallback: READ_FAILED,
      title: "Couldn't load the website changes",
    };
  if (summary.data.state === 'unavailable')
    return {
      kind: 'empty',
      icon: GitCompare,
      headingLevel: 3,
      heading: 'Changes need two completed crawls',
    };
  if (summary.data.state === 'non_comparable')
    return {
      kind: 'empty',
      icon: GitCompare,
      headingLevel: 3,
      heading: 'These crawls are not comparable',
      description: `Reason: ${summary.data.reason_code?.replaceAll('_', ' ') ?? 'unknown'}.`,
    };
  if (!pairAvailable)
    return {
      kind: 'empty',
      icon: GitCompare,
      headingLevel: 3,
      heading: 'This comparison is no longer available',
      description: 'Run a new crawl to compare again.',
    };
  return undefined;
}

const CHANGE_COLUMNS: readonly DataTableColumn[] = [
  { key: 'page', label: 'Page', kind: 'identity' },
  { key: 'field', label: 'Field', kind: 'text', width: 'category', priority: 'low' },
  { key: 'class', label: 'Class', kind: 'text', width: 'name' },
  { key: 'evidence', label: 'Evidence', kind: 'text', width: 'category' },
];

import { useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { GitCompare } from 'lucide-react';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { Inline, Stack } from '@/components/ui/layout';
import { readErrorProps } from '@/components/ui/read-error';
import { StatRow } from '@/components/ui/stat-row';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { siteHealthQueries } from '@/lib/api/site-health-queries';
import type { ChangeObservation, ChangeSummary } from '@citeladder/contracts';
import { useCursorTableQuery } from '@/lib/table/use-cursor-table-query';
import { changeFieldLabel } from '@/lib/site-health/change-fields';
import { ChangeEvidenceDrawer } from './changes-panel-evidence';

const CLASS_LABELS = {
  improvement: 'Improvement',
  'neutral-change': 'Neutral change',
  'potential-regression': 'Potential regression',
  'critical-regression': 'Critical regression',
} as const;

/** A change class is a delta, so it carries the delta's direction. */
const CLASS_TONES: Readonly<Record<keyof typeof CLASS_LABELS, BadgeTone>> = {
  improvement: 'positive',
  'neutral-change': 'neutral',
  'potential-regression': 'warning',
  'critical-regression': 'negative',
};

function displayPath(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export function ChangesPanel({
  workspaceId,
  projectId,
}: Readonly<{ workspaceId: string; projectId: string }>) {
  const scope = { workspaceId, projectId };
  const summary = useQuery(siteHealthQueries.changesSummary(scope));
  const [selected, setSelected] = useState<ChangeObservation | undefined>(undefined);
  const crawlAId = summary.data?.crawl_a_id ?? undefined;
  const crawlBId = summary.data?.crawl_b_id ?? undefined;
  const pairAvailable = summary.data?.state === 'available' && Boolean(crawlAId && crawlBId);
  // A page turn keeps the rows and the pager on screen until the next changes
  // land. The compared pair is part of the cursor's identity server-side, so
  // a new pair restarts paging rather than replaying a refused cursor. No
  // exact total: no persisted count describes one pair's change set, so the
  // range stands alone rather than paying for a COUNT(*) per navigation.
  const { page, table } = useCursorTableQuery({
    workspaceId,
    // Rows carry over only within the same compared pair: a row of another
    // pair would link to the wrong crawl's page.
    scopeId: [projectId, crawlAId ?? 'unselected-a', crawlBId ?? 'unselected-b'],
    scope: null,
    query: (request) => siteHealthQueries.changes(scope, { crawlAId, crawlBId, ...request }),
    noun: 'changes',
    loading: 'Loading persisted website changes…',
    error: 'Could not load Website Changes.',
    empty: () => ({
      kind: 'empty',
      icon: GitCompare,
      headingLevel: 3,
      heading: 'No changes were observed in this comparable pair',
    }),
    enabled: pairAvailable,
  });
  const counts =
    summary.data?.state === 'available'
      ? (summary.data.summary.counts_by_class as Record<string, number> | undefined)
      : undefined;
  // Until the summary says which pair to compare, and whenever no pair can
  // be compared, that answer stands in the table's place at its full height.
  const summaryState = comparisonState(summary, pairAvailable);
  return (
    <Stack gap="workspace" className="min-w-0" data-testid="website-changes">
      <Card>
        <CardHeader>
          <CardTitle>Since the previous crawl</CardTitle>
          <CardDescription>
            What changed on your pages between your last two crawls. Expected means the change
            matches an implementation you declared.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StatRow
            segments={Object.entries(CLASS_LABELS).map(([key, label]) => ({
              key,
              label,
              value: counts ? (counts[key] ?? 0) : null,
            }))}
          />
        </CardContent>
      </Card>
      <DataTable
        label="Website changes"
        columns={CHANGE_COLUMNS}
        minWidth="md"
        {...table}
        state={summaryState ?? table.state}
        pager={summaryState ? undefined : table.pager}
      >
        {page?.items.map((row) => (
          <ChangeRow
            key={row.id}
            row={row}
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
  crawlBId,
  onOpen,
}: Readonly<{ row: ChangeObservation; crawlBId: string | null; onOpen: () => void }>) {
  const field = changeFieldLabel(row.field);
  return (
    <TableRow>
      <TableCell>
        <TextLink text="emphasis" href={`/site/crawls/${crawlBId}/pages/${row.site_url_id}`}>
          <ClampText>{displayPath(row.normalized_url)}</ClampText>
        </TextLink>
      </TableCell>
      <TableCell>{field}</TableCell>
      <TableCell>
        <Inline className="whitespace-nowrap">
          <Badge tone={CLASS_TONES[row.change_class]}>{CLASS_LABELS[row.change_class]}</Badge>
          {row.expected ? <span className="type-caption">Expected</span> : null}
        </Inline>
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          onClick={onOpen}
          aria-label={`View evidence: ${field} on ${displayPath(row.normalized_url)}`}
        >
          View evidence
        </Button>
      </TableCell>
    </TableRow>
  );
}

/** What the table shows while the summary decides, or cannot name, a comparable pair. */
function comparisonState(
  summary: UseQueryResult<ChangeSummary>,
  pairAvailable: boolean,
): DataTableState | undefined {
  if (summary.isPending) return { kind: 'loading', label: 'Loading persisted website changes…' };
  if (summary.isError)
    return {
      kind: 'error',
      ...readErrorProps(summary),
      fallback: 'Could not load Website Changes.',
    };
  if (summary.data.state === 'unavailable')
    return {
      kind: 'empty',
      icon: GitCompare,
      headingLevel: 3,
      heading: 'Website Changes need two usable crawls with persisted page evidence',
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

// Page is the one flexible column; the evidence is a button at the row's end.
const CHANGE_COLUMNS: readonly DataTableColumn[] = [
  { key: 'page', label: 'Page' },
  { key: 'field', label: 'Field', width: 'name' },
  { key: 'class', label: 'Class', width: 'name' },
  { key: 'evidence', label: 'Evidence', width: 'category' },
];

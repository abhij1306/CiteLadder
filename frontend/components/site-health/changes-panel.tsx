'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { GitCompare } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn, type DataTableState } from '@/components/ui/data-table';
import { Inline, Stack } from '@/components/ui/layout';
import { readErrorProps } from '@/components/ui/read-error';
import { StatRow } from '@/components/ui/stat-row';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { treeBranchClasses } from '@/components/ui/workspace';
import { siteHealthQueries } from '@/lib/api/site-health';
import type { ChangeObservation, ChangeSummary } from '@citeladder/contracts';
import { useCursorTableQuery } from '@/lib/table/use-cursor-table-query';
import { textRole } from '@/components/ui/typography';
import {
  CHANGE_EVIDENCE_DEPTH_LIMIT,
  CHANGE_EVIDENCE_LIMIT,
  CHANGE_EVIDENCE_TEXT_LIMIT,
} from '@/lib/config/site-health';

const CLASS_LABELS = {
  improvement: 'Improvement',
  'neutral-change': 'Neutral change',
  'potential-regression': 'Potential regression',
  'critical-regression': 'Critical regression',
} as const;

function displayPath(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function boundedText(value: string) {
  return value.length > CHANGE_EVIDENCE_TEXT_LIMIT
    ? `${value.slice(0, CHANGE_EVIDENCE_TEXT_LIMIT)}…`
    : value;
}

function ChangeValue({ value, depth = 0 }: Readonly<{ value: unknown; depth?: number }>) {
  if (value === null || value === undefined || value === '') return <>Not present</>;
  if (Array.isArray(value)) {
    if (!value.length) return <>Not present</>;
    if (depth >= CHANGE_EVIDENCE_DEPTH_LIMIT)
      return (
        <>
          {value.length} {value.length === 1 ? 'item' : 'items'}
        </>
      );
    return (
      <ul className={treeBranchClasses()}>
        {value.slice(0, CHANGE_EVIDENCE_LIMIT).map((item, index) => (
          <li
            key={index} // NOSONAR -- an immutable evidence array that never reorders and may repeat values; position is the identity
          >
            <ChangeValue value={item} depth={depth + 1} />
          </li>
        ))}
        {value.length > CHANGE_EVIDENCE_LIMIT ? (
          <li className="text-ink-muted">
            {value.length - CHANGE_EVIDENCE_LIMIT} more items not shown
          </li>
        ) : null}
      </ul>
    );
  }
  if (typeof value === 'object') return <ChangeRecord value={value} depth={depth} />;
  const text = scalarText(value);
  return text === null ? <>Not present</> : <>{boundedText(text)}</>;
}

/** Persisted evidence is JSON, so anything that is not a container is a scalar. */
function scalarText(value: unknown): string | null {
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    default:
      return null;
  }
}

const CONTENT_FIELD_ORDER = [
  'content_change_classification',
  'content_delta_ratio',
  'comparison_coverage',
  'coverage_reason',
  'sections_added',
  'sections_removed',
  'heading_outline',
  'word_count',
];

const CONTENT_STATE_FIELDS = new Set([
  'content_change_classification',
  'metadata_consistency',
  'comparison_coverage',
  'coverage',
  'coverage_reason',
  'content_delta_measure',
]);

function changeFieldValue(key: string, value: unknown) {
  if (typeof value !== 'string' || !CONTENT_STATE_FIELDS.has(key)) return value;
  const label = value.replaceAll('_', ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function ChangeRecord({ value, depth }: Readonly<{ value: object; depth: number }>) {
  const fields = Object.entries(value);
  if (!fields.length) return <>Not present</>;
  if (depth >= CHANGE_EVIDENCE_DEPTH_LIMIT)
    return (
      <>
        {fields.length} {fields.length === 1 ? 'field' : 'fields'}
      </>
    );
  // Comparison outcomes precede capture details in the bounded content record.
  const rank = (key: string) => {
    const index = CONTENT_FIELD_ORDER.indexOf(key);
    return index < 0 ? CONTENT_FIELD_ORDER.length : index;
  };
  fields.sort(([left], [right]) => rank(left) - rank(right));
  return (
    <dl className={treeBranchClasses()}>
      {fields.slice(0, CHANGE_EVIDENCE_LIMIT).map(([key, item]) => (
        <div key={key}>
          <dt className="text-ink-muted inline">{boundedText(key.replaceAll('_', ' '))}: </dt>
          <dd className="inline [overflow-wrap:anywhere]">
            {key === 'shingles' && Array.isArray(item) ? (
              `${item.length} text fingerprints`
            ) : (
              <ChangeValue value={changeFieldValue(key, item)} depth={depth + 1} />
            )}
          </dd>
        </div>
      ))}
      {fields.length > CHANGE_EVIDENCE_LIMIT ? (
        <div>
          <dt className="sr-only">Additional evidence</dt>
          <dd className="text-ink-muted">
            {fields.length - CHANGE_EVIDENCE_LIMIT} more fields not shown
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function Evidence({ row }: Readonly<{ row: ChangeObservation }>) {
  return (
    <Stack as="details" gap="item">
      <summary className={textRole('label', 'text-accent-ink cursor-pointer')}>
        View evidence
      </summary>
      <Stack as="dl" gap="tight" className="type-caption">
        <div>
          <dt className="text-ink-muted inline">Before: </dt>
          <dd className="inline">
            <ChangeValue value={row.before_value} />
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted inline">After: </dt>
          <dd className="inline">
            <ChangeValue value={row.after_value} />
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted inline">Analyses: </dt>
          <dd className="inline break-all">
            {row.source_analysis_a_id ?? 'none'} → {row.source_analysis_b_id ?? 'none'}
          </dd>
        </div>
        {row.implementation_event_id ? (
          <div>
            <dt className="text-ink-muted inline">Implementation event: </dt>
            <dd className="inline break-all">{row.implementation_event_id}</dd>
          </div>
        ) : null}
      </Stack>
    </Stack>
  );
}

export function ChangesPanel({
  workspaceId,
  projectId,
}: Readonly<{ workspaceId: string; projectId: string }>) {
  const summary = useQuery(siteHealthQueries.changesSummary(workspaceId, projectId));
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
    query: (request) =>
      siteHealthQueries.changes(workspaceId, projectId, { crawlAId, crawlBId, ...request }),
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
          <CardTitle>Website Changes</CardTitle>
          <CardDescription>
            Deterministic field changes between the immediate comparable crawls. Expected marks
            exact implementation-event matches.
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
          <TableRow key={row.id}>
            <TableCell>
              <TextLink
                text="emphasis"
                href={`/site/crawls/${summary.data?.crawl_b_id}/pages/${row.site_url_id}`}
              >
                <ClampText>{displayPath(row.normalized_url)}</ClampText>
              </TextLink>
            </TableCell>
            <TableCell>{row.field.replaceAll('_', ' ')}</TableCell>
            <TableCell>
              <Inline className="whitespace-nowrap">
                <Badge>{CLASS_LABELS[row.change_class]}</Badge>
                {row.expected ? <span className="type-caption">Expected</span> : null}
              </Inline>
            </TableCell>
            <TableCell>
              <Evidence row={row} />
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
    </Stack>
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
      description: `Reason: ${summary.data.reason_code?.replaceAll('_', ' ') ?? 'scope or version mismatch'}. Recrawl to compare the same scope and settings.`,
    };
  if (!pairAvailable)
    return {
      kind: 'empty',
      icon: GitCompare,
      headingLevel: 3,
      heading: 'This comparison is no longer available',
      description: 'Recrawl to compare again.',
    };
  return undefined;
}

const CHANGE_COLUMNS: readonly DataTableColumn[] = [
  { key: 'page', label: 'Page' },
  { key: 'field', label: 'Field', width: 'name' },
  { key: 'class', label: 'Class', width: 'name' },
  { key: 'evidence', label: 'Evidence' },
];

'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { Pager } from '@/components/ui/pager';
import { QueryState } from '@/components/ui/query-state';
import { StatGrid } from '@/components/ui/stat-grid';
import {
  ClampText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { siteHealthQueries } from '@/lib/api/site-health';
import type { ChangeObservation, ChangesPage, ChangeSummary } from '@/lib/api/types';
import { cursorControls, pageRange, useCursorTable } from '@/lib/table/use-cursor-table';
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
      <ul className="grid gap-1 pl-3">
        {value.slice(0, CHANGE_EVIDENCE_LIMIT).map((item, index) => (
          <li
            key={index} // NOSONAR -- an immutable evidence array that never reorders and may repeat values; position is the identity
          >
            <ChangeValue value={item} depth={depth + 1} />
          </li>
        ))}
        {value.length > CHANGE_EVIDENCE_LIMIT ? (
          <li className="text-muted">
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
    <dl className="grid gap-1 pl-3">
      {fields.slice(0, CHANGE_EVIDENCE_LIMIT).map(([key, item]) => (
        <div key={key}>
          <dt className="text-muted inline">{boundedText(key.replaceAll('_', ' '))}: </dt>
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
          <dd className="text-muted">
            {fields.length - CHANGE_EVIDENCE_LIMIT} more fields not shown
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function Evidence({ row }: Readonly<{ row: ChangeObservation }>) {
  return (
    <details className="grid gap-2">
      <summary className={textRole('label', 'text-accent-text cursor-pointer')}>
        View evidence
      </summary>
      <dl className="type-caption grid gap-1">
        <div>
          <dt className="text-muted inline">Before: </dt>
          <dd className="inline">
            <ChangeValue value={row.before_value} />
          </dd>
        </div>
        <div>
          <dt className="text-muted inline">After: </dt>
          <dd className="inline">
            <ChangeValue value={row.after_value} />
          </dd>
        </div>
        <div>
          <dt className="text-muted inline">Analyses: </dt>
          <dd className="inline break-all">
            {row.source_analysis_a_id ?? 'none'} → {row.source_analysis_b_id ?? 'none'}
          </dd>
        </div>
        {row.implementation_event_id ? (
          <div>
            <dt className="text-muted inline">Implementation event: </dt>
            <dd className="inline break-all">{row.implementation_event_id}</dd>
          </div>
        ) : null}
      </dl>
    </details>
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
  // The compared pair is part of the cursor's identity server-side, so a new
  // pair must restart paging rather than replay a refused cursor.
  const pager = useCursorTable(`changes|${projectId}|${crawlAId ?? ''}|${crawlBId ?? ''}`);
  const changes = useQuery({
    ...siteHealthQueries.changes(
      workspaceId,
      projectId,
      crawlAId,
      crawlBId,
      pager.cursor,
      pager.pageSize,
    ),
    enabled: pairAvailable,
  });

  return (
    <ChangesPanelContent
      summary={summary}
      changes={changes}
      pairAvailable={pairAvailable}
      pager={pager}
    />
  );
}

function ChangesPanelContent({
  summary,
  changes,
  pairAvailable,
  pager,
}: Readonly<{
  summary: UseQueryResult<ChangeSummary>;
  changes: UseQueryResult<ChangesPage>;
  pairAvailable: boolean;
  pager: ReturnType<typeof useCursorTable>;
}>) {
  const state = changesState(summary, changes, pairAvailable);
  return (
    state ?? (
      <ChangesTable
        summary={summary.data!}
        changes={changes.data!}
        pager={pager}
        isFetching={changes.isFetching}
      />
    )
  );
}

function changesState(
  summary: UseQueryResult<ChangeSummary>,
  changes: UseQueryResult<ChangesPage>,
  pairAvailable: boolean,
) {
  const loading = summary.isLoading || (pairAvailable && changes.isLoading);
  if (loading) return <QueryState kind="loading" label="Loading persisted website changes…" />;
  const failedRead = summary.isError ? summary : changes;
  if (failedRead.isError)
    return (
      <QueryState
        kind="error"
        error={failedRead.error}
        fallback="Could not load Website Changes."
        onRetry={() => void failedRead.refetch()}
        pending={failedRead.isFetching}
      />
    );
  return comparisonState(summary.data, pairAvailable);
}

function comparisonState(summary: ChangeSummary | undefined, pairAvailable: boolean) {
  if (!summary || summary.state === 'unavailable')
    return (
      <Alert tone="info">
        Website Changes need two usable crawls with persisted page evidence.
      </Alert>
    );
  if (summary.state === 'non_comparable')
    return (
      <Alert tone="warning">
        These crawls are not comparable (
        {summary.reason_code?.replaceAll('_', ' ') ?? 'scope or version mismatch'}). Recrawl to
        compare the same scope and settings.
      </Alert>
    );
  return pairAvailable ? null : (
    <Alert tone="danger">This comparison is no longer available. Recrawl to compare again.</Alert>
  );
}

function ChangesTable({
  summary,
  changes,
  pager,
  isFetching,
}: Readonly<{
  summary: ChangeSummary;
  changes: ChangesPage;
  pager: ReturnType<typeof useCursorTable>;
  /** A page is in flight; navigating again would push a stale cursor. */
  isFetching: boolean;
}>) {
  const rows = changes.items;
  const counts = summary.summary.counts_by_class as Record<string, number> | undefined;
  return (
    <div className="grid min-w-0 gap-[var(--workspace-gap)]" data-testid="website-changes">
      <Card>
        <CardHeader>
          <CardTitle>Website Changes</CardTitle>
          <CardDescription>
            Deterministic field changes between the immediate comparable crawls. Expected marks
            exact implementation-event matches.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 pt-0">
          <StatGrid
            columns={4}
            items={Object.entries(CLASS_LABELS).map(([key, label]) => ({
              key,
              label,
              value: counts?.[key] ?? 0,
            }))}
          />
          {rows.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Page</TableHead>
                  <TableHead>Field</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Evidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <TextLink
                        text="emphasis"
                        href={`/site/crawls/${summary.crawl_b_id}/pages/${row.site_url_id}`}
                      >
                        <ClampText>{displayPath(row.normalized_url)}</ClampText>
                      </TextLink>
                    </TableCell>
                    <TableCell>{row.field.replaceAll('_', ' ')}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge>{CLASS_LABELS[row.change_class]}</Badge>
                      {row.expected ? <span className="type-caption ml-2">Expected</span> : null}
                    </TableCell>
                    <TableCell>
                      <Evidence row={row} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <InlineEmpty>No changes were observed in this comparable pair.</InlineEmpty>
          )}
          <Pager
            frame="table"
            range={{ ...pageRange(pager.page, pager.pageSize, rows.length), noun: 'changes' }}
            // No exact total: a change set is scoped to one compared crawl
            // pair and no persisted count describes it, so the range stands
            // alone rather than paying for a COUNT(*) per navigation.
            pageSize={{ value: pager.pageSize, onChange: pager.setPageSize }}
            {...cursorControls(pager, changes.next_cursor)}
            busy={isFetching}
          />
        </CardContent>
      </Card>
    </div>
  );
}

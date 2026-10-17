'use client';

import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';

import { Pager } from '@/components/ui/pager';
import { Pressable } from '@/components/ui/pressable';
import { ReadError } from '@/components/ui/read-error';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { HintedHead } from '@/components/visibility/source-heads';
import {
  NumericCell,
  SourceName,
  StateRows,
  type SourceTableState,
} from '@/components/visibility/source-cells';
import type { SourceFilters } from '@/components/visibility/source-rows';
import { queryKeys } from '@/lib/api/query-keys';
import { visibilityApi } from '@/lib/api/visibility';
import { engineLabel } from '@/lib/providers/catalog';
import { count, hostOf, pathOf, sinceLabel } from '@/lib/visibility/sources';
import { selectionParams, type SourceQueries } from '@/lib/visibility/use-source-analysis';
import type { visibilitySourceNearMissesSchema } from '@citeladder/contracts/visibility-evidence';

type NearMisses = z.infer<typeof visibilitySourceNearMissesSchema>;

const COLUMNS = ['w-[46%]', '', '', '', 'hidden lg:table-cell'] as const;

/** Your pages an engine read and did not cite, over the same selection as the table. */
export function useSourceNearMisses(
  filters: SourceFilters,
  queries: SourceQueries,
  input: { enabled: boolean; limit: number },
) {
  const params = { ...selectionParams(filters, queries), limit: input.limit };
  return useQuery({
    queryKey: queryKeys.visibility.sourceNearMisses(queries.projectId ?? '', params),
    queryFn: ({ signal }) =>
      visibilityApi.getSourceNearMisses(queries.projectId!, params, {
        signal,
        workspaceId: queries.workspaceId,
      }),
    enabled: input.enabled && Boolean(queries.projectId && queries.activeRunId),
  });
}

function readHint(data: NearMisses | undefined) {
  const base =
    'Answers that read this page, counted over answers whose engine exposes what it read.';
  const unavailable = data?.unavailable_engines ?? [];
  return unavailable.length
    ? `${base} Not available for ${unavailable.map(engineLabel).join(', ')}.`
    : base;
}

function nearMissState(
  query: ReturnType<typeof useSourceNearMisses>,
  pageSize: number,
): SourceTableState {
  if (query.isLoading) return { kind: 'loading', rows: pageSize };
  const data = query.data;
  if (data?.items.length) return { kind: 'rows' };
  if (data && data.responses === 0)
    return {
      kind: 'empty',
      message: 'No engine in this selection exposes the pages it read.',
    };
  return { kind: 'empty', message: 'Every page of yours that an engine read, it also cited.' };
}

/**
 * The near-miss table: a page that reached the engine and still lost the
 * citation. Read and Cited count answers whose engine exposes what it read.
 */
function NearMissTable({
  query,
  pageSize,
  onOpenUrl,
}: Readonly<{
  query: ReturnType<typeof useSourceNearMisses>;
  pageSize: number;
  onOpenUrl: (url: string) => void;
}>) {
  if (query.isError) {
    return (
      <ReadError
        error={query.error}
        fallback="Could not load your pages read but not cited. Try again."
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
        className="m-[var(--card-padding)]"
      />
    );
  }
  const state = nearMissState(query, pageSize);
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className={COLUMNS[0]}>Your page</TableHead>
          <HintedHead label="Read in" hint={readHint(query.data)} />
          <TableHead numeric>Cited in</TableHead>
          <TableHead numeric>Not cited in</TableHead>
          <TableHead numeric className={COLUMNS[4]}>
            Last read
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {state.kind === 'rows' ? (
          (query.data?.items ?? []).map((row) => (
            <TableRow key={row.url_hash ?? row.url}>
              <TableCell>
                <Pressable
                  onClick={() => onOpenUrl(row.url)}
                  className="hover:text-accent-text flex max-w-full min-w-0 items-center transition-colors"
                >
                  <SourceName
                    name={row.title.trim() || pathOf(row.url)}
                    host={hostOf(row.url)}
                    secondary={row.title.trim() ? pathOf(row.url) : null}
                  />
                </Pressable>
              </TableCell>
              <NumericCell value={count(row.retrieved)} />
              <NumericCell value={count(row.cited)} />
              <NumericCell value={count(row.retrieved - row.cited)} />
              <NumericCell value={sinceLabel(row.last_retrieved_at)} className={COLUMNS[4]} />
            </TableRow>
          ))
        ) : (
          <StateRows state={state} columns={COLUMNS} />
        )}
      </TableBody>
    </Table>
  );
}

/** The near-miss list in the table's place, with a footer of the same footprint. */
export function NearMissBody({
  query,
  pageSize,
  onOpenUrl,
  onPageSizeChange,
}: Readonly<{
  query: ReturnType<typeof useSourceNearMisses>;
  pageSize: number;
  onOpenUrl: (url: string) => void;
  onPageSizeChange: (value: number) => void;
}>) {
  return (
    <>
      <NearMissTable query={query} pageSize={pageSize} onOpenUrl={onOpenUrl} />
      <NearMissFooter data={query.data} pageSize={pageSize} onPageSizeChange={onPageSizeChange} />
    </>
  );
}

/**
 * The same pager footer as the source table, so switching to this view moves
 * nothing. The list is the most-missed pages up to the page size; it does not
 * page further.
 */
function NearMissFooter({
  data,
  pageSize,
  onPageSizeChange,
}: Readonly<{
  data: NearMisses | undefined;
  pageSize: number;
  onPageSizeChange: (value: number) => void;
}>) {
  const shown = data?.items.length ?? 0;
  return (
    <Pager
      frame="table"
      range={{ from: shown ? 1 : 0, to: shown, total: data ? shown : undefined, noun: 'pages' }}
      pageSize={{ value: pageSize, onChange: onPageSizeChange }}
      canPrev={false}
      canNext={false}
      onPrev={() => undefined}
      onNext={() => undefined}
    />
  );
}

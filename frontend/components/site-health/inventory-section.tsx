'use client';

import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { FileText } from 'lucide-react';

import { PageLoading } from '@/components/layout/page-loading';
import { ReadError } from '@/components/ui/read-error';
import { EmptyState } from '@/components/ui/empty-state';
import { Label, textRole } from '@/components/ui/typography';
import { Pager } from '@/components/ui/pager';
import {
  ClampText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { PageKindSelect } from '@/components/site-health/page-kind-select';
import { PagesTable } from '@/components/site-health/pages-table';
import { RootErrorsBlock } from '@/components/site-health/root-errors-block';
import { warmQuery } from '@/lib/api/query-client';
import { siteHealthQueries, type PagesParams, type PagesSort } from '@/lib/api/site-health';
import type { PagesPage, SiteCrawl } from '@/lib/api/types';
import { Tabs } from '@/components/ui/tabs';
import { cursorControls, pageRange, useCursorTable } from '@/lib/table/use-cursor-table';
import { statusLabel, type InventoryMode } from '@/lib/site-health/status';

/**
 * Always-mounted inventory section of the canonical Site Health screen.
 *
 * ONE persistent region that renders the crawl's pages through the whole
 * lifecycle — the rows enrich in place instead of the screen swapping:
 *   - 'discovering': read-only rows streaming in as discovery finds them;
 *   - 'scored':      the tabbed (monitored / all / errors) page browser used
 *                    BOTH while analysis runs and after it finishes — statuses
 *                    move queued → running → completed and scores fill in on
 *                    the same rows (no separate "analyzing" table);
 *   - 'none':        an in-section empty state (nothing discovered yet).
 *
 * The section wrapper (and its `data-testid`) never unmounts across modes —
 * that stability is asserted by the screen regression tests.
 */
export function InventorySection({
  mode,
  crawl,
  active,
}: Readonly<{
  mode: InventoryMode;
  crawl: SiteCrawl | null;
  /** True while the crawl is non-terminal (keeps inventory/pages polling). */
  active: boolean;
}>) {
  let content: ReactNode;
  if (mode === 'none' || !crawl) {
    content = (
      <EmptyState
        variant="compact"
        icon={FileText}
        heading="Pages appear here as discovery finds them."
        headingLevel={3}
      />
    );
  } else if (mode === 'discovering') {
    content = <DiscoveringInventory crawl={crawl} />;
  } else {
    content = <ScoredInventory crawl={crawl} active={active} />;
  }

  return (
    <section className="grid min-w-0 gap-2" data-testid="inventory-section">
      {content}
    </section>
  );
}

/**
 * Read-only admitted-URL inventory while discovery runs (bounded to this
 * crawl). The first page keeps polling so new URLs stream in; deeper pages
 * stay stable under keyset (normalized_url, id) ordering.
 */
function DiscoveringInventory({ crawl }: Readonly<{ crawl: SiteCrawl }>) {
  const pager = useCursorTable(`inventory|${crawl.id}`);
  // No timer here: the screen polls the crawl once and invalidates this query's
  // FIRST page when the crawl actually moved (`invalidateCrawlViews`). Deeper
  // cursor pages stay static either way, so the rows under review don't shift
  // as new URLs are discovered.
  const inventoryQuery = useQuery(
    siteHealthQueries.inventory(crawl.workspace_id, crawl.id, {
      cursor: pager.cursor,
      limit: pager.pageSize,
    }),
  );
  const data = inventoryQuery.isError ? undefined : inventoryQuery.data;
  const rows = data?.items ?? [];
  const nextCursor = data?.next_cursor ?? null;

  let body: ReactNode;
  if (inventoryQuery.isError) {
    body = (
      <ReadError
        error={inventoryQuery.error}
        fallback="Could not load the page inventory."
        onRetry={() => void inventoryQuery.refetch()}
        pending={inventoryQuery.isFetching}
      />
    );
  } else if (rows.length === 0) {
    body = (
      <p className={textRole('body')}>
        Discovering pages — sitemaps and internal links are being scanned.
      </p>
    );
  } else {
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Page URL</TableHead>
            <TableHead>Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.site_url_id}>
              <TableCell>
                {/* Clamped for the same reason as the scored table: a long
                    query-string URL is one unbreakable token and would size
                    the column to its full width. */}
                <ClampText
                  lines={1}
                  className="type-caption text-foreground max-w-[40rem] tabular-nums"
                >
                  {row.display_url}
                </ClampText>
              </TableCell>
              <TableCell className="type-caption">
                {row.source ? statusLabel(row.source) : <UnavailableValue state="unknown" />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="grid gap-3">
      <Label>Pages discovered so far</Label>
      {body}
      {crawl.status === 'running' || crawl.status === 'queued' ? (
        <p className="type-caption">More URLs appear as discovery continues.</p>
      ) : null}
      <Pager
        frame="table"
        range={{ ...pageRange(pager.page, pager.pageSize, rows.length), noun: 'pages' }}
        // No exact total: `visible_url_count` counts what THIS crawl
        // admitted, which a recrawl inheriting monitored URLs need not match
        // row-for-row. The caption already says the list is still growing,
        // so the range alone is the honest reading — a total that can drift
        // from the rows beneath it is worse than no total.
        pageSize={{ value: pager.pageSize, onChange: pager.setPageSize }}
        {...cursorControls(pager, nextCursor)}
        busy={inventoryQuery.isFetching}
      />
    </div>
  );
}

/** The three server-backed page tabs (design mockup 713). */
type TabKey = 'monitored' | 'all' | 'errors';

const TABS: ReadonlyArray<{ key: TabKey; label: string; params: PagesParams }> = [
  { key: 'monitored', label: 'Monitored', params: { monitored: true } },
  { key: 'all', label: 'All Discovered', params: {} },
  { key: 'errors', label: 'Errors & Blocked', params: { status: 'error_or_blocked' } },
];

/**
 * The page browser (design mockup 713): three server-backed tabs, each its
 * OWN query with its own cursor stack — filtering is server-side, never a
 * filter over the current client page.
 *
 * Used for the WHOLE audit lifecycle: while analysis runs the first page of
 * the active tab polls, so each row's status badge advances queued → running
 * → completed and its scores fill in — the SAME rows, in place, until the run
 * settles. Finishing changes nothing structurally.
 */
function ScoredInventoryBody({
  query,
  rows,
  rootErrors,
  active,
  crawlId,
  sort,
  onSortChange,
}: Readonly<{
  query: UseQueryResult<PagesPage>;
  rows: PagesPage['items'];
  rootErrors: NonNullable<PagesPage['root_errors']>;
  active: boolean;
  crawlId: string;
  sort: PagesSort;
  onSortChange: (sort: PagesSort) => void;
}>) {
  if (query.isError)
    return (
      <ReadError
        error={query.error}
        fallback="Could not load pages for this view."
        onRetry={() => void query.refetch()}
        pending={query.isFetching}
      />
    );
  if (query.isLoading) return <PageLoading />;
  if (rows.length === 0 && rootErrors.length === 0)
    return (
      <EmptyState
        variant="compact"
        icon={FileText}
        heading={active ? 'Pages appear here as the audit reaches them.' : 'No pages in this view.'}
        headingLevel={3}
      />
    );
  return (
    <div className="grid gap-3">
      <RootErrorsBlock errors={rootErrors} />
      {rows.length > 0 ? (
        <PagesTable pages={rows} crawlId={crawlId} sort={sort} onSortChange={onSortChange} />
      ) : null}
    </div>
  );
}

function ScoredInventory({
  crawl,
  active,
}: Readonly<{
  crawl: SiteCrawl;
  active: boolean;
}>) {
  const requestedSort = useSearchParams()[0].get('sort');
  return (
    <ScoredInventoryState
      key={requestedSort ?? ''}
      crawl={crawl}
      active={active}
      requestedSort={requestedSort}
    />
  );
}

function ScoredInventoryState({
  crawl,
  active,
  requestedSort,
}: Readonly<{
  crawl: SiteCrawl;
  active: boolean;
  requestedSort: string | null;
}>) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('monitored');
  // Shared page-kind filter (v2 P1): one server-backed value that composes
  // with whichever tab is active — never a client filter over the page window.
  const [pageKind, setPageKind] = useState('');
  // Shared server-side ordering. Like the filter, it is part of the cursor
  // fingerprint, so changing it must restart every tab's paging.
  const [sort, setSort] = useState<PagesSort>(() => initialPagesSort(requestedSort));
  // Per-tab cursor stack so Prev/Next walk keyset pages without offsets.
  // `active` participates in the monitored scope because that tab's filter
  // changes from `status=completed` to the full projection when the crawl
  // terminalizes. Folding it into the key resets the stack DURING the render
  // that flips it, where an effect would let one request go out carrying the
  // stale, server-refused cursor first.
  const monitoredPager = useCursorTable(
    `pages|${crawl.id}|monitored|${active}|${sort}|${pageKind}`,
  );
  const allPager = useCursorTable(`pages|${crawl.id}|all|${sort}|${pageKind}`);
  const errorsPager = useCursorTable(`pages|${crawl.id}|errors|${sort}|${pageKind}`);
  const pager = { monitored: monitoredPager, all: allPager, errors: errorsPager }[tab];

  const activeTab = TABS.find((t) => t.key === tab)!;
  // A recrawl pre-seeds every monitored URL as pending. Showing that full
  // pending window immediately makes the table appear frozen and then burst
  // all at once. The first active view instead asks the persisted projection
  // for completed rows, so audited pages arrive progressively. The other tabs
  // remain available, and the terminal Monitored view returns to the complete
  // monitored set.
  const activeTabParams: PagesParams =
    active && tab === 'monitored' ? { ...activeTab.params, status: 'completed' } : activeTab.params;

  // A filter edit restarts EVERY tab from its first page — cursors are
  // filter-bound server-side, so a stale cursor under a new page type 400s.
  const resetPagers = () => {
    monitoredPager.reset();
    allPager.reset();
    errorsPager.reset();
  };
  const selectPageKind = (next: string) => {
    setPageKind(next);
    resetPagers();
  };
  const selectSort = (next: PagesSort) => {
    setSort(next);
    resetPagers();
  };

  // No timer here either: the screen's single crawl subscription invalidates
  // the FIRST page of every tab when the crawl moved, so rows advance
  // queued → running → completed in place. Deeper cursor pages stay static so
  // rows under review don't shift as more pages finish scoring.
  const pagesQuery = useQuery(
    siteHealthQueries.pages(crawl.workspace_id, crawl.id, {
      ...activeTabParams,
      page_kind: pageKind || undefined,
      sort,
      cursor: pager.cursor,
      limit: pager.pageSize,
    }),
  );
  const prefetchTab = (nextTab: (typeof TABS)[number]) => {
    warmQuery(
      queryClient,
      siteHealthQueries.pages(crawl.workspace_id, crawl.id, {
        ...nextTab.params,
        page_kind: pageKind || undefined,
        sort,
        limit: pager.pageSize,
      }),
    );
  };

  const data = pagesQuery.isError ? undefined : pagesQuery.data;
  const rows = data?.items ?? [];
  const nextCursor = data?.next_cursor ?? null;
  // the root fetch's failed calls ride the pages response. They
  // render ONLY on the Errors & Blocked tab, above the table, as a distinct
  // non-clickable block — the `error_or_blocked` filter keeps its real-page
  // semantics (a root failure never created a page row).
  const rootErrors = tab === 'errors' ? (data?.root_errors ?? []) : [];

  const body = (
    <ScoredInventoryBody
      query={pagesQuery}
      rows={rows}
      rootErrors={rootErrors}
      active={active}
      crawlId={crawl.id}
      sort={sort}
      onSortChange={selectSort}
    />
  );

  return (
    <div className="grid gap-3">
      <div className="flex min-h-10 flex-wrap items-end gap-2">
        <Tabs
          value={tab}
          onValueChange={setTab}
          onIntent={(value) => {
            const item = TABS.find((candidate) => candidate.key === value);
            if (item) prefetchTab(item);
          }}
          items={TABS.map((item) => ({
            value: item.key,
            label:
              active && tab === 'monitored' && item.key === 'monitored'
                ? 'Audited so far'
                : item.label,
          }))}
          ariaLabel="Page inventory views"
          rootClassName="min-w-0 flex-1"
        />
        <div className="ml-auto flex items-center gap-2">
          <PageKindSelect value={pageKind} onChange={selectPageKind} />
        </div>
      </div>

      {body}

      <Pager
        frame="table"
        range={{ ...pageRange(pager.page, pager.pageSize, rows.length), noun: 'pages' }}
        // Deliberately no exact total: these tabs are FILTERED views (status,
        // page kind), and no persisted count describes a filtered set. An
        // unbounded live COUNT(*) per navigation is the thing this footer
        // exists to avoid, so the range stands alone rather than carrying an
        // invented or expensive total.
        pageSize={{ value: pager.pageSize, onChange: pager.setPageSize }}
        {...cursorControls(pager, nextCursor)}
        busy={pagesQuery.isFetching}
      />
    </div>
  );
}

function initialPagesSort(value: string | null): PagesSort {
  const supported: readonly PagesSort[] = [
    'status',
    'url',
    'inbound',
    'main_content_inbound',
    'depth',
  ];
  return supported.includes(value as PagesSort) ? (value as PagesSort) : 'status';
}

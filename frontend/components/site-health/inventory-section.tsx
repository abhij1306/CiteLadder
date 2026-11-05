'use client';

import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { FileText } from 'lucide-react';

import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { PageKindSelect } from '@/components/site-health/page-kind-select';
import { PagesTable } from '@/components/site-health/pages-table';
import { RootErrorsBlock } from '@/components/site-health/root-errors-block';
import { warmQuery } from '@/lib/api/query-client';
import { siteHealthQueries, type PagesParams, type PagesSort } from '@/lib/api/site-health';
import type { SiteCrawl } from '@/lib/api/types';
import { Tabs } from '@/components/ui/tabs';
import { useCursorTableQuery } from '@/lib/table/use-cursor-table-query';
import { DEFAULT_PAGES_SORT, statusLabel, type InventoryMode } from '@/lib/site-health/status';

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
      <QueryState
        kind="empty"
        icon={FileText}
        heading="Pages appear here as discovery finds them"
        headingLevel={3}
      />
    );
  } else if (mode === 'discovering') {
    content = <DiscoveringInventory crawl={crawl} />;
  } else {
    content = <ScoredInventory crawl={crawl} active={active} />;
  }

  return (
    <section className="grid min-w-0" data-testid="inventory-section">
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
  // No timer here: the screen polls the crawl once and invalidates this query's
  // FIRST page when the crawl actually moved (`invalidateCrawlViews`). Deeper
  // cursor pages stay static either way, so the rows under review don't shift
  // as new URLs are discovered. No exact total: `visible_url_count` counts
  // what THIS crawl admitted, which a recrawl inheriting monitored URLs need
  // not match row-for-row, and a total that can drift from the rows beneath
  // it is worse than none.
  const { page, table } = useCursorTableQuery({
    workspaceId: crawl.workspace_id,
    scopeId: crawl.id,
    scope: null,
    query: (request) => siteHealthQueries.inventory(crawl.workspace_id, crawl.id, request),
    noun: 'pages',
    loading: 'Loading discovered pages…',
    error: 'Could not load the page inventory.',
    empty: () => ({
      kind: 'empty',
      icon: FileText,
      headingLevel: 3,
      heading: 'Discovering pages — sitemaps and internal links are being scanned',
    }),
  });

  return (
    <DataTable
      title="Pages discovered so far"
      columns={DISCOVERED_COLUMNS}
      {...table}
      footer={
        crawl.status === 'running' || crawl.status === 'queued'
          ? 'More URLs appear as discovery continues.'
          : undefined
      }
    >
      {page?.items.map((row) => (
        <TableRow key={row.site_url_id}>
          <TableCell>
            {/* Clamped for the same reason as the scored table: a long
                query-string URL is one unbreakable token. */}
            <ClampText lines={1} className="type-caption text-ink tabular-nums">
              {row.display_url}
            </ClampText>
          </TableCell>
          <TableCell className="type-caption">
            {row.source ? statusLabel(row.source) : <UnavailableValue state="unknown" />}
          </TableCell>
        </TableRow>
      ))}
    </DataTable>
  );
}

const DISCOVERED_COLUMNS: readonly DataTableColumn[] = [
  { key: 'url', label: 'Page URL' },
  { key: 'source', label: 'Source', width: 'name' },
];

/** The three server-backed page tabs (design mockup 713). */
type TabKey = 'monitored' | 'all' | 'errors';

const TABS: ReadonlyArray<{ key: TabKey; label: string; params: PagesParams }> = [
  { key: 'monitored', label: 'Monitored', params: { monitored: true } },
  { key: 'all', label: 'All Discovered', params: {} },
  { key: 'errors', label: 'Errors & Blocked', params: { status: 'error_or_blocked' } },
];

/**
 * The page browser (design mockup 713): three server-backed tabs, each its
 * own query restarting from its first page — filtering is server-side, never
 * a filter over the current client page.
 *
 * Used for the WHOLE audit lifecycle: while analysis runs the first page of
 * the active tab polls, so each row's status badge advances queued → running
 * → completed and its scores fill in — the SAME rows, in place, until the run
 * settles. Finishing changes nothing structurally.
 */
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
  // fingerprint, so changing it restarts paging.
  const [sort, setSort] = useState<PagesSort>(() => initialPagesSort(requestedSort));

  const activeTab = TABS.find((t) => t.key === tab)!;
  // A recrawl pre-seeds every monitored URL as pending. Showing that full
  // pending window immediately makes the table appear frozen and then burst
  // all at once. The first active view instead asks the persisted projection
  // for completed rows, so audited pages arrive progressively. The other tabs
  // remain available, and the terminal Monitored view returns to the complete
  // monitored set.
  const activeTabParams: PagesParams =
    active && tab === 'monitored' ? { ...activeTab.params, status: 'completed' } : activeTab.params;

  // No timer here either: the screen's single crawl subscription invalidates
  // the FIRST page of every tab when the crawl moved, so rows advance
  // queued → running → completed in place. Deeper cursor pages stay static so
  // rows under review don't shift as more pages finish scoring.
  //
  // The tab, its filter (which changes from `status=completed` to the full
  // projection when the crawl terminalizes), the page kind and the sort are
  // the cursor's fingerprint: any change restarts from the first page during
  // the render that makes it, before a server-refused cursor can go out. A
  // tab switch, page turn or filter change keeps the rows and the pager on
  // screen until the next page lands. No exact total: these are FILTERED
  // views and no persisted count describes a filtered set.
  const { page, table } = useCursorTableQuery({
    workspaceId: crawl.workspace_id,
    scopeId: crawl.id,
    scope: [tab, activeTabParams, pageKind, sort],
    query: (request) =>
      siteHealthQueries.pages(crawl.workspace_id, crawl.id, {
        ...activeTabParams,
        page_kind: pageKind || undefined,
        sort,
        ...request,
      }),
    noun: 'pages',
    loading: 'Loading pages…',
    error: 'Could not load pages for this view.',
    empty: () => ({
      kind: 'empty',
      icon: FileText,
      heading: active ? 'Pages appear here as the audit reaches them' : 'No pages in this view',
      headingLevel: 3,
    }),
  });
  const prefetchTab = (nextTab: (typeof TABS)[number]) => {
    warmQuery(
      queryClient,
      siteHealthQueries.pages(crawl.workspace_id, crawl.id, {
        ...nextTab.params,
        page_kind: pageKind || undefined,
        sort,
        limit: table.pageSize,
      }),
    );
  };

  // the root fetch's failed calls ride the pages response. They
  // render ONLY on the Errors & Blocked tab, above the table, as a distinct
  // non-clickable block — the `error_or_blocked` filter keeps its real-page
  // semantics (a root failure never created a page row).
  const rootErrors = tab === 'errors' ? (page?.root_errors ?? []) : [];

  return (
    <Stack>
      <Tabs
        value={tab}
        onValueChange={setTab}
        onIntent={(value) => {
          const item = TABS.find((candidate) => candidate.key === value);
          if (item) prefetchTab(item);
        }}
        // The label names what the tab shows, never which tab is selected: the
        // monitored tab lists audited pages for the whole active run.
        items={TABS.map((item) => ({
          value: item.key,
          label: active && item.key === 'monitored' ? 'Audited so far' : item.label,
        }))}
        ariaLabel="Page inventory views"
        controls={<PageKindSelect value={pageKind} onChange={setPageKind} />}
      />
      <RootErrorsBlock errors={rootErrors} />
      <PagesTable
        pages={page?.items ?? []}
        crawlId={crawl.id}
        sort={sort}
        onSortChange={setSort}
        state={table.state}
        pageSize={table.pageSize}
        pager={table.pager}
        busy={table.busy}
      />
    </Stack>
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
  return supported.includes(value as PagesSort) ? (value as PagesSort) : DEFAULT_PAGES_SORT;
}

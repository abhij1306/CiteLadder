import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import type { FilterBarProps } from '@/components/ui/filter-bar';
import { Stack } from '@/components/ui/layout';
import { QueryState } from '@/components/ui/query-state';
import { SearchField } from '@/components/ui/search-field';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import { SegmentedControl } from '@/components/ui/tabs';
import { UnavailableValue } from '@/components/ui/unavailable-value';
import { pageKindFilter } from '@/components/site-health/page-kind-select';
import { PagesTable } from '@/components/site-health/pages-table';
import { RootErrorsBlock } from '@/components/site-health/root-errors-block';
import { type PagesParams, type PagesSort } from '@/lib/api/site-health';
import { siteHealthQueries } from '@/lib/api/site-health-queries';
import type { SiteCrawl } from '@citeladder/contracts';
import { stringUrlCodec, useUrlState, type UrlCodec } from '@/lib/navigation/url-state';
import { PAGE_KINDS } from '@/lib/site-health/page-kinds';
import { useCursorTableQuery } from '@/lib/table/use-cursor-table-query';
import {
  CRAWL_STATES,
  DEFAULT_PAGES_SORT,
  statusLabel,
  type InventoryMode,
} from '@/lib/site-health/status';

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
  exportPages,
}: Readonly<{
  mode: InventoryMode;
  crawl: SiteCrawl | null;
  /** True while the crawl is non-terminal (keeps inventory/pages polling). */
  active: boolean;
  /** The crawl's pages export, at the end of the table's toolbar; absent where it is withheld. */
  exportPages?: Readonly<{ onExport: () => void; exporting: boolean }>;
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
    content = <ScoredInventory crawl={crawl} active={active} exportPages={exportPages} />;
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
  // FIRST page when the crawl actually moved (`refreshCrawlViews`). Deeper
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
        CRAWL_STATES[crawl.status].active ? 'More URLs appear as discovery continues.' : undefined
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

/** The three server-backed page views (design mockup 713). */
type ViewKey = 'monitored' | 'all' | 'errors';

const VIEWS: ReadonlyArray<{ key: ViewKey; label: string }> = [
  { key: 'monitored', label: 'Monitored' },
  { key: 'all', label: 'All Discovered' },
  { key: 'errors', label: 'Errors & Blocked' },
];

/** What each view asks the pages endpoint for. */
const VIEW_PARAMS: Readonly<Record<ViewKey, PagesParams>> = {
  monitored: { monitored: true },
  all: {},
  errors: { status: 'error_or_blocked' },
};

const VIEW_CODEC = stringUrlCodec<ViewKey>(
  VIEWS.map((view) => view.key),
  'monitored',
);

/** An unknown page kind in the address reads as no filter (all page kinds). */
const PAGE_KIND_CODEC: UrlCodec<string> = {
  parse: (raw) => PAGE_KINDS.find((pageKind) => pageKind === raw) ?? '',
  serialize: (value) => value || null,
};

/** A search: absent in the address is '', and a blank one never serializes. */
const SEARCH_CODEC: UrlCodec<string> = {
  parse: (raw) => raw ?? '',
  serialize: (value) => value.trim() || null,
};

/**
 * The address keys the page browser's view, page-kind filter and search live
 * in. The screen clears them when the reader leaves the Pages tab, so each
 * visit opens on Monitored, all page kinds and no search.
 */
export const PAGES_INVENTORY_URL_KEYS = ['pages_view', 'page_kind', 'pages_query'] as const;

function usePagesInventoryState() {
  const [view, setView] = useUrlState(PAGES_INVENTORY_URL_KEYS[0], VIEW_CODEC);
  const [pageKind, setPageKind] = useUrlState(PAGES_INVENTORY_URL_KEYS[1], PAGE_KIND_CODEC);
  const [query, setQuery] = useUrlState(PAGES_INVENTORY_URL_KEYS[2], SEARCH_CODEC);
  return { view, setView, pageKind, setPageKind, query, setQuery };
}

/** The search box: it applies on Enter, so each keystroke is not a request. */
function PageSearch({
  query,
  onApply,
}: Readonly<{ query: string; onApply: (query: string) => void }>) {
  const [draft, setDraft] = useState(query);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onApply(draft.trim());
      }}
    >
      <SearchField
        value={draft}
        onValueChange={setDraft}
        placeholder="Search page URLs…"
        aria-label="Search pages"
      />
    </form>
  );
}

type ExportPages = Readonly<{ onExport: () => void; exporting: boolean }>;

/**
 * The page browser's toolbar, in the table's own header row because it scopes
 * this table alone (D57): the Monitored / All Discovered / Errors & Blocked
 * view, All filters (page kind), then Export at the end. Both choices are
 * server-backed and live in the address.
 */
function usePagesToolbar(active: boolean, exportPages: ExportPages | undefined): FilterBarProps {
  const { view, setView, pageKind, setPageKind, query, setQuery } = usePagesInventoryState();
  return {
    view: (
      <SegmentedControl
        value={view}
        onChange={(next) => setView(next)}
        // The label names what the view shows, never which view is selected:
        // the monitored view lists audited pages for the whole active run.
        options={VIEWS.map((item) => ({
          value: item.key,
          label: active && item.key === 'monitored' ? 'Audited so far' : item.label,
        }))}
        ariaLabel="Page inventory views"
      />
    ),
    search: <PageSearch key={query} query={query} onApply={setQuery} />,
    filters: [pageKindFilter({ value: pageKind, onChange: (next) => setPageKind(next) })],
    actions: exportPages ? (
      <Button variant="secondary" onClick={exportPages.onExport} pending={exportPages.exporting}>
        <Icon icon={Download} />
        Export CSV
      </Button>
    ) : undefined,
  };
}

/**
 * The page browser (design mockup 713): three server-backed views, each its
 * own query restarting from its first page — filtering is server-side, never
 * a filter over the current client page. The view switch and page-kind filter
 * lead the table's own toolbar (`usePagesToolbar`).
 *
 * Used for the WHOLE audit lifecycle: while analysis runs the first page of
 * the active view polls, so each row's status badge advances queued → running
 * → completed and its scores fill in — the SAME rows, in place, until the run
 * settles. Finishing changes nothing structurally.
 */
function ScoredInventory({
  crawl,
  active,
  exportPages,
}: Readonly<{
  crawl: SiteCrawl;
  active: boolean;
  exportPages: ExportPages | undefined;
}>) {
  const requestedSort = useSearchParams()[0].get('sort');
  return (
    <ScoredInventoryState
      key={requestedSort ?? ''}
      crawl={crawl}
      active={active}
      requestedSort={requestedSort}
      exportPages={exportPages}
    />
  );
}

function ScoredInventoryState({
  crawl,
  active,
  requestedSort,
  exportPages,
}: Readonly<{
  crawl: SiteCrawl;
  active: boolean;
  requestedSort: string | null;
  exportPages: ExportPages | undefined;
}>) {
  // The view and the shared page-kind filter (v2 P1) live in the address,
  // drawn in the table's toolbar: server-backed values that compose with
  // each other — never a client filter over the page window.
  const { view, pageKind, query } = usePagesInventoryState();
  const toolbar = usePagesToolbar(active, exportPages);
  // Shared server-side ordering. Like the filter, it is part of the cursor
  // fingerprint, so changing it restarts paging.
  const [sort, setSort] = useState<PagesSort>(() => initialPagesSort(requestedSort));

  // A recrawl pre-seeds every monitored URL as pending. Showing that full
  // pending window immediately makes the table appear frozen and then burst
  // all at once. The first active view instead asks the persisted projection
  // for completed rows, so audited pages arrive progressively. The other views
  // remain available, and the terminal Monitored view returns to the complete
  // monitored set.
  const activeViewParams: PagesParams =
    active && view === 'monitored'
      ? { ...VIEW_PARAMS.monitored, status: 'completed' }
      : VIEW_PARAMS[view];

  // No timer here either: the screen's single crawl subscription invalidates
  // the FIRST page of every view when the crawl moved, so rows advance
  // queued → running → completed in place. Deeper cursor pages stay static so
  // rows under review don't shift as more pages finish scoring.
  //
  // The view, its filter (which changes from `status=completed` to the full
  // projection when the crawl terminalizes), the page kind and the sort are
  // the cursor's fingerprint: any change restarts from the first page during
  // the render that makes it, before a server-refused cursor can go out. A
  // view switch, page turn or filter change keeps the rows and the pager on
  // screen until the next page lands. No exact total: these are FILTERED
  // views and no persisted count describes a filtered set.
  const { page, table, rowOffset } = useCursorTableQuery({
    workspaceId: crawl.workspace_id,
    scopeId: crawl.id,
    scope: [view, activeViewParams, pageKind, query, sort],
    query: (request) =>
      siteHealthQueries.pages(crawl.workspace_id, crawl.id, {
        ...activeViewParams,
        page_kind: pageKind || undefined,
        query: query || undefined,
        sort,
        ...request,
      }),
    noun: 'pages',
    loading: 'Loading pages…',
    error: 'Could not load pages for this view.',
    empty: () => ({
      kind: 'empty',
      icon: FileText,
      heading: emptyPagesHeading(query, active),
      headingLevel: 3,
    }),
  });
  // The root fetch's failed calls ride the pages response. They
  // render ONLY on the Errors & Blocked view, above the table, as a distinct
  // non-clickable block — the `error_or_blocked` filter keeps its real-page
  // semantics (a root failure never created a page row).
  const rootErrors = view === 'errors' ? (page?.root_errors ?? []) : [];

  return (
    <Stack>
      <RootErrorsBlock errors={rootErrors} />
      <PagesTable
        toolbar={toolbar}
        pages={page?.items ?? []}
        rowOffset={rowOffset}
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

/** An empty view: no page matched the search, none reached yet, or none in it. */
function emptyPagesHeading(query: string, active: boolean): string {
  if (query) return `No pages match “${query}”`;
  return active ? 'Pages appear here as the audit reaches them' : 'No pages in this view';
}

/** The orders the table offers a header for: URL, else the default (status). */
function initialPagesSort(value: string | null): PagesSort {
  return value === 'url' ? 'url' : DEFAULT_PAGES_SORT;
}

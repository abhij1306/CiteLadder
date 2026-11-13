import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Columns3, Download } from 'lucide-react';

import { ListScreen } from '@/components/layout/page-shell';
import { AppGrid } from '@/components/ui/app-grid';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Stack } from '@/components/ui/layout';
import { Menu, MenuCheckboxItem, MenuContent, MenuLabel, MenuTrigger } from '@/components/ui/menu';
import { SearchField } from '@/components/ui/search-field';
import { SegmentedControl } from '@/components/ui/tabs';
import { InlineFigure } from '@/components/ui/typography';
import type { CommerceProductSource, CommerceTarget } from '@citeladder/contracts/commerce-suite';
import { commerceQueries } from '@/lib/api/commerce';
import { promptsQueries } from '@/lib/api/prompts';
import { downloadCsv } from '@/lib/csv/download';
import { formatCount } from '@/lib/format';
import { useCatalogProjection } from '@/lib/products/use-catalog-projection';
import { useCompetitorDiscovery } from '@/lib/products/competitor-discovery';
import {
  PRODUCT_COLUMNS,
  productCsv,
  useProductColumns,
  type ProductColumnKey,
} from '@/lib/products/product-columns';
import { productSearch, useProductFilters } from '@/lib/products/product-filters';
import { isTablePageSize, TABLE_DEFAULT_PAGE_SIZE, type TablePageSize } from '@/lib/config/tables';
import { useEngineCatalog } from '@/lib/providers/engines';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useWorkspaceCapability } from '@/lib/project/project-context';

import { BulkActions } from './bulk-actions';
import { productScopeFilters } from './product-scope-filters';
import { useCatalogHeader } from './catalog-header';
import { CategorySidebar } from './category-sidebar';
import { ProductsTable } from './products-table';

const SOURCES: readonly { value: CommerceProductSource; label: string }[] = [
  { value: 'catalog', label: 'My catalog' },
  { value: 'all', label: 'All products' },
  { value: 'archived', label: 'Archived' },
];

/**
 * The column settings: which metric columns the table draws and exports. A
 * setting of the table, not a filter, so it sits with Export at the row's end.
 */
function ColumnSettings({
  shown,
  onToggle,
}: Readonly<{ shown: readonly ProductColumnKey[]; onToggle: (key: ProductColumnKey) => void }>) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="secondary">
          <Icon icon={Columns3} />
          Columns
          <span className="text-ink-muted">
            {shown.length} of {PRODUCT_COLUMNS.length}
          </span>
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>Columns</MenuLabel>
        {PRODUCT_COLUMNS.map((column) => (
          <MenuCheckboxItem
            key={column.key}
            checked={shown.includes(column.key)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => onToggle(column.key)}
          >
            {column.label}
          </MenuCheckboxItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

/**
 * The cursor stack of the current filters: going back pops it, and a change
 * of filters starts again from the first page.
 */
function useCursorStack(search: string) {
  const [state, setState] = useState<{ search: string; stack: (string | null)[] }>({
    search,
    stack: [null],
  });
  const stack = state.search === search ? state.stack : [null];
  return {
    cursor: stack.at(-1) ?? null,
    page: stack.length,
    next: (cursor: string) => setState({ search, stack: [...stack, cursor] }),
    prev: () => setState({ search, stack: stack.slice(0, -1) }),
    first: () => setState({ search, stack: [null] }),
  };
}

/** The rows on screen ("11–20 of 110 products"), once the page has loaded. */
function pageRange({
  page,
  pageSize,
  shown,
  total,
}: Readonly<{ page: number; pageSize: number; shown: number; total: number | undefined }>) {
  if (total === undefined || shown === 0) return undefined;
  const from = (page - 1) * pageSize + 1;
  return { from, to: from + shown - 1, total, noun: 'products' };
}

/**
 * Commerce's Products table (commerce improvement PR 3): every product holder
 * with its metrics over the chosen window, the catalog's categories beside it,
 * and the filters in the top strip. A catalog product opens its own page.
 */
export function ProductsScreen() {
  const { workspaceId, projectId } = useProjectScope();
  return <ProductsContent workspaceId={workspaceId} projectId={projectId} />;
}

function ProductsContent({
  workspaceId,
  projectId,
}: Readonly<{ workspaceId: string; projectId: string }>) {
  const scope = { workspaceId, projectId };
  const productFilters = useProductFilters();
  const { filters } = productFilters;
  const [pageSize, setPageSize] = useState<TablePageSize>(TABLE_DEFAULT_PAGE_SIZE);
  // A new page size is a new search, so it starts again from the first page.
  const search = productSearch(filters, pageSize);
  const cursors = useCursorStack(search);
  const page = useQuery(commerceQueries.products(scope, search, cursors.cursor));
  const catalog = useQuery(commerceQueries.catalog(scope));
  const projection = useCatalogProjection(projectId, catalog);
  const promptSets = useQuery(promptsQueries.sets(scope));
  const engines = useEngineCatalog();
  const discovery = useCompetitorDiscovery(projectId);
  const header = useCatalogHeader({ workspaceId, projectId, query: catalog, projection });
  const columns = useProductColumns();
  const canRun = useWorkspaceCapability('run');
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const rows = page.data?.items ?? [];
  const check = (ids: string[], next: boolean) =>
    setChecked((current) => {
      const updated = new Set(current);
      ids.forEach((id) => (next ? updated.add(id) : updated.delete(id)));
      return updated;
    });
  const targets: CommerceTarget[] = [...checked].map((id) => ({ kind: 'product', id }));
  const exportRows = () => {
    const csv = productCsv(rows, columns.shown);
    downloadCsv(
      `citeladder-products-${new Date().toISOString().slice(0, 10)}`,
      csv.headers,
      csv.rows,
    );
  };
  return (
    <ListScreen
      actions={header.actions}
      controls={{
        view: (
          <SegmentedControl
            ariaLabel="Products shown"
            value={filters.source}
            options={SOURCES}
            onChange={productFilters.setSource}
          />
        ),
        search: (
          <SearchField
            value={filters.q}
            onValueChange={productFilters.setQ}
            onClear={() => productFilters.setQ('')}
            placeholder="Search products"
            aria-label="Search products"
          />
        ),
        filters: productScopeFilters({
          scope: productFilters,
          engines,
          promptSets: promptSets.data?.prompt_sets ?? [],
        }),
        // What the table lists closes the row: its products and the answers they came from.
        status: page.data ? (
          <>
            <span>
              <InlineFigure>{formatCount(page.data.total)}</InlineFigure>
              {page.data.total === 1 ? ' product' : ' products'}
            </span>
            <span>
              <InlineFigure>{formatCount(page.data.executions)}</InlineFigure>
              {page.data.executions === 1 ? ' answer' : ' answers'} in the last{' '}
              {page.data.window_days} days
            </span>
          </>
        ) : null,
        actions: (
          <>
            <ColumnSettings shown={columns.shown} onToggle={columns.toggle} />
            <Button variant="secondary" onClick={exportRows} disabled={rows.length === 0}>
              <Icon icon={Download} />
              Export
            </Button>
          </>
        ),
      }}
    >
      <Stack gap="workspace">
        {header.stats}
        {header.notices}
        {checked.size ? (
          <BulkActions
            count={checked.size}
            pending={discovery.discover.isPending}
            error={discovery.discover.error}
            onDiscover={() => discovery.discover.mutate(targets)}
            onClear={() => setChecked(new Set())}
          />
        ) : null}
        <AppGrid layout="list-detail">
          <CategorySidebar
            query={catalog}
            category={filters.category}
            onCategory={productFilters.setCategory}
          />
          <Stack>
            <ProductsTable
              query={page}
              scope={filters}
              trackable={filters.source === 'all'}
              // Checked products are for competitor discovery, a run.
              selectable={canRun && filters.source !== 'archived'}
              columns={columns.shown}
              sort={filters.sort}
              onSort={productFilters.setSort}
              checked={checked}
              onCheck={check}
              pageSize={pageSize}
              pager={{
                pageSize: {
                  value: pageSize,
                  onChange: (size) => {
                    if (isTablePageSize(size)) setPageSize(size);
                  },
                },
                range: pageRange({
                  page: cursors.page,
                  pageSize,
                  shown: rows.length,
                  total: page.data?.total,
                }),
                canPrev: cursors.page > 1,
                canNext: Boolean(page.data?.next_cursor),
                onPrev: cursors.prev,
                onNext: () => {
                  if (page.data?.next_cursor) cursors.next(page.data.next_cursor);
                },
                onFirst: cursors.first,
                page: cursors.page,
                busy: page.isFetching,
              }}
            />
          </Stack>
        </AppGrid>
      </Stack>
    </ListScreen>
  );
}

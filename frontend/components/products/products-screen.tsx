import { useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { ReportPage } from '@/components/templates/report-page';
import { Button } from '@/components/ui/button';
import { FilterBar } from '@/components/ui/filter-bar';
import { Icon } from '@/components/ui/icon';
import { Menu, MenuCheckboxItem, MenuContent, MenuLabel, MenuTrigger } from '@/components/ui/menu';
import { SearchField } from '@/components/ui/search-field';
import { StateBlock } from '@/components/ui/state-block';
import { SegmentedControl } from '@/components/ui/tabs';
import { TextLink } from '@/components/ui/text-link';
import { InlineFigure } from '@/components/ui/typography';
import type { CommerceProductSource, CommerceTarget } from '@citeladder/contracts/commerce-suite';
import { Columns3, Download, PackageOpen } from '@/lib/icons';
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
import {
  DEFAULT_PRODUCT_FILTERS,
  productSearch,
  useProductFilters,
  type ProductFilters,
} from '@/lib/products/product-filters';
import { targetHref } from '@/lib/products/targets';
import { isTablePageSize, TABLE_DEFAULT_PAGE_SIZE, type TablePageSize } from '@/lib/config/tables';
import { setUrlParams } from '@/lib/navigation/url-state';
import { TABLE_SEARCH_DEBOUNCE_MS } from '@/lib/config/operational';
import { useDebounced } from '@/lib/use-debounced';
import { useEngineCatalog } from '@/lib/providers/engines';
import { useProjectScope } from '@/lib/project/active-project-scope';
import { useWorkspaceCapability } from '@/lib/project/project-context';

import { BulkActions } from './bulk-actions';
import { categoryFilter, productScopeFilters } from './product-scope-filters';
import { ConfirmBusinessModelLink, useCatalogHeader } from './catalog-header';
import { ProductsTable, type ProductsEmpty } from './products-table';

const SOURCES: readonly { value: CommerceProductSource; label: string }[] = [
  { value: 'catalog', label: 'My catalog' },
  { value: 'all', label: 'All products' },
  { value: 'archived', label: 'Archived' },
];

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
          <span className="text-ink-2">{shown.length}</span>
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

function narrowed(filters: ProductFilters): boolean {
  return Boolean(
    filters.q.trim() ||
    filters.category ||
    filters.engine ||
    filters.promptSet ||
    filters.window !== DEFAULT_PRODUCT_FILTERS.window,
  );
}

function noProducts({
  catalog,
  page,
  filters,
}: Readonly<{
  catalog: Pick<UseQueryResult<{ product_total: number }>, 'data' | 'isError'>;
  page: Pick<UseQueryResult<{ items: readonly unknown[] }>, 'data' | 'isError'>;
  filters: ProductFilters;
}>) {
  if (catalog.isError || page.isError) return false;
  if (filters.source !== 'catalog' || narrowed(filters)) return false;
  return catalog.data?.product_total === 0 && page.data?.items.length === 0;
}

function NoProducts({ empty }: Readonly<{ empty: ReturnType<typeof useCatalogHeader>['empty'] }>) {
  return (
    <ReportPage actions={empty.dialog}>
      {empty.notices}
      <StateBlock
        kind="empty"
        icon={PackageOpen}
        heading="No products yet"
        description={empty.businessModelUnconfirmed ? <ConfirmBusinessModelLink /> : undefined}
        action={empty.actions}
      />
    </ReportPage>
  );
}

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
  const q = useDebounced(filters.q, TABLE_SEARCH_DEBOUNCE_MS);
  const search = productSearch({ ...filters, q }, pageSize);
  const cursors = useCursorStack(search);
  const page = useQuery(commerceQueries.products(scope, search, cursors.cursor));
  const catalog = useQuery(commerceQueries.catalog(scope));
  const projection = useCatalogProjection(projectId, catalog);
  const promptSets = useQuery(promptsQueries.sets(scope));
  const engines = useEngineCatalog();
  const discovery = useCompetitorDiscovery(projectId);
  const header = useCatalogHeader({
    workspaceId,
    projectId,
    query: catalog,
    projection,
    tableReadFailed: page.isError,
  });
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
  const empty: ProductsEmpty = narrowed(filters)
    ? {
        kind: 'filtered',
        onClear: () =>
          setUrlParams({ q: null, category: null, engine: null, prompt_set: null, window: null }),
      }
    : { kind: 'empty', source: filters.source };
  const selectedCategory = catalog.data?.categories.find((row) => row.id === filters.category);
  const exportRows = () => {
    const csv = productCsv(rows, columns.shown);
    downloadCsv(
      `citeladder-products-${new Date().toISOString().slice(0, 10)}`,
      csv.headers,
      csv.rows,
    );
  };
  if (noProducts({ catalog, page, filters })) return <NoProducts empty={header.empty} />;
  return (
    <ReportPage
      actions={header.actions}
      filters={
        <FilterBar
          view={
            <SegmentedControl
              ariaLabel="Products shown"
              value={filters.source}
              options={SOURCES}
              onChange={productFilters.setSource}
            />
          }
          search={
            <SearchField
              value={filters.q}
              onValueChange={productFilters.setQ}
              onClear={() => productFilters.setQ('')}
              placeholder="Search products"
              aria-label="Search products"
            />
          }
          filters={[
            categoryFilter(filters.category, catalog.data, productFilters.setCategory),
            ...productScopeFilters({
              scope: productFilters,
              engines,
              promptSets: promptSets.data?.prompt_sets ?? [],
            }),
          ]}
          status={
            page.data ? (
              <>
                <span>
                  <InlineFigure>{formatCount(page.data.total)}</InlineFigure>
                  {page.data.total === 1 ? ' product' : ' products'}
                </span>
                <span>
                  <InlineFigure>{formatCount(page.data.executions)}</InlineFigure>
                  {page.data.executions === 1 ? ' answer' : ' answers'} in the last{' '}
                  <InlineFigure>{page.data.window_days}</InlineFigure> days
                </span>
              </>
            ) : null
          }
        />
      }
    >
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
      <ProductsTable
        query={page}
        onRetry={() => {
          void page.refetch();
          header.retryReads();
        }}
        scope={filters}
        empty={empty}
        description={
          selectedCategory ? (
            <TextLink href={targetHref(selectedCategory.id)} text="caption">
              Open {selectedCategory.name}
            </TextLink>
          ) : undefined
        }
        actions={
          <>
            <ColumnSettings shown={columns.shown} onToggle={columns.toggle} />
            <Button variant="secondary" onClick={exportRows} disabled={rows.length === 0}>
              <Icon icon={Download} />
              Export
            </Button>
          </>
        }
        trackable={filters.source === 'all'}
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
    </ReportPage>
  );
}

import { PackageOpen } from 'lucide-react';

import { DataTable, type DataTableColumn, type DataTablePager } from '@/components/ui/data-table';
import {
  TableActionsCell,
  TableCell,
  TableCellLines,
  TableRow,
  TableSelectCell,
  mutedWhenMissing,
} from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { MissingValue, UnavailableValue } from '@/components/ui/unavailable-value';
import type {
  CommerceProductPage,
  CommerceProductRow,
  CommerceProductSort,
} from '@citeladder/contracts/commerce-suite';
import {
  holderCaption,
  PRODUCT_COLUMNS,
  productCell,
  type ProductCell,
  type ProductColumnKey,
} from '@/lib/products/product-columns';
import { productHref, type ProductScopeFilters } from '@/lib/products/product-filters';
import { useProjectScope } from '@/lib/project/active-project-scope';
import type { UseQueryResult } from '@tanstack/react-query';

import { AddToTracking } from './product-catalog-controls';

/** The metric columns a reader can sort by; each sorts best first. */
const SORTABLE: Partial<Record<ProductColumnKey, CommerceProductSort>> = {
  visibility: 'visibility',
  win_rate: 'win_rate',
  position: 'position',
};

function MissingCell({ state }: Readonly<{ state: 'unavailable' | 'unknown' | 'none' }>) {
  if (state === 'none') return <span className="text-ink-muted">None</span>;
  // Unavailable (nothing in scope to measure) is the missing mark, so a row of
  // unmeasured figures is not a row of repeated words; unknown (the catalog has
  // no price) keeps its word. Neither is ever a zero.
  return state === 'unknown' ? <UnavailableValue state="unknown" /> : <MissingValue />;
}

/** Each metric column's width role; the product name takes a quarter of the table. */
const COLUMN_WIDTHS: Record<ProductColumnKey, DataTableColumn['width']> = {
  visibility: 'shortMetric',
  appearances: 'shortMetric',
  win_rate: 'shortMetric',
  position: 'shortMetric',
  mentioned_price: 'figure',
  catalog_price: 'figure',
  merchants: 'name',
};

/** A metric's text, or the word for its missing state, with its note beneath. */
export function MetricValue({ cell }: Readonly<{ cell: ProductCell }>) {
  const value = cell.kind === 'value' ? cell.text : <MissingCell state={cell.state} />;
  if (!cell.note) return value;
  return (
    <span title={cell.note}>
      {value}
      <span className="type-caption block">{cell.note}</span>
    </span>
  );
}

/** The product cell: its page (in the read's window), its brand and who holds it. */
export function ProductName({
  row,
  scope,
}: Readonly<{
  row: Pick<CommerceProductRow, 'holder_id' | 'name' | 'brand' | 'kind'>;
  scope: ProductScopeFilters;
}>) {
  const name = (
    <TextLink href={productHref(row.holder_id, scope)} text="inherit">
      {row.name}
    </TextLink>
  );
  return <TableCellLines title primary={name} secondary={holderCaption(row)} />;
}

/**
 * The Products table: one row per holder with the shown metric columns. A
 * catalog product can be checked for bulk competitor discovery; competitor
 * rows cannot (discovery targets the catalog), nor archived products.
 */
export function ProductsTable({
  query,
  columns,
  sort,
  onSort,
  checked,
  onCheck,
  pager,
  pageSize,
  scope,
  trackable = false,
  selectable = true,
}: Readonly<{
  /** The reader's rows per page: the footprint the table reserves. */
  pageSize: number;
  query: UseQueryResult<CommerceProductPage>;
  /** All products: an AI-observed competitor's row offers Add to tracking (CM6). */
  trackable?: boolean;
  /** Whether catalog rows can be checked; archived products take no new competitors. */
  selectable?: boolean;
  /** The window, engine and prompt set a row's page opens with. */
  scope: ProductScopeFilters;
  columns: readonly ProductColumnKey[];
  sort: CommerceProductSort;
  onSort: (sort: CommerceProductSort) => void;
  checked: ReadonlySet<string>;
  onCheck: (ids: string[], checked: boolean) => void;
  pager: DataTablePager;
}>) {
  const shown = PRODUCT_COLUMNS.filter((column) => columns.includes(column.key));
  const tableColumns: DataTableColumn[] = [
    {
      key: 'product',
      label: 'Product',
      width: 'lead',
      sort: { active: sort === 'name', descending: false, onSort: () => onSort('name') },
    },
    ...shown.map((column): DataTableColumn => {
      const sortKey = SORTABLE[column.key];
      return {
        key: column.key,
        label: column.label,
        hint: column.hint,
        width: COLUMN_WIDTHS[column.key],
        numeric: column.key !== 'merchants',
        ...(sortKey
          ? {
              sort: {
                active: sort === sortKey,
                descending: sortKey !== 'position',
                onSort: () => onSort(sortKey),
              },
            }
          : {}),
      };
    }),
    ...(trackable
      ? [
          {
            key: 'track',
            label: 'Tracking',
            width: 'name',
            trailing: true,
            hideLabel: true,
          } satisfies DataTableColumn,
        ]
      : []),
  ];
  const projectScope = useProjectScope();
  const rows = query.data?.items ?? [];
  const owned = selectable
    ? rows.filter((row) => row.kind === 'owned').map((row) => row.holder_id)
    : [];
  const checkedOnPage = owned.filter((id) => checked.has(id)).length;
  let all: boolean | 'indeterminate' = false;
  if (checkedOnPage && checkedOnPage === owned.length) all = true;
  else if (checkedOnPage) all = 'indeterminate';
  return (
    <DataTable
      label="Products"
      columns={tableColumns}
      rowCount={rows.length}
      pageSize={pageSize}
      rowLines={2}
      minWidth="xl"
      pinFirstColumn
      busy={{ active: query.isFetching && !query.isPending, label: 'Updating products' }}
      selection={{
        all,
        onAllChange: (next) => onCheck(owned, next),
        noun: 'products on this page',
      }}
      state={tableState(query)}
      pager={pager}
    >
      {rows.map((row) => (
        <TableRow key={row.holder_id}>
          <TableSelectCell
            label={`Select ${row.name}`}
            checked={checked.has(row.holder_id)}
            disabled={!owned.includes(row.holder_id)}
            onCheckedChange={(next) => onCheck([row.holder_id], next)}
          />
          <TableCell>
            <ProductName row={row} scope={scope} />
          </TableCell>
          {shown.map((column) => {
            const cell = productCell(row, column.key);
            return (
              <TableCell
                key={column.key}
                numeric={column.key !== 'merchants'}
                className={mutedWhenMissing(cell.kind === 'value' ? 0 : null)}
              >
                <MetricValue cell={cell} />
              </TableCell>
            );
          })}
          {trackable ? (
            <TableActionsCell>
              {row.kind === 'ai_observed_competitor' ? (
                <AddToTracking
                  scope={{
                    workspaceId: projectScope.workspaceId,
                    projectId: projectScope.projectId,
                  }}
                  candidateId={row.holder_id}
                  name={row.name}
                />
              ) : null}
            </TableActionsCell>
          ) : null}
        </TableRow>
      ))}
    </DataTable>
  );
}

function tableState(query: UseQueryResult<CommerceProductPage>) {
  if (query.isPending) return { kind: 'loading', label: 'Loading products' } as const;
  if (query.isError)
    return {
      kind: 'error',
      error: query.error,
      fallback: 'Products could not be loaded.',
      onRetry: () => void query.refetch(),
      pending: query.isFetching,
    } as const;
  if (query.data.items.length) return undefined;
  return {
    kind: 'empty',
    icon: PackageOpen,
    heading: 'No products match',
    description:
      'Import a catalog, run a Site Health crawl, or clear the search and category to see more.',
  } as const;
}

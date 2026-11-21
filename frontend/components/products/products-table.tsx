import type { ReactNode } from 'react';

import { DataTable, type DataTableColumn, type DataTablePager } from '@/components/ui/data-table';
import {
  TableActionsCell,
  TableCell,
  TableCellLines,
  TableRow,
  TableSelectCell,
} from '@/components/ui/table';
import { TextLink } from '@/components/ui/text-link';
import { Absence } from '@/components/ui/absence';
import { ClampText } from '@/components/ui/clamp-text';
import { Value } from '@/components/ui/value';
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
import {
  productHref,
  type ProductFilters,
  type ProductScopeFilters,
} from '@/lib/products/product-filters';
import { PackageOpen } from '@/lib/icons';
import { useProjectScope } from '@/lib/project/active-project-scope';
import type { UseQueryResult } from '@tanstack/react-query';

import { AddToTracking } from './product-catalog-controls';

const SORTABLE: Partial<Record<ProductColumnKey, CommerceProductSort>> = {
  visibility: 'visibility',
  win_rate: 'win_rate',
  position: 'position',
};

const LOW_PRIORITY: ReadonlySet<ProductColumnKey> = new Set([
  'mentioned_price',
  'catalog_price',
  'merchants',
]);
const COLUMN_WIDTHS: Record<ProductColumnKey, DataTableColumn['width']> = {
  visibility: 'shortMetric',
  appearances: 'shortMetric',
  win_rate: 'shortMetric',
  position: 'shortMetric',
  mentioned_price: 'figure',
  catalog_price: 'figure',
  merchants: 'category',
};

function MetricValue({ cell, text }: Readonly<{ cell: ProductCell; text: boolean }>) {
  let value: ReactNode;
  if (cell.kind === 'missing') value = <MissingValue cell={cell} />;
  else value = text ? <ClampText>{cell.text}</ClampText> : <Value value={cell.text} />;
  if (!cell.note) return value;
  return (
    <span className="inline-flex items-baseline gap-2 whitespace-nowrap">
      {value}
      <span className="text-ink-2 font-sans">{cell.note}</span>
    </span>
  );
}

export function MissingValue({
  cell,
}: Readonly<{ cell: Extract<ProductCell, { kind: 'missing' }> }>) {
  switch (cell.state) {
    case 'none':
      return <Absence state="none" />;
    case 'not_mentioned':
      return <Absence state="none" label="Not mentioned" />;
    case 'not_applicable':
      return <Absence state="not_applicable" />;
    case 'unknown':
      return <Absence state="unavailable" label="Unknown" />;
    case 'unavailable':
      return <Absence state="not_measured" />;
    default: {
      const exhaustive: never = cell.state;
      return exhaustive;
    }
  }
}

export type ProductsEmpty =
  | Readonly<{ kind: 'empty'; source: ProductFilters['source'] }>
  | Readonly<{ kind: 'filtered'; onClear: () => void }>;

export function ProductName({
  row,
  scope,
}: Readonly<{
  row: Pick<CommerceProductRow, 'holder_id' | 'name' | 'brand' | 'kind'>;
  scope: ProductScopeFilters;
}>) {
  const name = (
    <TextLink href={productHref(row.holder_id, scope)} text="inherit" underline="hover">
      {row.name}
    </TextLink>
  );
  const caption = row.kind === 'owned' ? row.brand : holderCaption(row);
  return <TableCellLines title primary={name} secondary={caption || undefined} />;
}

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
  empty,
  description,
  actions,
  onRetry = () => void query.refetch(),
}: Readonly<{
  actions?: ReactNode;
  empty: ProductsEmpty;
  onRetry?: () => void;
  description?: ReactNode;
  pageSize: number;
  query: UseQueryResult<CommerceProductPage>;
  trackable?: boolean;
  selectable?: boolean;
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
      kind: 'identity',
      sort: { active: sort === 'name', descending: false, onSort: () => onSort('name') },
    },
    ...shown.map((column): DataTableColumn => {
      const sortKey = SORTABLE[column.key];
      return {
        key: column.key,
        label: column.label,
        hint: column.hint,
        width: COLUMN_WIDTHS[column.key],
        kind: column.key === 'merchants' ? 'text' : 'number',
        ...(LOW_PRIORITY.has(column.key) ? { priority: 'low' as const } : {}),
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
            kind: 'actions',
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
      description={description}
      actions={actions}
      columns={tableColumns}
      rowCount={rows.length}
      pageSize={pageSize}
      busy={{ active: query.isFetching && !query.isPending, label: 'Updating products' }}
      selection={{
        all,
        onAllChange: (next) => onCheck(owned, next),
        noun: 'products on this page',
      }}
      state={tableState({ query, empty, onRetry })}
      pager={pager}
    >
      {rows.map((row) => (
        <TableRow key={row.holder_id} highlight={trackable && row.kind === 'owned'}>
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
              <TableCell key={column.key}>
                <MetricValue cell={cell} text={column.key === 'merchants'} />
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

const EMPTY_COPY = {
  catalog: { heading: 'No products yet' },
  all: { heading: 'No products yet' },
  archived: { heading: 'No archived products' },
} as const satisfies Record<ProductFilters['source'], { heading: string }>;

function tableState({
  query,
  empty,
  onRetry,
}: Readonly<{
  query: UseQueryResult<CommerceProductPage>;
  empty: ProductsEmpty;
  onRetry: () => void;
}>) {
  if (query.isPending) return { kind: 'loading', label: 'Loading products' } as const;
  if (query.isError)
    return {
      kind: 'error',
      title: "Couldn't load products",
      error: query.error,
      fallback: 'Products could not be loaded.',
      onRetry,
      pending: query.isFetching,
    } as const;
  if (query.data.items.length) return undefined;
  if (empty.kind === 'filtered')
    return {
      kind: 'filtered',
      heading: 'No products match these filters',
      onClear: empty.onClear,
    } as const;
  return { kind: 'empty', icon: PackageOpen, ...EMPTY_COPY[empty.source] } as const;
}

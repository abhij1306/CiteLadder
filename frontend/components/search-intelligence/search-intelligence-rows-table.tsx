import type { DataTableColumn } from '@/components/ui/data-table';
import { Pressable } from '@/components/ui/pressable';
import { TextLink } from '@/components/ui/text-link';
import { ClampText, TableCell, TableRow } from '@/components/ui/table';
import type { SearchIntelligenceRow } from '@/lib/api/search-intelligence';
import { SEARCH_COLUMNS_BY_KIND, type SearchColumn } from '@/lib/config/search-intelligence';
import { MissingValue } from '@/components/ui/unavailable-value';
import { SearchValue } from './search-intelligence-value';

function cellText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : null;
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' ? value : null;
}

function displayValue(row: SearchIntelligenceRow, column: SearchColumn) {
  const result = row[column.field];
  if (column.numeric) return <SearchValue value={result} digits={column.precision ?? 0} />;
  return cellText(result) ?? <MissingValue />;
}

function columnsFor(kind: string) {
  return SEARCH_COLUMNS_BY_KIND[kind] ?? SEARCH_COLUMNS_BY_KIND.footprint;
}

/**
 * A dataset kind's columns for the shared `DataTable`: every column but a
 * detail one sorts on the server, figures take the figure width and text the
 * name width.
 */
export function searchIntelligenceColumns({
  kind,
  order,
  onSort,
}: Readonly<{
  kind: string;
  order: { sort: string; direction: 'asc' | 'desc' };
  onSort: (sort: string) => void;
}>): DataTableColumn[] {
  return columnsFor(kind).map((column) => ({
    key: column.field,
    label: column.label,
    numeric: column.numeric,
    width: column.numeric ? 'figure' : 'name',
    sort: column.detail
      ? undefined
      : {
          active: order.sort === column.field,
          descending: order.direction === 'desc',
          onSort: () => onSort(column.field),
        },
  }));
}

/** One page of saved rows; the first cell opens the row's evidence. */
export function SearchIntelligenceRows({
  kind,
  rows,
  onSelect,
}: Readonly<{
  kind: string;
  rows: SearchIntelligenceRow[];
  onSelect: (row: SearchIntelligenceRow) => void;
}>) {
  const columns = columnsFor(kind);
  return rows.map((row) => (
    <TableRow key={row.id}>
      {columns.map((column) => (
        <TableCell key={column.field} numeric={column.numeric}>
          {column === columns[0] ? (
            <TextLink asChild text="inherit">
              <Pressable
                type="button"
                className="block max-w-full text-left"
                aria-label={`View evidence for ${row.keyword || row.domain || row.url}`}
                onClick={() => onSelect(row)}
              >
                <ClampText>{displayValue(row, column)}</ClampText>
              </Pressable>
            </TextLink>
          ) : (
            displayValue(row, column)
          )}
        </TableCell>
      ))}
    </TableRow>
  ));
}

import { Pressable } from '@/components/ui/pressable';
import { TextLink } from '@/components/ui/text-link';
import {
  ClampText,
  SortableTableHead,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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

export function SearchIntelligenceRowsTable({
  kind,
  rows: visibleRows,
  order,
  onSort,
  onSelect,
}: Readonly<{
  kind: string;
  rows: SearchIntelligenceRow[];
  order: { sort: string; direction: 'asc' | 'desc' };
  onSort: (sort: string) => void;
  onSelect: (row: SearchIntelligenceRow) => void;
}>) {
  const columns = SEARCH_COLUMNS_BY_KIND[kind] ?? SEARCH_COLUMNS_BY_KIND.footprint;
  return (
    <Table minWidth={kind === 'ranking_keywords' ? 'xl' : 'lg'} className="table-fixed">
      <colgroup>
        {columns.map((column) => (
          <col key={column.field} className={column.numeric ? 'w-28' : 'w-48'} />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow>
          {columns.map((column) =>
            column.detail ? (
              <TableHead key={column.field} numeric={column.numeric}>
                {column.label}
              </TableHead>
            ) : (
              <SortableTableHead
                key={column.field}
                label={column.label}
                numeric={column.numeric}
                active={order.sort === column.field}
                descending={order.direction === 'desc'}
                onSort={() => onSort(column.field)}
              />
            ),
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {visibleRows.map((row) => (
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
        ))}
        {!visibleRows.length ? (
          <TableRow>
            <TableCell colSpan={columns.length}>No saved rows match this view.</TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}

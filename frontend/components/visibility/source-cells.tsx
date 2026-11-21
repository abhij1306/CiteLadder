import { BrandMark } from '@/components/ui/brand-mark';
import { Inline } from '@/components/ui/layout';
import { TableCell, TableCellLines } from '@/components/ui/table';
import { Absence } from '@/components/ui/absence';
import type { SortState, SourcesData } from '@/lib/visibility/sources';

export function SourceName({
  name,
  host,
  secondary,
}: Readonly<{ name: string; host: string | null; secondary?: string | null }>) {
  return (
    <Inline as="span">
      <BrandMark name={name} websiteUrl={host ? `https://${host}` : null} />
      <TableCellLines primary={name} secondary={secondary} />
    </Inline>
  );
}

export function NumericCell({
  value,
  desktopOnly,
}: Readonly<{ value: string | null; desktopOnly?: boolean }>) {
  return (
    <TableCell numeric desktopOnly={desktopOnly}>
      {value ?? <Absence />}
    </TableCell>
  );
}

export function RetrievedCell({ value }: Readonly<{ value: string | null }>) {
  return (
    <TableCell numeric>
      {value ?? (
        <Absence
          state="unavailable"
          reason="No answer in this selection exposes the pages it read."
        />
      )}
    </TableCell>
  );
}

export function retrievedHint(
  base: string,
  retrieval: SourcesData['retrieval'] | undefined,
  engineLabel: (key: string) => string,
) {
  const unavailable = retrieval?.unavailable_engines ?? [];
  if (!unavailable.length) return base;
  return `${base} Not available for ${unavailable.map((key) => engineLabel(key)).join(', ')}, which do not expose the pages they read.`;
}

export function sortProps(sort: SortState, onSort: (column: string) => void, column: string) {
  return {
    active: sort?.column === column,
    descending: sort?.direction === 'desc',
    onSort: () => onSort(column),
  };
}

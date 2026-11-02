import type { ReactNode } from 'react';

import { TableCellLines } from '@/components/ui/table';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayDate, formatDisplayTime, formatDisplayTimestamp } from '@/lib/format';

export function DisplayTime({
  value,
  dateOnly = false,
  fallback = null,
}: Readonly<{ value: string | null | undefined; dateOnly?: boolean; fallback?: ReactNode }>) {
  const timeZone = useDisplayTimeZone();
  if (!value) return fallback;
  return (
    <time dateTime={value}>
      {dateOnly ? formatDisplayDate(value, timeZone) : formatDisplayTimestamp(value, timeZone)}
    </time>
  );
}

/**
 * A date-time in a table's date column: the date over its time and zone. On
 * one line ("Nov 1, 2026, 05:03 PM GMT+5:30") it is wider than the column and
 * ran into the next one.
 */
export function TableTime({
  value,
  fallback = null,
}: Readonly<{ value: string | null | undefined; fallback?: ReactNode }>) {
  const timeZone = useDisplayTimeZone();
  if (!value) return fallback;
  return (
    <time dateTime={value} className="block min-w-0">
      <TableCellLines
        primary={formatDisplayDate(value, timeZone)}
        secondary={formatDisplayTime(value, timeZone)}
      />
    </time>
  );
}

import type { ReactNode } from 'react';

import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayDate, formatDisplayTimestamp } from '@/lib/format';

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

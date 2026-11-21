import type { ReactNode } from 'react';

import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayDate, formatDisplayTimestamp } from '@/lib/format';

export function DisplayTime({
  value,
  dateOnly = false,
  standalone = false,
  fallback = null,
}: Readonly<{
  value: string | null | undefined;
  dateOnly?: boolean;
  standalone?: boolean;
  fallback?: ReactNode;
}>) {
  const timeZone = useDisplayTimeZone();
  if (!value) return fallback;
  return (
    <time dateTime={value} className={standalone ? 'tabular-nums' : undefined}>
      {dateOnly ? formatDisplayDate(value, timeZone) : formatDisplayTimestamp(value, timeZone)}
    </time>
  );
}

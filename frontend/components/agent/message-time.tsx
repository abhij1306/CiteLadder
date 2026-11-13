import { useState } from 'react';

import { Tooltip } from '@/components/ui/tooltip';
import { useDisplayTimeZone } from '@/lib/display-timezone';
import { formatDisplayTimestamp } from '@/lib/format';

/**
 * A message's time, short: the time of day for today, else the date and time.
 * The full timestamp with its zone shows on hover and is what assistive
 * technology reads.
 */
export function MessageTime({ value }: Readonly<{ value: string }>) {
  const timeZone = useDisplayTimeZone();
  const [now] = useState(() => Date.now());
  const full = formatDisplayTimestamp(value, timeZone);
  return (
    <Tooltip content={full} describe={false}>
      <time dateTime={value}>
        <span aria-hidden>{shortTimestamp({ value, timeZone, now })}</span>
        <span className="sr-only">{full}</span>
      </time>
    </Tooltip>
  );
}

function shortTimestamp({
  value,
  timeZone,
  now,
}: Readonly<{ value: string; timeZone: string; now: number }>): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    const day = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone });
    const year = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone });
    const today = day.format(date) === day.format(now);
    const thisYear = year.format(date) === year.format(now);
    return new Intl.DateTimeFormat('en-US', {
      ...(today ? {} : { month: 'short', day: 'numeric' }),
      ...(thisYear ? {} : { year: 'numeric' }),
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }).format(date);
  } catch {
    return formatDisplayTimestamp(value, timeZone);
  }
}

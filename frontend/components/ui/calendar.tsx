import { useState } from 'react';

import { Pressable } from '@/components/ui/pressable';
import { ChevronLeft, ChevronRight } from '@/lib/icons';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

function anchor(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  if (Number.isNaN(date.getTime())) return null;
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return date;
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function weekdayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

const monthLabelFormat = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function monthLabel(date: Date): string {
  return monthLabelFormat.format(date);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1, 12));
}

function monthGrid(month: Date): string[] {
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1, 12));
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - weekdayIndex(first));
  const days: string[] = [];
  for (let index = 0; index < 42; index += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    days.push(toIso(day));
    if (index % 7 === 6 && day.getUTCMonth() !== month.getUTCMonth() && index >= 27) break;
  }
  return days;
}

export function Calendar({
  value,
  onSelect,
  min,
  max,
  ariaLabel,
}: Readonly<{
  value: string;
  onSelect: (iso: string) => void;
  min?: string;
  max?: string;
  ariaLabel: string;
}>) {
  const selected = anchor(value);
  const [month, setMonth] = useState<Date>(() =>
    addMonths(selected ?? anchor(max ?? '') ?? new Date(), 0),
  );
  const days = monthGrid(month);
  const monthIndex = month.getUTCMonth();

  const weeks: string[][] = [];
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }

  return (
    <fieldset className="grid gap-2">
      <legend className="sr-only">{ariaLabel}</legend>
      <div className="flex items-center justify-between gap-2">
        <Pressable
          type="button"
          aria-label="Previous month"
          onClick={() => setMonth((current) => addMonths(current, -1))}
          className="enabled:hover:overlay-hover enabled:active:overlay-pressed rounded-control inline-flex size-[var(--control-md)] items-center justify-center"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
        </Pressable>
        <span aria-live="polite" className="type-body">
          {monthLabel(month)}
        </span>
        <Pressable
          type="button"
          aria-label="Next month"
          onClick={() => setMonth((current) => addMonths(current, 1))}
          className="enabled:hover:overlay-hover enabled:active:overlay-pressed rounded-control inline-flex size-[var(--control-md)] items-center justify-center"
        >
          <ChevronRight className="size-3.5" aria-hidden />
        </Pressable>
      </div>
      <table className="border-collapse">
        <thead>
          <tr>
            {WEEKDAYS.map((weekday) => (
              <th key={weekday} scope="col" className="type-caption p-0 pb-1 text-center">
                {weekday}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((iso) => {
                const day = anchor(iso);
                if (!day) return null;
                const outside = day.getUTCMonth() !== monthIndex;
                const disabled =
                  (min !== undefined && iso < min) || (max !== undefined && iso > max);
                const isSelected = iso === value;
                return (
                  <td key={iso} className="p-0">
                    <Pressable
                      type="button"
                      aria-pressed={isSelected}
                      aria-label={iso}
                      disabled={disabled}
                      onClick={() => onSelect(iso)}
                      className={cn(
                        'type-body text-ink inline-flex size-[var(--control-md)] items-center justify-center rounded-control tabular-nums transition-colors',
                        isSelected
                          ? 'bg-primary text-on-primary enabled:hover:bg-primary-hover enabled:active:bg-primary-hover'
                          : 'enabled:hover:overlay-hover enabled:active:overlay-pressed',
                        outside && !isSelected && 'text-ink-2',
                      )}
                    >
                      {day.getUTCDate()}
                    </Pressable>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </fieldset>
  );
}

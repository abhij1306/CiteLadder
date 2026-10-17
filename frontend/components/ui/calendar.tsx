'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { Pressable } from '@/components/ui/pressable';
import { cn } from '@/lib/utils';

/**
 * Calendar — a month grid for picking one ISO (`YYYY-MM-DD`) day.
 *
 * Built from tokens rather than a calendar library: the surface needs one
 * bounded single-date grid, and every visual it needs (control radius, accent
 * fill, muted text, focus ring) already exists in the system.
 *
 * Dates are handled as ISO STRINGS end to end, never as `Date` objects. A
 * `Date` carries a time zone, so parsing "2026-09-05" and formatting it back
 * can shift the day either side of UTC — the exact bug that makes a picked
 * date arrive as the day before. The only `Date` used is a UTC-noon anchor
 * for grid arithmetic, which no zone can push across a day boundary.
 */

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

/** A UTC-noon `Date` for one ISO day — safe for month/day arithmetic. */
function anchor(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  if (Number.isNaN(date.getTime())) return null;
  // Date.UTC OVERFLOWS rather than rejecting: "2026-02-31" becomes March 3,
  // and "2026-13-01" becomes January 2027. Both match the ISO shape above, so
  // the round trip is the only check that catches them.
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

/** Monday-first index (0-6) of a UTC date's weekday. */
function weekdayIndex(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

// Explicit locale, not the ambient one: the server and the browser would
// otherwise resolve different defaults and the heading would hydrate mismatched.
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

/** Every day shown for `month`'s grid, padded to whole Monday-first weeks. */
function monthGrid(month: Date): string[] {
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1, 12));
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - weekdayIndex(first));
  const days: string[] = [];
  for (let index = 0; index < 42; index += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    days.push(toIso(day));
    // Stop after the week that completes the month rather than always
    // drawing six rows, so the panel does not jump height between months.
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
  /** Selected ISO day, or '' when none is chosen yet. */
  value: string;
  onSelect: (iso: string) => void;
  /** Inclusive ISO bounds; days outside them are disabled. */
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

  // Weeks of seven, so the grid can be a real <table>: a calendar IS tabular
  // data, and native table semantics beat ARIA roles for screen readers.
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
          className="enabled:hover:bg-hover enabled:active:bg-active inline-flex size-[var(--control-height-md)] items-center justify-center rounded-[var(--radius-control)]"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Pressable>
        {/* Announced on change so a screen reader hears the month it moved to. */}
        <span aria-live="polite" className="type-item-title">
          {monthLabel(month)}
        </span>
        <Pressable
          type="button"
          aria-label="Next month"
          onClick={() => setMonth((current) => addMonths(current, 1))}
          className="enabled:hover:bg-hover enabled:active:bg-active inline-flex size-[var(--control-height-md)] items-center justify-center rounded-[var(--radius-control)]"
        >
          <ChevronRight className="size-4" aria-hidden />
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
                        'type-body text-foreground inline-flex size-[var(--control-height-md)] items-center justify-center rounded-[var(--radius-control)] tabular-nums transition-colors',
                        isSelected
                          ? 'bg-accent text-accent-fg enabled:hover:bg-accent-hover enabled:active:bg-accent-active'
                          : 'enabled:hover:bg-hover enabled:active:bg-active',
                        // Days spilling in from the neighbouring months stay
                        // legible but recede, so the current month reads as
                        // the subject.
                        outside && !isSelected && 'text-muted',
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

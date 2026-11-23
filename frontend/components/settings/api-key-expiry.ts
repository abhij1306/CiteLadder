import { z } from 'zod';

import { endOfDayInZone } from '@/lib/display-timezone';

export const EXPIRY_PRESET_DAYS = [1, 7, 30, 90] as const;

export type ExpiryChoice = `${(typeof EXPIRY_PRESET_DAYS)[number]}` | 'custom' | 'never';

export const DEFAULT_EXPIRY: ExpiryChoice = '30';

export type Expiry =
  | { kind: 'never' }
  | { kind: 'at'; expiresAt: string }
  | { kind: 'invalid'; message: string };

export function dayInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function addDays(isoDay: string, days: number): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function presetLabelDate(isoDay: string, today: string): string {
  return new Date(`${isoDay}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(isoDay.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

export function resolveExpiry({
  choice,
  customDay,
  today,
  timeZone,
}: Readonly<{ choice: ExpiryChoice; customDay: string; today: string; timeZone: string }>): Expiry {
  switch (choice) {
    case 'never':
      return { kind: 'never' };
    case 'custom':
      if (!z.iso.date().safeParse(customDay).success)
        return { kind: 'invalid', message: 'Enter a date as YYYY-MM-DD.' };
      if (customDay < today) return { kind: 'invalid', message: 'Choose today or a later date.' };
      return { kind: 'at', expiresAt: endOfDayInZone(customDay, timeZone) };
    case '1':
    case '7':
    case '30':
    case '90':
      return { kind: 'at', expiresAt: endOfDayInZone(addDays(today, Number(choice)), timeZone) };
    default: {
      const unreachable: never = choice;
      return unreachable;
    }
  }
}

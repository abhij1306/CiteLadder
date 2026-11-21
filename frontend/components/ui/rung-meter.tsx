import { useId } from 'react';

import { MeterLabelRow } from '@/components/ui/meter';
import { formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

const RUNGS = 10;
const MAX = 100;

export function RungMeter({ label, value }: Readonly<{ label: string; value: number }>) {
  const labelId = useId();
  const clamped = Math.min(MAX, Math.max(0, value));
  const shown = formatPercent(clamped / MAX);
  const filled = Math.round((clamped / MAX) * RUNGS);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <MeterLabelRow>
        <span id={labelId} className="type-body">
          {label}
        </span>
        <span className="type-body text-ink-2 whitespace-nowrap tabular-nums">{shown}</span>
      </MeterLabelRow>
      <progress
        className="sr-only"
        aria-labelledby={labelId}
        max={MAX}
        value={clamped}
        aria-valuetext={shown}
      />
      <span aria-hidden className="grid grid-cols-10 gap-0.5">
        {Array.from({ length: RUNGS }, (_, index) => (
          <span
            key={index}
            className={cn('rounded-mark h-2', index >= filled ? 'bg-well' : 'bg-ink')}
          />
        ))}
      </span>
    </div>
  );
}

export function BusyRung({ active, label }: Readonly<{ active: boolean; label: string }>) {
  if (!active) return null;
  return (
    <div className="absolute inset-x-0 top-0 z-1 h-0.5">
      <progress className="sr-only" aria-label={label} aria-busy />
      <span aria-hidden className="bg-ink animate-live-rung block h-full w-6" />
    </div>
  );
}

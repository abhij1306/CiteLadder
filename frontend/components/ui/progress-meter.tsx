import { useId } from 'react';

import { formatPercent } from '@/lib/format';

const MAX = 100;

export function ProgressMeter({ label, value }: Readonly<{ label: string; value: number }>) {
  const labelId = useId();
  const clamped = Math.min(MAX, Math.max(0, value));
  const shown = formatPercent(clamped / MAX);
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
      <span id={labelId} className="type-caption text-ink-2 truncate">
        {label}
      </span>
      <progress
        className="sr-only"
        aria-labelledby={labelId}
        max={MAX}
        value={clamped}
        aria-valuetext={shown}
      />
      <span aria-hidden className="bg-well block h-1 overflow-hidden rounded-full">
        <span
          className="bg-data-you block h-full rounded-full [transition:width_var(--motion-slide)_var(--ease-standard)]"
          style={{ width: `${clamped}%` }}
        />
      </span>
      <span className="type-caption text-ink whitespace-nowrap tabular-nums">{shown}</span>
    </div>
  );
}

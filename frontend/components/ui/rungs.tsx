import { cn } from '@/lib/utils';

export type RungLevel = 0 | 1 | 2 | 3;

const RUNG_LABELS = ['Not cited', 'Mentioned', 'Cited', 'Top source'] as const;
const RUNG_HEIGHTS = ['h-1.5', 'h-2.5', 'h-3.5'] as const;

/**
 * Rungs — the logo's three ascending bars as a citation level: not cited,
 * mentioned, cited, top source. Bars fill with `accent` from the shortest up;
 * empty bars are `line`. The word is always present: printed with
 * `showLabel` (detail views), otherwise for screen readers (table cells).
 * Only ever a citation level, never a generic signal icon.
 */
export function Rungs({
  level,
  label,
  showLabel = false,
}: Readonly<{ level: RungLevel; label?: string; showLabel?: boolean }>) {
  const text = label ?? RUNG_LABELS[level];
  return (
    <span className="inline-flex items-center gap-2 align-middle">
      <span aria-hidden className="inline-flex h-3.5 items-end gap-0.5">
        {RUNG_HEIGHTS.map((height, index) => (
          <span
            key={height}
            className={cn('rounded-2xs', height, index < level ? 'w-1 bg-accent' : 'w-1 bg-line')}
          />
        ))}
      </span>
      <span className={showLabel ? 'text-body-sm text-ink-secondary' : 'sr-only'}>{text}</span>
    </span>
  );
}

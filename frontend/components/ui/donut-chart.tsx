'use client';

import { useId, useState } from 'react';

import { LegendSwatch } from '@/components/ui/chart';
import { textRole } from '@/components/ui/typography';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * A segmented ring with its total in the middle, and a legend beneath it.
 *
 * Distinct from `ScoreRing`, which is one arc measuring one value against 100.
 * This is a composition: several parts of one whole, where the whole is itself
 * the headline number. Sharing an implementation would mean one component
 * where the `value` prop means two different things.
 *
 * The centre reports the TOTAL the segments are shares of, so the ring and the
 * number under it cannot disagree — a mix counted one way beside a total
 * counted another is the failure this shape exists to prevent.
 *
 * Hovering or focusing a segment or its legend entry surfaces that slice's
 * count and share. Both routes reach the same state, so the figures are
 * available without a pointer.
 */

export type DonutSlice = {
  key: string;
  label: string;
  value: number;
  /** Stroke class from the categorical chart tokens, e.g. `stroke-chart-2`. */
  strokeClass: string;
  /** Matching fill for the legend swatch, e.g. `bg-chart-2`. */
  swatchClass: string;
};

const SIZE = 168;
const STROKE = 16;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// Enough to separate neighbouring segments without eating a small slice.
const GAP = 2;

function shareText(value: number, total: number): string {
  if (!total) return '0%';
  const share = (value / total) * 100;
  return share < 0.1 ? '<0.1%' : `${share.toFixed(1)}%`;
}

/** Each segment starts where the ones before it ended, so the offsets are a running total. */
function ringArcs(slices: readonly DonutSlice[], whole: number) {
  let start = 0;
  return slices.map((slice) => {
    const length = (slice.value / whole) * CIRCUMFERENCE;
    const arc = {
      ...slice,
      // A gap is only taken out of a segment long enough to give one up.
      dash: Math.max(length - (length > GAP * 2 ? GAP : 0), 0.5),
      offset: -start,
    };
    start += length;
    return arc;
  });
}

export function DonutChart({
  slices,
  total,
  totalLabel,
  emptyLabel = 'Nothing to chart yet.',
  className,
}: Readonly<{
  slices: readonly DonutSlice[];
  /** The number in the centre. Passed rather than summed: it is the server's
   *  count over the whole selection, and the slices may be a bounded subset. */
  total: number;
  totalLabel: string;
  emptyLabel?: string;
  className?: string;
}>) {
  const titleId = useId();
  const [active, setActive] = useState<string | null>(null);
  const drawn = slices.filter((slice) => slice.value > 0);
  const sum = drawn.reduce((carry, slice) => carry + slice.value, 0);
  // The denominator is the DECLARED total, never the slices' own sum. The
  // slices can be a bounded or classified subset — citations whose page was
  // never identified are counted in the centre and belong to no type — and
  // scaling them to fill the ring would report 100% beside a larger number.
  const whole = Math.max(total, sum);
  const unaccounted = Math.max(whole - sum, 0);

  if (!drawn.length || whole <= 0) {
    return <p className={textRole('caption', cn('text-secondary', className))}>{emptyLabel}</p>;
  }

  const arcs = ringArcs(drawn, whole);
  // The remainder is drawn as a quiet arc rather than left as a gap: an
  // unclosed ring reads as a rendering fault, and a closed one that silently
  // rescaled its parts is worse.
  const remainderLength = (unaccounted / whole) * CIRCUMFERENCE;
  const highlighted = active ? drawn.find((slice) => slice.key === active) : undefined;

  return (
    <div className={cn('grid justify-items-center gap-4', className)}>
      {/* The ring is a picture of the legend below it, and the legend is
          focusable and reads every figure. Labelling both would announce the
          same composition twice, so the drawing is hidden and the list is the
          accessible copy. */}
      <p id={titleId} className="sr-only">
        {`${whole} ${totalLabel}. ` +
          drawn
            .map((slice) => `${slice.label}: ${slice.value} (${shareText(slice.value, whole)})`)
            .join(', ') +
          (unaccounted > 0 ? `. Unclassified: ${unaccounted}` : '')}
      </p>
      <div className="relative">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden className="size-[168px]">
          {/* Rotated so the first segment starts at twelve o'clock, which is
              where a reader expects a composition to begin. */}
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {arcs.map((arc) => (
              <circle
                key={arc.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                strokeWidth={STROKE}
                strokeDasharray={`${arc.dash} ${CIRCUMFERENCE - arc.dash}`}
                strokeDashoffset={arc.offset}
                onMouseEnter={() => setActive(arc.key)}
                onMouseLeave={() => setActive(null)}
                className={cn(
                  arc.strokeClass,
                  'transition-opacity',
                  active && active !== arc.key ? 'opacity-30' : 'opacity-100',
                )}
              />
            ))}
            {remainderLength > 0 ? (
              <circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                strokeWidth={STROKE}
                strokeDasharray={`${remainderLength} ${CIRCUMFERENCE - remainderLength}`}
                strokeDashoffset={-(CIRCUMFERENCE - remainderLength)}
                className="stroke-border-subtle"
              />
            ) : null}
          </g>
        </svg>
        {/* Centre copy sits over the ring rather than inside the svg so it
            uses the same type scale as the rest of the card. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 grid place-items-center text-center"
        >
          {highlighted ? (
            <div className="grid gap-0.5">
              <span className={textRole('figure', 'tabular-nums')}>{highlighted.value}</span>
              <span className={textRole('caption', 'text-secondary')}>
                {shareText(highlighted.value, whole)}
              </span>
            </div>
          ) : (
            <div className="grid gap-0.5">
              <span className={textRole('figure', 'tabular-nums')}>{formatCount(total)}</span>
              <span className={textRole('caption', 'text-secondary')}>{totalLabel}</span>
            </div>
          )}
        </div>
      </div>
      <ul className="grid w-full grid-cols-2 gap-x-3 gap-y-1">
        {drawn.map((slice) => (
          <li key={slice.key}>
            <button
              type="button"
              onMouseEnter={() => setActive(slice.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(slice.key)}
              onBlur={() => setActive(null)}
              className={cn(
                'focus-ring flex w-full items-center gap-2 transition-opacity',
                active && active !== slice.key ? 'opacity-45' : 'opacity-100',
              )}
            >
              <LegendSwatch fillClass={slice.swatchClass} />
              <span className={textRole('caption', 'truncate')}>{slice.label}</span>
              <span className={textRole('caption', 'text-secondary ml-auto shrink-0 tabular-nums')}>
                {shareText(slice.value, whole)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

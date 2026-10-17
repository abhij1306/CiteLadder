import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

import { MissingValue } from '@/components/ui/unavailable-value';
import { textRole } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

/**
 * Delta — the one change indicator.
 *
 * The direction is always carried three ways — the sign, the arrow and
 * (where the metric has one) the outcome tone — so colour is never the only
 * signal. The tone is a policy, not a guess: `higher-is-better` paints a rise
 * as success, `lower-is-better` (rank, latency, errors) paints it as danger,
 * and `neutral` stays in secondary ink because the movement is a fact, not a
 * verdict. Accent is never a delta colour.
 *
 * The sign is decided from the value the reader SEES, after rounding, so a
 * movement of +0.04 never prints as "+0.0" claiming a direction it does not
 * have; a displayed zero is flat and muted.
 *
 * A missing change (null, undefined or non-finite) is not zero. It renders the
 * availability vocabulary (`MissingValue`: the muted dash, "Not measured" as its
 * accessible name, and the optional reason on hover/focus).
 */
export type DeltaPolicy = 'higher-is-better' | 'lower-is-better' | 'neutral';

type Direction = 'up' | 'down' | 'flat';

const ICONS = { up: ArrowUp, down: ArrowDown, flat: Minus } as const;

/** What the movement means under the policy; `data-outcome` exposes it. */
type Outcome = 'improved' | 'worsened' | 'changed' | 'unchanged';

function outcomeOf(direction: Direction, policy: DeltaPolicy): Outcome {
  if (direction === 'flat') return 'unchanged';
  if (policy === 'neutral') return 'changed';
  return (direction === 'up') === (policy === 'higher-is-better') ? 'improved' : 'worsened';
}

const OUTCOME_INK: Record<Outcome, string> = {
  improved: 'text-success-text',
  worsened: 'text-danger-text',
  changed: 'text-secondary',
  unchanged: 'text-muted',
};

/** A true minus sign, so a screen reader says "minus" rather than "dash". */
const SIGNS = { up: '+', down: '−', flat: '' } as const;

function roundedChange(value: number, precision: number) {
  const rounded = Number(value.toFixed(precision));
  let direction: Direction = 'flat';
  if (rounded > 0) direction = 'up';
  else if (rounded < 0) direction = 'down';
  return { direction, magnitude: Math.abs(rounded) };
}

export function Delta({
  value,
  policy = 'higher-is-better',
  precision = 1,
  unit = '',
  missingReason,
  context,
  className,
}: Readonly<{
  /** The signed change, or null when there is nothing to compare against. */
  value: number | null | undefined;
  /** Which direction is good. Decides the tone, never the sign. */
  policy?: DeltaPolicy;
  /** Decimal places the change is rounded to before its sign is decided. */
  precision?: number;
  /** Appended to the magnitude, e.g. `' pp'`, `'%'`. */
  unit?: string;
  /** Why there is no change, e.g. "No comparable run" — shown on hover/focus. */
  missingReason?: string;
  /** A trailing qualifier in the same run, e.g. "vs previous". */
  context?: string;
  className?: string;
}>) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return (
      <span className={textRole('delta', cn('text-muted', className))}>
        <MissingValue reason={missingReason} />
      </span>
    );
  }
  const { direction, magnitude } = roundedChange(value, precision);
  const text = magnitude.toFixed(precision);
  const Icon = ICONS[direction];
  const outcome = outcomeOf(direction, policy);
  return (
    <span
      data-direction={direction}
      data-outcome={outcome}
      className={textRole(
        'delta',
        cn('inline-flex items-center gap-1 whitespace-nowrap', OUTCOME_INK[outcome], className),
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span>
        {SIGNS[direction]}
        {text}
        {unit}
        {context ? ` ${context}` : null}
      </span>
    </span>
  );
}

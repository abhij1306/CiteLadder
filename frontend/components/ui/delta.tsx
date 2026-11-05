import { MissingValue } from '@/components/ui/unavailable-value';
import { cn } from '@/lib/utils';

/**
 * Delta — a change on its own, in the voice of a Stat's change line: an
 * arrow, the magnitude and a word for screen readers, in the mono `data`
 * style. No sign as well as the arrow.
 *
 * Colour follows meaning, not direction, and the policy decides it:
 * `higher-is-better` paints a rise `positive`, `lower-is-better` (rank,
 * latency, errors) paints it `negative`, and `neutral` stays `ink-secondary`
 * because the movement is a fact, not a verdict. A displayed zero is flat
 * (→, `ink-secondary`). The arrow and the hidden word carry the direction
 * without colour.
 *
 * The direction is decided from the value the reader SEES, after rounding, so
 * a movement of +0.04 never claims a direction it does not show.
 *
 * A missing change (null, undefined or non-finite) is not zero: it renders the
 * availability vocabulary (`MissingValue`: the muted dash, "Not measured" as
 * its accessible name, and the optional reason on hover/focus).
 */
export type DeltaPolicy = 'higher-is-better' | 'lower-is-better' | 'neutral';

type Direction = 'up' | 'down' | 'flat';

const TREND = {
  up: { arrow: '↑', word: 'up' },
  down: { arrow: '↓', word: 'down' },
  flat: { arrow: '→', word: 'no change' },
} as const satisfies Record<Direction, { arrow: string; word: string }>;

/** What the movement means under the policy; `data-outcome` exposes it. */
type Outcome = 'improved' | 'worsened' | 'changed' | 'unchanged';

function outcomeOf(direction: Direction, policy: DeltaPolicy): Outcome {
  if (direction === 'flat') return 'unchanged';
  if (policy === 'neutral') return 'changed';
  return (direction === 'up') === (policy === 'higher-is-better') ? 'improved' : 'worsened';
}

const OUTCOME_INK: Record<Outcome, string> = {
  improved: 'text-positive',
  worsened: 'text-negative',
  changed: 'text-ink-secondary',
  unchanged: 'text-ink-secondary',
};

function roundedChange(value: number, precision: number) {
  const rounded = Number(value.toFixed(precision));
  let direction: Direction = 'flat';
  if (rounded > 0) direction = 'up';
  else if (rounded < 0) direction = 'down';
  return { direction, magnitude: Math.abs(rounded) };
}

const DELTA_FACE = 'type-delta inline-flex items-baseline gap-1 whitespace-nowrap';

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
  /** Which direction is good. Decides the colour, never the arrow. */
  policy?: DeltaPolicy;
  /** Decimal places the change is rounded to before its direction is decided. */
  precision?: number;
  /** Appended to the magnitude, e.g. `' pts'`, `'%'`. */
  unit?: string;
  /** Why there is no change, e.g. "No comparable run" — shown on hover/focus. */
  missingReason?: string;
  /** The period the change covers, e.g. "vs last week", in `ink-muted`. */
  context?: string;
  className?: string;
}>) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return (
      <span className={cn(DELTA_FACE, 'text-ink-muted', className)}>
        <MissingValue reason={missingReason} />
      </span>
    );
  }
  const { direction, magnitude } = roundedChange(value, precision);
  const outcome = outcomeOf(direction, policy);
  return (
    <span
      data-direction={direction}
      data-outcome={outcome}
      className={cn(DELTA_FACE, OUTCOME_INK[outcome], className)}
    >
      <span aria-hidden className="inline-block w-[1ch]">
        {TREND[direction].arrow}
      </span>
      <span className="sr-only">{`${TREND[direction].word} `}</span>
      <span>
        {magnitude.toFixed(precision)}
        {unit}
      </span>
      {context ? <span className="text-ink-muted ms-0.5">{context}</span> : null}
    </span>
  );
}

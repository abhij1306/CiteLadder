import { Absence } from '@/components/ui/absence';
import { cn } from '@/lib/utils';

export type DeltaPolicy = 'higher-is-better' | 'lower-is-better' | 'neutral';

type Direction = 'up' | 'down' | 'flat';

const SPOKEN = {
  up: 'up',
  down: 'down',
  flat: 'no change',
} as const satisfies Record<Direction, string>;

type Outcome = 'improved' | 'worsened' | 'changed' | 'unchanged';

function outcomeOf(direction: Direction, policy: DeltaPolicy): Outcome {
  if (direction === 'flat') return 'unchanged';
  if (policy === 'neutral') return 'changed';
  return (direction === 'up') === (policy === 'higher-is-better') ? 'improved' : 'worsened';
}

const OUTCOME_INK: Record<Outcome, string> = {
  improved: 'text-positive',
  worsened: 'text-negative',
  changed: 'text-ink-2',
  unchanged: 'text-ink-2',
};

function roundedChange(value: number, precision: number) {
  const rounded = Number(value.toFixed(precision));
  let direction: Direction = 'flat';
  if (rounded > 0) direction = 'up';
  else if (rounded < 0) direction = 'down';
  return { direction, magnitude: Math.abs(rounded) };
}

const DELTA_FACE =
  'type-caption inline-flex items-baseline gap-1 font-medium tabular-nums whitespace-nowrap [[data-public-surface]_&]:font-mono [[data-public-surface]_&]:font-normal';

const SIGN = { up: '+', down: '−', flat: '±' } as const satisfies Record<Direction, string>;

export function Delta({
  value,
  policy = 'higher-is-better',
  precision = 1,
  unit = '',
  missingReason,
  context,
  spokenContext,
  className,
}: Readonly<{
  value: number | null | undefined;
  policy?: DeltaPolicy;
  precision?: number;
  unit?: string;
  missingReason?: string;
  context?: string;
  spokenContext?: string;
  className?: string;
}>) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return <Absence state="not_measured" reason={missingReason} className={className} />;
  }
  const { direction, magnitude } = roundedChange(value, precision);
  const outcome = outcomeOf(direction, policy);
  return (
    <span
      data-direction={direction}
      data-outcome={outcome}
      className={cn(DELTA_FACE, OUTCOME_INK[outcome], className)}
    >
      {direction === 'flat' ? (
        <>
          <span className="sr-only">{SPOKEN.flat}</span>
          <span aria-hidden>{`${SIGN.flat}0${unit}`}</span>
        </>
      ) : (
        <>
          <span className="sr-only">{`${SPOKEN[direction]} `}</span>
          <span>
            <span aria-hidden>{SIGN[direction]}</span>
            {magnitude.toFixed(precision)}
            {unit}
          </span>
        </>
      )}
      {context ? <span className="text-ink-2 ms-0.5 font-normal">{context}</span> : null}
      {spokenContext ? <span className="sr-only">{` ${spokenContext}`}</span> : null}
    </span>
  );
}

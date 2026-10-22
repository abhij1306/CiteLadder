'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import { scoreBand, scoreBandStroke, scoreBandText } from './score-band';

/** The ring's one form: a 48px dial with a 4px track and the `figureSm` numeral. */
const RING_SIZE = 48;
const RING_STROKE = 4;

/**
 * ScoreRing — circular progress. Color from the score-band token, center
 * shows the tabular display number. Carries an ARIA label with the percentage
 * (role="img") so the value is announced to assistive tech.
 *
 * One form: the ring sits in a `StatRow` segment beside its label, so it is
 * the same 48px dial wherever a score is drawn. The size, stroke and numeral
 * props it used to take are gone; a bigger ring would out-shout the page title.
 *
 * The arc sweeps to its value with the slow motion role on mount. `motion-reduce` drops the
 * transition so the ring simply appears at its final value.
 */
export function ScoreRing({
  value,
  label,
  className,
}: Readonly<{
  /** Score 0–100. */
  value: number;
  /** Accessible label; defaults to "Visibility score: N%". */
  label?: string;
  className?: string;
}>) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const band = scoreBand(clamped);
  const radius = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);
  const ariaLabel = label ?? `Visibility score: ${clamped}%`;

  // A CSS transition only animates a CHANGE, so the arc has to be painted empty
  // first and moved to its value afterwards — rendering it at `dashOffset` from
  // the start would just appear there with the transition never firing. Under
  // `motion-reduce` the transition is off, so the same two paints read as the
  // ring simply appearing at its final value.
  const [swept, setSwept] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSwept(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className={cn('relative inline-flex size-12 items-center justify-center', className)}>
      <svg
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- SVG is the semantic image; img cannot render this generated score ring.
        role="img"
        aria-label={ariaLabel}
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        className="-rotate-90"
      >
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={radius}
          fill="none"
          strokeWidth={RING_STROKE}
          className="stroke-well"
        />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={radius}
          fill="none"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={swept ? dashOffset : circumference}
          className={cn(
            'transition-[stroke-dashoffset] duration-[var(--motion-slow)] ease-[var(--ease-standard)] motion-reduce:transition-none',
            scoreBandStroke[band],
          )}
        />
      </svg>
      <span
        aria-hidden
        className={cn(
          'type-figure-sm absolute inset-0 flex items-center justify-center',
          scoreBandText[band],
        )}
      >
        {clamped}
      </span>
    </div>
  );
}
